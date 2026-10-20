// Uji terisolasi: database sementara; tidak menyentuh data preview/produksi.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-interface-"));
const DB = path.join(TMP, "uji.db");
const LEGACY = path.join(TMP, "legacy.db");
const PORT = process.env.UJI_INTERFACE_PORT || "4798";
const BASE = `http://127.0.0.1:${PORT}`;
let server, token, count = 0;
async function start(dbFile = DB) {
  let output = "";
  server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, ARENA_API_PORT: PORT, ARENA_API_HOST: "127.0.0.1", ARENA_DB_PATH: dbFile }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Server belum siap: ${output}`)), 15000);
    server.stdout.on("data", (d) => { output += d; if (output.includes("siap di")) { clearTimeout(timer); resolve(); } });
    server.stderr.on("data", (d) => { output += d; });
    server.once("error", (e) => { clearTimeout(timer); reject(e); });
    server.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Server berhenti (${code}): ${output}`)); });
  });
}
async function stop() {
  if (server && server.exitCode == null && server.signalCode == null) { const exit = once(server, "exit"); server.kill(); await exit; }
  server = null;
}
async function request(method, route, body, status = 200, auth = token) {
  const res = await fetch(BASE + route, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  assert.equal(res.status, status, `${method} ${route}: ${JSON.stringify(data)}`);
  count++;
  return data;
}
async function login() { token = (await request("POST", "/api/login", { email: "admin@arena.test", password: "Arena123!" }, 200, null)).token; }
const get = (p) => request("GET", p);
const post = (p, b, s = 201) => request("POST", p, b, s);
const patch = (p, b, s = 200) => request("PATCH", p, b, s);
const del = (p, s = 200) => request("DELETE", p, undefined, s);
const map = (b, s = 200) => request("PUT", "/api/interface-mappings", b, s);
const baseTables = ["olts", "olt_cards", "olt_ports", "odcs", "odps", "core_assignments", "core_links", "splitters", "splitter_outputs"];
const oldRows = (db) => Object.fromEntries(baseTables.map((t) => [t, db.prepare(`SELECT * FROM ${t} ORDER BY id`).all().map(({ interface_mode, shelf, is_builtin, interface_name, ...rest }) => rest)]));

try {
  console.log("\n=== UJI INTERFACE API & MIGRASI ===");
  await start(); await login();
  // Salin fixture baru ke DB lama, kemudian buang hanya fitur yang belum ada
  // pada versi sebelum interface. Data asli dan ID disimpan untuk dibandingkan.
  let db = new DatabaseSync(DB);
  db.exec(`VACUUM INTO '${LEGACY.replaceAll("'", "''")}'`); db.close();
  db = new DatabaseSync(LEGACY);
  const snapshot = oldRows(db);
  db.exec(`DROP TABLE interface_mappings; DROP INDEX uq_card_position;
    ALTER TABLE olts DROP COLUMN interface_mode;
    ALTER TABLE olt_cards DROP COLUMN shelf; ALTER TABLE olt_cards DROP COLUMN is_builtin;
    ALTER TABLE olt_ports DROP COLUMN interface_name;`);
  db.close();

  await request("GET", "/api/interface-mappings", undefined, 401, null);
  const olt = await post("/api/olts", { name: "OLT-C300-LAPANGAN", olt_type: "ZTE C300" });
  assert.equal(olt.interface_mode, "shelf_slot_port");
  const c1 = await post("/api/cards", { olt_id: olt.id, shelf: 1, slot: 1, card_type: "GTGO", port_count: 8 });
  const c2 = await post("/api/cards", { olt_id: olt.id, shelf: 1, slot: 2 });
  await post("/api/cards", { olt_id: olt.id, shelf: 2, slot: 1 });
  await post("/api/cards", { olt_id: olt.id, shelf: 1, slot: 1 }, 409);
  for (const shelf of [0, -1, 1.2, true, "abc", 257]) await post("/api/cards", { olt_id: olt.id, shelf, slot: 3 }, 400);
  const p1 = await post("/api/ports", { card_id: c1.id, port: 1, status: "active" });
  const p2 = await post("/api/ports", { card_id: c2.id, port: 1 });
  const p3 = await post("/api/ports", { card_id: c2.id, port: 2 });
  assert.equal(p1.interface_label, "GPON 1/1/1");
  assert.equal(p2.interface_cli, "gpon-olt_1/2/1");
  assert.equal((await get(`/api/ports?card_id=${c1.id}`))[0].interface_label, p1.interface_label);
  assert.equal((await get(`/api/ports?olt_id=${olt.id}`)).length, 3);
  await patch(`/api/olts/${olt.id}`, { interface_mode: "pon" }, 409);
  await patch(`/api/olts/${olt.id}`, { interface_mode: "not-a-mode" }, 400);

  const olt2 = await post("/api/olts", { name: "OLT-C320-LAPANGAN", olt_type: "ZTE C320" });
  const c3 = await post("/api/cards", { olt_id: olt2.id, slot: 1 });
  const other = await post("/api/ports", { card_id: c3.id, port: 1 });
  assert.equal(other.interface_label, p1.interface_label);
  assert.notEqual(other.id, p1.id);

  const fixed = await post("/api/olts", { name: "OLT-HSGQ", olt_type: "HSGQ XPON", fixed_port_count: 8 });
  assert.equal(fixed.interface_mode, "pon");
  const builtins = await get(`/api/cards?olt_id=${fixed.id}`);
  assert.equal(builtins.length, 1); assert.equal(builtins[0].is_builtin, 1);
  const pon = await post("/api/ports", { olt_id: fixed.id, port: 8 });
  assert.equal(pon.interface_label, "PON 8"); assert.equal(pon.interface_cli, "");
  await post("/api/cards", { olt_id: fixed.id, slot: 2 }, 400);
  await patch(`/api/cards/${builtins[0].id}`, { port_count: 16 }, 400);
  await del(`/api/cards/${builtins[0].id}`, 400);
  await post("/api/ports", { olt_id: fixed.id, port: 9 }, 400);
  await patch(`/api/olts/${fixed.id}`, { fixed_port_count: 4 }, 400);
  await patch(`/api/olts/${fixed.id}`, { fixed_port_count: 16 });
  assert.equal((await get(`/api/cards?olt_id=${fixed.id}`))[0].port_count, 16);
  await post("/api/olts", { name: "OLT invalid", interface_mode: "pon", fixed_port_count: true }, 400);

  const custom = await post("/api/olts", { name: "OLT-MANUAL", olt_type: "Lainnya", interface_mode: "custom", fixed_port_count: 4 });
  await post("/api/ports", { olt_id: custom.id, port: 1 }, 400);
  await post("/api/ports", { olt_id: custom.id, port: 1, interface_name: { name: "PON1" } }, 400);
  await post("/api/ports", { olt_id: custom.id, port: 1, interface_name: "x\ny" }, 400);
  const named = await post("/api/ports", { olt_id: custom.id, port: 1, interface_name: " EPON0/1 " });
  assert.equal(named.interface_label, "EPON0/1");
  await post("/api/ports", { olt_id: custom.id, port: 2, interface_name: "epon0/1" }, 400);
  await patch(`/api/ports/${named.id}`, { notes: "label sesuai panel" });
  console.log("  OK    C300/C320, multi-shelf, HSGQ fixed-port, penamaan manual, dan validasi interface");

  const odc = await post("/api/odcs", { name: "ODC-LAPANGAN", olt_id: olt.id, cable_type: "24_core_4_tube", feeder_port_ids: [p1.id, p2.id] });
  const odc2 = await post("/api/odcs", { name: "ODC-DUA", olt_id: olt.id, cable_type: "24_core_4_tube", feeder_port_ids: [p1.id] });
  assert.equal((await get(`/api/interface-mappings?odc_id=${odc.id}`)).length, 0, "Daftar feeder tidak boleh menghasilkan mapping otomatis");
  assert.equal((await get(`/api/feeder-ports?odc_id=${odc.id}`))[0].interface_label, p1.interface_label);
  for (const core of [0, -1, 1.2, true, "abc", 25]) await map({ odc_id: odc.id, core, port_id: p1.id }, 400);
  await map({ odc_id: odc.id, core: 1, port_id: other.id }, 400);
  await map({ odc_id: odc.id, core: 1, port_id: p3.id }, 400);
  await map({ odc_id: 999999, core: 1, port_id: p1.id }, 400);
  const m1 = await map({ odc_id: odc.id, core: 1, port_id: p1.id, notes: "ODF tray 2" });
  const m2 = await map({ odc_id: odc.id, core: 2, port_id: p2.id });
  assert.equal((await map({ odc_id: odc.id, core: 1, port_id: p1.id, notes: "ODF tray 3" })).id, m1.id, "Upsert tidak membuat baris ganda");
  await map({ odc_id: odc.id, core: 3, port_id: p1.id }, 409);
  await map({ odc_id: odc2.id, core: 1, port_id: p1.id }, 409);
  await patch(`/api/odcs/${odc.id}`, { feeder_port_ids: [p2.id] }, 409);
  await patch(`/api/odcs/${odc.id}`, { feeder_port_ids: null }, 400);
  await patch(`/api/odcs/${odc.id}`, { olt_id: olt2.id, feeder_port_ids: [] }, 409);
  await del(`/api/ports/${p1.id}`, 409);
  await del(`/api/cards/${c1.id}`, 409);
  await patch(`/api/odcs/${odc.id}`, { feeder_port_ids: [p1.id, p2.id, p3.id] });
  const high = await map({ odc_id: odc.id, core: 24, port_id: p3.id });
  await patch(`/api/odcs/${odc.id}`, { cable_type: "12_core_2_tube" }, 400);
  await del(`/api/interface-mappings/${high.id}`);
  await patch(`/api/odcs/${odc.id}`, { cable_type: "12_core_2_tube" });
  const duplicateA = await post("/api/splitters", { odc_id: odc.id, name: "SPL-INPUT-GANDA-A", ratio: "1:4", input_core: 3 });
  const duplicateB = await post("/api/splitters", { odc_id: odc.id, name: "SPL-INPUT-GANDA-B", ratio: "1:4", input_core: 3 });
  await map({ odc_id: odc.id, core: 3, port_id: p3.id }, 409);
  await del(`/api/splitters/${duplicateA.id}`); await del(`/api/splitters/${duplicateB.id}`);

  await patch(`/api/cards/${c1.id}`, { shelf: 2, slot: 4 });
  const renamed = (await get(`/api/interface-mappings?odc_id=${odc.id}`)).find((m) => m.id === m1.id);
  assert.equal(renamed.interface_label, "GPON 2/4/1"); assert.equal(renamed.port_id, p1.id);
  await patch(`/api/ports/${p1.id}`, { port: 3 });
  assert.equal((await get(`/api/interface-mappings?odc_id=${odc.id}`)).find((m) => m.id === m1.id).interface_cli, "gpon-olt_2/4/3");
  console.log("  OK    mapping eksplisit, satu feeder fisik per port, perlindungan data dan referensi ID tetap stabil");

  await post("/api/users", { email: "interface-readonly@test.local", full_name: "Teknisi Baca", password: "UjiInterface123!", role: "user" });
  const reader = (await request("POST", "/api/login", { email: "interface-readonly@test.local", password: "UjiInterface123!" }, 200, null)).token;
  await request("GET", "/api/interface-mappings", undefined, 200, reader);
  await request("PUT", "/api/interface-mappings", { odc_id: odc.id, core: 2, port_id: p2.id }, 403, reader);
  await request("DELETE", `/api/interface-mappings/${m1.id}`, undefined, 403, reader);
  const operator = (await request("POST", "/api/login", { email: "operator@arena.test", password: "Arena123!" }, 200, null)).token;
  await request("PUT", "/api/interface-mappings", { odc_id: odc.id, core: 2, port_id: p2.id }, 200, operator);
  const odp = await post("/api/odps", { name: "ODP-PERSIST", odc_id: odc.id, cable_type: "12_core_2_tube" });
  const link = await post("/api/links", { odc_id: odc.id, odc_core: 2, odp_id: odp.id, odp_core: 1 });
  await del(`/api/interface-mappings/${m2.id}`);
  assert.ok((await get(`/api/links?odc_id=${odc.id}`)).some((l) => l.id === link.id), "Lepas mapping tidak boleh menghapus sambungan hilir");
  await del(`/api/interface-mappings/${m2.id}`, 404);

  await stop(); await start(); await login();
  assert.equal((await get(`/api/interface-mappings?odc_id=${odc.id}`)).find((m) => m.id === m1.id).notes, "ODF tray 3");
  assert.ok((await get(`/api/links?odc_id=${odc.id}`)).some((l) => l.id === link.id));
  await del(`/api/olts/${olt.id}`);
  assert.ok(!(await get("/api/interface-mappings")).some((m) => m.odc_id === odc.id));
  console.log("  OK    hak akses, lepas mapping tanpa menghapus hilir, persistensi restart dan cascade hapus OLT");

  await stop(); await start(LEGACY); await login();
  assert.equal((await get("/api/interface-mappings")).length, 0, "Migrasi tidak menebak mapping dari data lama");
  db = new DatabaseSync(LEGACY);
  assert.deepEqual(oldRows(db), snapshot, "Migrasi harus mempertahankan semua data dan ID sebelumnya");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0);
  db.close();
  await stop(); await start(LEGACY); await login();
  assert.equal((await get("/api/interface-mappings")).length, 0, "Migrasi berulang tetap tidak menebak sumber");
  console.log("  OK    migrasi database lama & restart berulang: semua ID/data tetap, tanpa mapping otomatis");
  console.log(`\nINTERFACE API: ${count} permintaan terverifikasi; semua pemeriksaan lolos`);
} finally {
  await stop(); fs.rmSync(TMP, { recursive: true, force: true });
}
