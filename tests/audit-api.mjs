// Regresi audit alur: memakai server + DB terpisah, tidak menyentuh preview.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-audit-api-"));
const DB = path.join(TMP, "audit.db");
const PORT = process.env.UJI_AUDIT_PORT || "4796", BASE = `http://127.0.0.1:${PORT}`;
let token, server, output = "", passed = 0, failed = 0, seq = 0, requests = 0;
async function check(name, fn) {
  try { await fn(); passed++; console.log(`  OK    ${name}`); }
  catch (e) { failed++; console.error(`  GAGAL ${name}: ${e.message}`); }
}
async function request(method, route, body, status = 200, auth = token) {
  const response = await fetch(BASE + route, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json(); requests++;
  assert.equal(response.status, status, `${method} ${route} → ${response.status}: ${JSON.stringify(data)}`);
  return data;
}
const post = (p, b, s = 201) => request("POST", p, b, s), patch = (p, b, s = 200) => request("PATCH", p, b, s);
const get = p => request("GET", p), del = p => request("DELETE", p);
let olt, card;
const odc = (extra = {}) => post("/api/odcs", { name: `ODC-AUDIT-${++seq}`, olt_id: olt.id, cable_type: "48_core_8_tube", ...extra });
const odp = d => post("/api/odps", { name: `ODP-AUDIT-${++seq}`, odc_id: d.id, cable_type: "12_core_2_tube" });
const splitter = (d, extra = {}) => post("/api/splitters", { name: `SPL-AUDIT-${++seq}`, odc_id: d.id, ratio: "1:8", input_core: 1, ...extra });
const outputAt = (s, port = 1) => s.outputs.find(o => o.port === port).id;
const currentSplitter = async id => (await get("/api/splitters")).find(s => s.id === id);
let portNumber = 0;
async function mappedRoot() {
  const port = await post("/api/ports", { card_id: card.id, port: ++portNumber });
  const d = await odc({ feeder_port_ids: [port.id] }), s = await splitter(d);
  await request("PUT", "/api/interface-mappings", { odc_id: d.id, core: 1, port_id: port.id });
  return { d, s, port };
}
try {
  server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, ARENA_DB_PATH: DB, ARENA_API_PORT: PORT, ARENA_API_HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output)), 15000);
    server.stdout.on("data", d => { output += d; if (output.includes("siap di")) { clearTimeout(timer); resolve(); } });
    server.stderr.on("data", d => { output += d; });
    server.once("error", e => { clearTimeout(timer); reject(e); });
    server.once("exit", code => { clearTimeout(timer); reject(new Error(`Server ${code}: ${output}`)); });
  });
  token = (await post("/api/login", { email: "admin@arena.test", password: "Arena123!" }, 200)).token;
  olt = await post("/api/olts", { name: "OLT-AUDIT", olt_type: "ZTE C300" });
  card = await post("/api/cards", { olt_id: olt.id, slot: 1, port_count: 16 });
  console.log("\n=== AUDIT API / KEAMANAN SAMBUNGAN ===");
  await check("hapus splitter tidak memutus ODC lain yang kebetulan bernomor ID sama", async () => {
    const parent = await odc(), victim = await splitter(parent);
    let destination;
    do { destination = await odc(); } while (destination.id < victim.id);
    assert.equal(destination.id, victim.id, "Fixture sengaja menyamakan ID ODC dengan ID splitter");
    const receiver = await splitter(destination), source = await splitter(parent, { input_core: 2 });
    await patch(`/api/splitter-outputs/${outputAt(source)}`, { target_type: "odc", target_id: destination.id, target_odc_splitter_id: receiver.id });
    await del(`/api/splitters/${victim.id}`);
    const out = (await currentSplitter(source.id)).outputs[0];
    assert.equal(out.target_odc_id, destination.id); assert.equal(out.target_odc_splitter_id, receiver.id); assert.equal(out.target_type, "odc");
  });
  await check("hapus receiver mempertahankan rute ODC dengan penanda receiver kosong", async () => {
    const parent = await odc(), child = await odc(), source = await splitter(parent), receiver = await splitter(child);
    await patch(`/api/splitter-outputs/${outputAt(source)}`, { target_type: "odc", target_id: child.id, target_odc_splitter_id: receiver.id });
    await del(`/api/splitters/${receiver.id}`);
    const out = (await currentSplitter(source.id)).outputs[0];
    assert.equal(out.target_odc_id, child.id); assert.equal(out.target_type, "odc"); assert.equal(out.target_odc_splitter_id, null);
  });
  await check("mengecilkan rasio tidak menghapus output yang masih tersambung", async () => {
    const d = await odc(), p = await odp(d), s = await splitter(d);
    await patch(`/api/splitter-outputs/${outputAt(s, 8)}`, { target_type: "odp", target_id: p.id });
    await patch(`/api/splitters/${s.id}`, { ratio: "1:2" }, 409);
    const saved = await currentSplitter(s.id); assert.equal(saved.ratio, "1:8"); assert.equal(saved.outputs[7].target_odp_id, p.id);
  });
  await check("mengecilkan rasio tidak membuang catatan output; port kosong boleh dipangkas", async () => {
    const d = await odc(), s = await splitter(d);
    await patch(`/api/splitter-outputs/${outputAt(s, 8)}`, { notes: "Label kabel yang harus disimpan" });
    await patch(`/api/splitters/${s.id}`, { ratio: "1:4" }, 409);
    await patch(`/api/splitter-outputs/${outputAt(s, 8)}`, { notes: "" });
    const saved = await patch(`/api/splitters/${s.id}`, { ratio: "1:2" }); assert.equal(saved.outputs.length, 2);
  });
  await check("PATCH tidak bisa memalsukan induk agar input core melampaui kabel sebenarnya", async () => {
    const small = await odc({ cable_type: "figure8_6_core" }), big = await odc(), s = await splitter(small);
    await patch(`/api/splitters/${s.id}`, { odc_id: big.id, input_core: 48 }, 400);
    const saved = await currentSplitter(s.id); assert.equal(saved.odc_id, small.id); assert.equal(saved.input_core, 1);
  });
  await check("receiver ODC anak tidak bisa sekaligus menerima input cascade lokal", async () => {
    const parent = await odc(), child = await odc(), source = await splitter(parent), receiver = await splitter(child), local = await splitter(child, { input_core: 2 });
    await patch(`/api/splitter-outputs/${outputAt(source)}`, { target_type: "odc", target_id: child.id, target_odc_splitter_id: receiver.id });
    await patch(`/api/splitter-outputs/${outputAt(local)}`, { target_type: "splitter", target_id: receiver.id }, 409);
    assert.equal((await currentSplitter(receiver.id)).input_core, 1);
  });
  await check("cascade tidak mengambil alih splitter yang masih dipetakan ke interface feeder", async () => {
    const { d, s } = await mappedRoot(), local = await splitter(d, { input_core: 2 });
    await patch(`/api/splitter-outputs/${outputAt(local)}`, { target_type: "splitter", target_id: s.id }, 409);
    assert.equal((await currentSplitter(s.id)).input_core, 1);
  });
  await check("rute ODC anak tidak mengambil alih input feeder yang sudah dipetakan", async () => {
    const { d, s } = await mappedRoot(), parent = await odc(), source = await splitter(parent);
    await patch(`/api/splitter-outputs/${outputAt(source)}`, { target_type: "odc", target_id: d.id, target_odc_splitter_id: s.id }, 409);
  });
  await check("sambungan kabel langsung tidak memakai core yang sudah menjadi input splitter langsung", async () => {
    const { d } = await mappedRoot(), p = await odp(d);
    await post("/api/links", { odc_id: d.id, odc_core: 1, odp_id: p.id, odp_core: 1 }, 409);
  });
  await check("input splitter baru tidak menduplikasi feeder terpetakan atau kabel langsung", async () => {
    const { d } = await mappedRoot();
    await post("/api/splitters", { name: "SPL-DUPLIKAT", odc_id: d.id, ratio: "1:4", input_core: 1 }, 409);
    const other = await odc(), p = await odp(other);
    await post("/api/links", { odc_id: other.id, odc_core: 1, odp_id: p.id, odp_core: 1 });
    await post("/api/splitters", { name: "SPL-DUPLIKAT-LINK", odc_id: other.id, ratio: "1:4", input_core: 1 }, 409);
  });
  await check("edit input splitter tidak menduplikasi core feeder terpetakan", async () => {
    const { d } = await mappedRoot(), other = await splitter(d, { input_core: 2 });
    await patch(`/api/splitters/${other.id}`, { input_core: 1 }, 409);
    assert.equal((await currentSplitter(other.id)).input_core, 2);
  });
  await check("splitter receiver boleh memakai nomor core yang sama pada kabel masuk berbeda", async () => {
    const parent = await odc(), child = await odc(), source = await splitter(parent), a = await splitter(child), b = await splitter(child);
    await patch(`/api/splitter-outputs/${outputAt(source)}`, { target_type: "odc", target_id: child.id, target_odc_splitter_id: a.id });
    await patch(`/api/splitter-outputs/${outputAt(source, 2)}`, { target_type: "odc", target_id: child.id, target_odc_splitter_id: b.id });
    await patch(`/api/splitters/${b.id}`, { input_core: 1 });
    assert.equal((await currentSplitter(b.id)).input_core, 1);
  });
  await check("sesi yang lewat tujuh hari ditolak pada kanal header, parameter dan cookie", async () => {
    const session = await post("/api/login", { email: "operator@arena.test", password: "Arena123!" }, 200);
    const db = new DatabaseSync(DB);
    db.prepare("UPDATE sessions SET created_at=datetime('now','-8 days') WHERE token=?").run(session.token); db.close();
    await request("GET", "/api/me", undefined, 401, session.token);
    await request("GET", `/api/me?token=${encodeURIComponent(session.token)}`, undefined, 401, null);
    const response = await fetch(BASE + "/api/me", { headers: { cookie: `fiberops_token=${session.token}` } }); assert.equal(response.status, 401);
  });
  await check("rasio nonteks ditolak 400, bukan error binding 500; spasi dinormalisasi", async () => {
    const d = await odc(), s = await splitter(d);
    await post("/api/splitters", { name: "SPL-RASIO-ARRAY", odc_id: d.id, ratio: ["1:8"] }, 400);
    await patch(`/api/splitters/${s.id}`, { ratio: ["1:4"] }, 400);
    const saved = await patch(`/api/splitters/${s.id}`, { ratio: " 1:4 " });
    assert.equal(saved.ratio, "1:4"); assert.equal(saved.outputs.length, 4);
  });
  await check("foreign key tetap valid setelah seluruh kasus", async () => {
    const db = new DatabaseSync(DB, { readOnly: true });
    assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []); db.close();
  });
  console.log(`\nAUDIT API: ${passed} lulus, ${failed} gagal; ${requests} permintaan terverifikasi\n`);
  if (failed) process.exitCode = 1;
} finally {
  if (server && server.exitCode == null && server.signalCode == null) { const exited = once(server, "exit"); server.kill(); await exited; }
  fs.rmSync(TMP, { recursive: true, force: true });
}
