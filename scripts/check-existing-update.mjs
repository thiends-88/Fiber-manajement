// Pengaman updater existing. Tidak mengimpor server pada DB asli.
// snapshot/compare hanya read-only; probe menjalankan server pada SALINAN privat.
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";

const ignored = new Set(["sessions", "security_migrations"]);
const quote = value => `"${String(value).replaceAll('"', '""')}"`;
const encode = value => {
  if (typeof value === "bigint") return ["integer", String(value)];
  if (value instanceof Uint8Array) return ["blob", Buffer.from(value).toString("base64")];
  return value;
};
function readDb(file, fn) {
  if (!fs.existsSync(file)) throw Error("Database tidak ada; tidak membuat database/demo baru.");
  const db = new DatabaseSync(file, { readOnly: true });
  try { return fn(db); } finally { db.close(); }
}
function tables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all().map(row => row.name).filter(name => !ignored.has(name));
}
function columns(db, table) {
  return db.prepare("SELECT name FROM pragma_table_info(?) ORDER BY cid").all(table).map(row => row.name);
}
function digest(db, table, fields) {
  const sql = `SELECT ${fields.map(quote).join(",")} FROM ${quote(table)} ORDER BY ${fields.map(quote).join(",")}`;
  const stmt = db.prepare(sql);
  stmt.setReadBigInts(true);
  const hash = crypto.createHash("sha256");
  let count = 0;
  for (const row of stmt.iterate()) {
    hash.update(JSON.stringify(fields.map(key => encode(row[key]))) + "\n");
    count++;
  }
  return { count, sha256: hash.digest("hex") };
}
function sequences(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence' AND type='table'").get()) return {};
  const stmt = db.prepare("SELECT name,seq FROM sqlite_sequence ORDER BY name");
  stmt.setReadBigInts(true);
  const known = new Set(tables(db));
  return Object.fromEntries(stmt.all().filter(row => known.has(row.name)).map(row => [row.name, String(row.seq)]));
}
function integrity(db) {
  assert.deepEqual(db.prepare("PRAGMA quick_check").all().map(row => row.quick_check), ["ok"], "SQLite quick_check gagal");
  assert.equal(db.prepare("PRAGMA foreign_key_check").all().length, 0, "Foreign key gagal");
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'").get(), "Tabel akun tidak ditemukan");
  assert.ok(db.prepare("SELECT COUNT(*) AS n FROM users").get().n > 0, "Akun kosong; hentikan agar demo tidak di-seed");
}
export function snapshot(file) {
  return readDb(file, db => {
    integrity(db);
    return {
      version: 1,
      tables: Object.fromEntries(tables(db).map(table => {
        const fields = columns(db, table);
        return [table, { columns: fields, ...digest(db, table, fields) }];
      })),
      sequences: sequences(db),
      exclusions: [...ignored],
    };
  });
}
export function compare(before, file) {
  assert.equal(before.version, 1, "Versi manifest tidak dikenal");
  return readDb(file, db => {
    integrity(db);
    const actual = new Set(tables(db));
    const addedColumns = [];
    for (const [table, expected] of Object.entries(before.tables)) {
      assert.ok(actual.has(table), `Tabel lama hilang: ${table}`);
      const fields = columns(db, table);
      for (const field of expected.columns) assert.ok(fields.includes(field), `Kolom lama hilang: ${table}.${field}`);
      const after = digest(db, table, expected.columns);
      assert.equal(after.count, expected.count, `Jumlah baris lama berubah: ${table}`);
      if (after.sha256 !== expected.sha256) throw Error(`Nilai/ID lama berubah: ${table}`);
      for (const field of fields) if (!expected.columns.includes(field)) addedColumns.push(`${table}.${field}`);
    }
    assert.ok(before.sequences && typeof before.sequences === "object", "Manifest penghitung ID tidak lengkap");
    const nextIds = sequences(db);
    for (const [table, value] of Object.entries(before.sequences)) {
      if (nextIds[table] !== value) throw Error(`Penghitung ID lama berubah: ${table}`);
    }
    return { tablesChecked: Object.keys(before.tables).length, addedTables: [...actual].filter(name => !Object.hasOwn(before.tables, name)), addedColumns };
  });
}
async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}
async function stop(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  const signal = name => { try { process.kill(-child.pid, name); } catch (error) { if (error.code !== "ESRCH") throw error; } };
  signal("SIGTERM");
  const timeout = setTimeout(() => signal("SIGKILL"), 5000);
  try { await exited; } finally { clearTimeout(timeout); }
}
async function probe([app, backup, manifest, envFile, node, user, group, uidText, gidText, logFile]) {
  if (process.getuid?.() !== 0) throw Error("Probe harus dijalankan updater root agar UID/GID service tepat.");
  const uid = Number(uidText), gid = Number(gidText);
  assert.ok(Number.isInteger(uid) && uid >= 0 && Number.isInteger(gid) && gid >= 0, "UID/GID tidak valid");
  const before = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const profile = JSON.parse(fs.readFileSync(envFile, "utf8"));
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), "fiberops-probe-"));
  fs.chmodSync(stage, 0o700);
  fs.chownSync(stage, uid, gid);
  const copy = path.join(stage, "database-copy.db");
  let child, logged = 0;
  const log = fs.openSync(logFile, "wx", 0o600);
  const append = chunk => {
    if (logged < 1024 * 1024) fs.writeSync(log, chunk.subarray(0, 1024 * 1024 - logged));
    logged += chunk.length;
  };
  const interrupted = () => child && (() => { try { process.kill(-child.pid, "SIGTERM"); } catch {} })();
  process.once("SIGTERM", interrupted);
  process.once("SIGINT", interrupted);
  try {
    fs.copyFileSync(backup, copy);
    fs.chmodSync(copy, 0o600);
    fs.chownSync(copy, uid, gid);
    compare(before, copy);
    const port = await freePort();
    child = spawn(process.env.FIBEROPS_RUNUSER || "/usr/sbin/runuser", ["-u", user, "-g", group, "--", node, path.join(app, "server.mjs")], {
      cwd: app,
      env: { ...profile, ARENA_DB_PATH: copy, ARENA_API_HOST: "127.0.0.1", ARENA_API_PORT: String(port) },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let spawnError;
    child.on("error", error => { spawnError = error; });
    let healthy = false;
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) break;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(600) });
        const body = await response.json();
        if (response.ok && body.ok === true && body.service === "fiberops-arena-api") { healthy = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 80));
    }
    if (!healthy) throw Error(`Startup pada salinan gagal. Baca log privat: ${logFile}`);
    await stop(child);
    child = null;
    const result = compare(before, copy);
    console.log(`SALINAN LULUS: ${result.tablesChecked} tabel lama identik; ${result.addedTables.length} tabel dan ${result.addedColumns.length} kolom baru. Sesi/metadata keamanan dikecualikan secara eksplisit.`);
  } finally {
    await stop(child);
    process.removeListener("SIGTERM", interrupted);
    process.removeListener("SIGINT", interrupted);
    fs.closeSync(log);
    fs.rmSync(stage, { recursive: true, force: true });
  }
}
function writers(file) {
  const wanted = [];
  for (const name of [file, file + "-wal", file + "-shm"]) {
    try { const stat = fs.statSync(name); wanted.push([stat.dev, stat.ino]); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const found = new Set();
  for (const pid of fs.readdirSync("/proc").filter(value => /^\d+$/.test(value))) {
    let fds;
    try { fds = fs.readdirSync(`/proc/${pid}/fd`); } catch (error) { if (["ENOENT", "ESRCH"].includes(error.code)) continue; throw error; }
    for (const fd of fds) {
      try {
        const stat = fs.statSync(`/proc/${pid}/fd/${fd}`);
        if (wanted.some(([dev, ino]) => stat.dev === dev && stat.ino === ino)) found.add(pid);
      } catch (error) { if (!["ENOENT", "ESRCH", "EINVAL"].includes(error.code)) throw error; }
    }
  }
  if (found.size) throw Error(`DB/WAL/SHM masih dibuka PID ${[...found].join(", ")}; hentikan proses lain dahulu.`);
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === "snapshot" && args.length === 2) {
    fs.writeFileSync(args[1], JSON.stringify(snapshot(args[0]), null, 2) + "\n", { mode: 0o600, flag: "wx" });
    console.log("Manifest nilai/ID lama tersimpan privat; hash/password tidak dicetak.");
  } else if (command === "compare" && args.length === 2) {
    const result = compare(JSON.parse(fs.readFileSync(args[0], "utf8")), args[1]);
    console.log(`DATA LULUS: ${result.tablesChecked} tabel lama identik (akun, hash password, ID, nilai, dan kolom tambahan).`);
  } else if (command === "probe" && args.length === 10) await probe(args);
  else if (command === "writers" && args.length === 1) writers(args[0]);
  else throw Error("Gunakan snapshot DB MANIFEST | compare MANIFEST DB | writers DB | probe APP BACKUP MANIFEST ENV NODE USER GROUP UID GID LOG");
}
// Dapat diimpor pengujian tanpa efek samping/akses DB.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  main().catch(error => { console.error(`TUNDA: ${error.message}`); process.exitCode = 1; });
}
