// API SQLite nyata + interaksi React/jsdom; seluruh mutasi di DB sementara.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { dashboardFixture } from "./dashboard-fixture.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "fiber-dashboard-"));
const DB = path.join(TMP, "dashboard.db");
const PORT = process.env.UJI_DASHBOARD_PORT || "4793", BASE = `http://127.0.0.1:${PORT}`;
const nodeFetch = globalThis.fetch;
let token, dom, output = "", passed = 0;
const server = spawn(process.execPath, ["server.mjs"], { cwd: ROOT, env: { ...process.env, ARENA_DB_PATH: DB, ARENA_API_HOST: "127.0.0.1", ARENA_API_PORT: PORT }, stdio: ["ignore", "pipe", "pipe"] });
async function request(method, route, body, status = method === "POST" ? 201 : 200, auth = token) {
  const res = await nodeFetch(BASE + route, { method, headers: { "content-type": "application/json", ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  assert.equal(res.status, status, `${method} ${route}: ${JSON.stringify(data)}`); return data;
}
const get = () => request("GET", "/api/dashboard");
async function check(name, run) { await run(); passed++; console.log(`  OK    ${name}`); }
function database(run, readOnly = false) { const db = new DatabaseSync(DB, { readOnly }); try { return run(db); } finally { db.close(); } }
const networkTables = ["olts", "olt_cards", "olt_ports", "odcs", "odps", "odc_feeder_ports", "interface_mappings", "core_assignments", "core_links", "splitters", "splitter_outputs"];
const snapshot = () => database(db => JSON.stringify(Object.fromEntries(networkTables.map(t => [t, db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()]))), true);
const metrics = (row) => [row.portCapacity ?? row.port_count, row.portsRecorded, row.portsActive, row.portsUsed, row.portsFeederPending];
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error(`Server belum siap: ${output}`)), 15000);
    server.stdout.on("data", d => { output += d; if (output.includes("siap di")) { clearTimeout(timer); resolve(); } });
    server.stderr.on("data", d => { output += d; });
    server.once("error", e => { clearTimeout(timer); reject(e); });
    server.once("exit", code => { clearTimeout(timer); reject(Error(`Server ${code}: ${output}`)); });
  });
  console.log("\n=== UJI DASHBOARD / PER OLT & CARD ===");
  await check("dashboard tetap memerlukan sesi", () => request("GET", "/api/dashboard", undefined, 401, null));
  const admin = await request("POST", "/api/login", { email: "admin@arena.test", password: "Arena123!" }, 200); token = admin.token;
  // Hapus seed HANYA pada database sementara yang baru dibuat harness ini.
  for (const device of await request("GET", "/api/olts")) await request("DELETE", `/api/olts/${device.id}`);
  const emptyData = await get();
  await check("inventaris kosong mengembalikan array kosong dan angka nol, bukan card/port rekaan", () => {
    assert.deepEqual(emptyData.oltDevices, []);
    for (const key of ["olts", "cards", "ports", "portsActive", "portsUsed", "portCapacity", "portsFeederPending"]) assert.equal(emptyData[key], 0, key);
  });
  const f = await dashboardFixture(request);
  const device = (data, id) => data.oltDevices.find(o => o.id === id);
  const card = (data, id) => data.oltDevices.flatMap(o => o.cards).find(c => c.id === id);
  const data = await get();
  await check("nama/model dan urutan natural OLT tidak digabung berdasarkan tipe atau nomor slot", () => {
    assert.deepEqual(data.oltDevices.map(o => o.name), ["OLT-001", "OLT-002", "OLT-010", "OLT-HSGQ"]);
    assert.equal(device(data, f.A.id).olt_type, "ZTE C300"); assert.equal(device(data, f.B.id).olt_type, "ZTE C320");
    assert.deepEqual(device(data, f.A.id).cards.map(c => [c.id, c.shelf, c.slot]), [[f.a1.id, 1, 1], [f.a2.id, 1, 2], [f.a3.id, 2, 1]]);
    assert.equal(device(data, f.A.id).cardCount, 3); assert.equal(device(data, f.B.id).cardCount, 1);
  });
  await check("kapasitas, port tercatat, status manual, dan mapping dihitung terpisah per card", () => {
    assert.deepEqual(metrics(card(data, f.a1.id)), [8, 5, 2, 2, 1]);
    assert.deepEqual(metrics(card(data, f.a2.id)), [16, 2, 1, 0, 0]);
    assert.deepEqual(metrics(card(data, f.a3.id)), [8, 0, 0, 0, 0]);
    assert.deepEqual(metrics(card(data, f.b1.id)), [16, 2, 1, 1, 0]);
    assert.deepEqual(metrics(device(data, f.A.id)), [32, 7, 3, 2, 1]);
    assert.equal(card(data, f.a2.id).card_type, "GTHG"); assert.equal(card(data, f.b1.id).card_type, "GTGH");
  });
  await check("satu feeder yang terpilih di dua ODC tetap dihitung sekali dan tidak otomatis terpakai", () => {
    assert.equal(data.portsFeederPending, 1); assert.equal(card(data, f.a1.id).portsUsed, 2);
    assert.equal(data.odps, 2); assert.equal(data.splitters, 4); assert.equal(device(data, f.A.id).portsUsed, 2, "Cascade dan jumlah ODP tidak memperbanyak port");
  });
  await check("OLT tanpa card dan card tanpa port tetap muncul; port bawaan bukan card fisik", () => {
    assert.deepEqual(metrics(device(data, f.empty.id)), [0, 0, 0, 0, 0]); assert.deepEqual(device(data, f.empty.id).cards, []);
    const fixed = device(data, f.fixed.id);
    assert.equal(fixed.cardCount, 0); assert.equal(fixed.cards.length, 1); assert.equal(fixed.cards[0].is_builtin, 1);
    assert.deepEqual(metrics(fixed), [4, 2, 1, 1, 0]); assert.equal(data.cards, 4);
  });
  await check("total lama dan Status Core tetap ada; total perangkat sama dengan penjumlahan rincian", () => {
    assert.deepEqual([data.olts, data.cards, data.ports, data.portsActive, data.portsUsed, data.portCapacity], [4, 4, 11, 5, 4, 52]);
    for (const [total, field] of [["cards", "cardCount"], ["ports", "portsRecorded"], ["portsActive", "portsActive"], ["portsUsed", "portsUsed"], ["portCapacity", "portCapacity"], ["portsFeederPending", "portsFeederPending"]]) {
      assert.equal(data[total], data.oltDevices.reduce((n, o) => n + o[field], 0), total);
    }
    assert.deepEqual([data.cores, data.coresUsed, data.coresReserved, data.coresDamaged, data.coresIdle], [3, 1, 1, 1, 0]);
    assert.equal(data.links, 0);
  });
  await check("ubah status manual hanya mengubah Aktif, bukan Terpakai", async () => {
    try {
      await request("PATCH", `/api/ports/${f.aPorts[1].id}`, { status: "inactive" });
      const next = await get(); assert.deepEqual(metrics(card(next, f.a1.id)), [8, 5, 1, 2, 1]); assert.equal(next.portsActive, 4); assert.equal(next.portsUsed, 4);
    } finally { await request("PATCH", `/api/ports/${f.aPorts[1].id}`, { status: "active" }); }
  });
  await check("lepas mapping port nonaktif mengurangi Terpakai tetapi tidak mengubah Aktif", async () => {
    try {
      await request("DELETE", `/api/interface-mappings/${f.mappings[1].id}`);
      assert.deepEqual(metrics(card(await get(), f.a1.id)), [8, 5, 2, 1, 2]);
    } finally { f.mappings[1] = await request("PUT", "/api/interface-mappings", { odc_id: f.da.id, core: 2, port_id: f.aPorts[2].id }); }
  });
  await check("kapasitas mengikuti konfigurasi aktual, bukan asumsi jumlah port berdasarkan nama GTGO", async () => {
    try {
      await request("PATCH", `/api/cards/${f.a3.id}`, { port_count: 10 });
      const next = await get(); assert.deepEqual(metrics(card(next, f.a3.id)), [10, 0, 0, 0, 0]); assert.equal(next.portCapacity, 54);
    } finally { await request("PATCH", `/api/cards/${f.a3.id}`, { port_count: 8 }); }
  });
  await check("mapping lama ke OLT induk yang salah tidak dianggap sebagai sumber yang terbukti", async () => {
    try {
      database(db => db.prepare("UPDATE odcs SET olt_id=? WHERE id=?").run(f.B.id, f.da.id));
      const next = await get(); assert.equal(device(next, f.A.id).portsUsed, 0); assert.equal(device(next, f.B.id).portsUsed, 1);
    } finally { database(db => db.prepare("UPDATE odcs SET olt_id=? WHERE id=?").run(f.A.id, f.da.id)); }
  });
  await check("mapping tanpa keanggotaan feeder yang sesuai tidak dihitung terpakai", async () => {
    const row = database(db => db.prepare("SELECT * FROM odc_feeder_ports WHERE odc_id=? AND port_id=?").get(f.da.id, f.aPorts[2].id), true);
    try {
      database(db => db.prepare("DELETE FROM odc_feeder_ports WHERE id=?").run(row.id));
      assert.deepEqual(metrics(card(await get(), f.a1.id)), [8, 5, 2, 1, 1]);
    } finally { database(db => db.prepare("INSERT INTO odc_feeder_ports (id,odc_id,port_id) VALUES (?,?,?)").run(row.id, row.odc_id, row.port_id)); }
  });
  await check("konflik input legacy ditandai belum dipetakan; cascade tidak dianggap konflik feeder baru", async () => {
    let extraId;
    try {
      extraId = database(db => db.prepare("INSERT INTO splitters (odc_id,name,ratio,input_core) VALUES (?,?,?,?)").run(f.da.id, "Input legacy ganda", "1:4", 1).lastInsertRowid);
      assert.deepEqual(metrics(card(await get(), f.a1.id)), [8, 5, 2, 1, 2]);
    } finally { if (extraId) database(db => db.prepare("DELETE FROM splitters WHERE id=?").run(extraId)); }
    assert.deepEqual(metrics(card(await get(), f.a1.id)), [8, 5, 2, 2, 1]);
  });
  await request("POST", "/api/users", { email: "dashboard-reader@test.local", full_name: "Pembaca Dashboard", password: "Dashboard123!", role: "user" });
  const reader = await request("POST", "/api/login", { email: "dashboard-reader@test.local", password: "Dashboard123!" }, 200);
  await check("user read-only dapat membaca rincian dashboard yang sama tanpa hak menulis", async () => {
    assert.deepEqual(await request("GET", "/api/dashboard", undefined, 200, reader.token), await get());
    await request("PATCH", `/api/ports/${f.aPorts[0].id}`, { status: "inactive" }, 403, reader.token);
  });
  await check("membaca dashboard berulang tidak memodifikasi satu pun tabel jaringan atau ID", async () => {
    const before = snapshot(); for (let i = 0; i < 4; i++) await get(); assert.equal(snapshot(), before);
    database(db => assert.deepEqual(db.prepare("PRAGMA foreign_key_check").all(), []), true);
  });
  console.log(`DASHBOARD API: ${passed} kasus lolos.\n`);
  dom = new JSDOM("<!doctype html><html><body></body></html>", { url: BASE, pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  window.scrollTo = () => {}; window.confirm = () => true;
  window.fetch = (u, options) => nodeFetch(new URL(String(u), BASE), options);
  for (const key of ["window", "document", "localStorage", "location", "HTMLElement", "Element", "Node", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame", "matchMedia", "ResizeObserver", "IntersectionObserver", "fetch", "confirm"]) {
    Object.defineProperty(globalThis, key, { value: typeof window[key] === "function" && ["requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle"].includes(key) ? window[key].bind(window) : window[key], writable: true, configurable: true });
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = false;
  const { run } = await import("../.uji-dashboard/dashboard-ui.js");
  await run({ request, admin, reader, fixture: f, emptyData });
} finally {
  dom?.window.close();
  if (server.exitCode == null && server.signalCode == null) { const exited = once(server, "exit"); server.kill(); await exited; }
  fs.rmSync(TMP, { recursive: true, force: true });
}
