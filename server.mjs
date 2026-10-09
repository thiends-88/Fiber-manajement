#!/usr/bin/env node
/**
 * FiberOps Arena — server API sederhana.
 *
 * Database: SQLite bawaan Node (node:sqlite), default data/fiberops.db (bisa diubah via ARENA_DB_PATH).
 * Satu file, tanpa dependensi eksternal, bisa di-reset dengan menghapus file-nya.
 *
 * Port default: 4500 (env: ARENA_API_PORT)
 */
import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { CABLE_TYPES, SPLITTER_RATIOS } from "./src/lib/fiber.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Lokasi database bisa diatur lewat ARENA_DB_PATH (berguna untuk uji coba / multi-instance)
const DB_FILE = process.env.ARENA_DB_PATH || path.join(__dirname, "data", "fiberops.db");
const DATA_DIR = path.dirname(DB_FILE);
const PORT = Number(process.env.ARENA_API_PORT || 4500);
const HOST = process.env.ARENA_API_HOST || "0.0.0.0";
const DIST_DIR = path.join(__dirname, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

// Mode produksi: satu proses melayani API + frontend hasil build (dist/).
function sendFile(req, res, filePath) {
  const data = fs.readFileSync(filePath);
  const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type, "Content-Length": data.length });
  res.end(req.method === "HEAD" ? undefined : data);
}

function serveStatic(req, res, p) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(req, res, 405, { error: "Method tidak didukung" });
  }
  if (!fs.existsSync(DIST_DIR)) {
    return send(req, res, 200, {
      service: "fiberops-arena-api",
      hint: "Frontend belum di-build. Jalankan 'npm run build' dulu, atau pakai 'npm run dev' saat pengembangan.",
    });
  }
  const filePath = path.resolve(DIST_DIR, `.${p}`);
  const relativePath = path.relative(DIST_DIR, filePath);
  if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
    return send(req, res, 403, { error: "Forbidden" });
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return sendFile(req, res, filePath);
  return sendFile(req, res, path.join(DIST_DIR, "index.html")); // fallback SPA (route /login, /olt, dst.)
}

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(DB_FILE);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','operator','user')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS olts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    olt_type TEXT,
    location TEXT,
    ip TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS olt_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_id INTEGER NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
    slot INTEGER NOT NULL,
    card_type TEXT NOT NULL,
    label TEXT,
    port_count INTEGER NOT NULL DEFAULT 8,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS olt_ports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL REFERENCES olt_cards(id) ON DELETE CASCADE,
    port INTEGER NOT NULL,
    sfp TEXT,
    serial TEXT,
    status TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','reserved','damaged')),
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS odcs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    olt_id INTEGER NOT NULL REFERENCES olts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location TEXT,
    cable_type TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS odps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    odc_id INTEGER NOT NULL REFERENCES odcs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    location TEXT,
    cable_type TEXT NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS core_assignments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL CHECK (source IN ('olt_to_odc','odc_to_odp')),
    odc_id INTEGER REFERENCES odcs(id) ON DELETE CASCADE,
    odp_id INTEGER REFERENCES odps(id) ON DELETE CASCADE,
    core INTEGER NOT NULL CHECK (core BETWEEN 1 AND 96),
    status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle','used','reserved','damaged')),
    customer TEXT,
    destination TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// Migrasi ringan: database lama otomatis mendapat kolom/tabel baru
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS splitters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    odc_id INTEGER REFERENCES odcs(id) ON DELETE CASCADE,
    odp_id INTEGER REFERENCES odps(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    ratio TEXT NOT NULL,
    input_core INTEGER,
    input_note TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS splitter_outputs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    splitter_id INTEGER NOT NULL REFERENCES splitters(id) ON DELETE CASCADE,
    port INTEGER NOT NULL,
    target_type TEXT CHECK (target_type IS NULL OR target_type IN ('odp','odc','splitter')),
    target_odp_id INTEGER REFERENCES odps(id) ON DELETE SET NULL,
    target_splitter_id INTEGER REFERENCES splitters(id) ON DELETE SET NULL,
    target_odc_id INTEGER REFERENCES odcs(id) ON DELETE SET NULL,
    notes TEXT,
    UNIQUE(splitter_id, port)
  )`,
  `CREATE TABLE IF NOT EXISTS core_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    odc_id INTEGER NOT NULL REFERENCES odcs(id) ON DELETE CASCADE,
    odc_core INTEGER NOT NULL,
    odp_id INTEGER NOT NULL REFERENCES odps(id) ON DELETE CASCADE,
    odp_core INTEGER NOT NULL,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(odc_id, odc_core),
    UNIQUE(odp_id, odp_core)
  )`,
];
for (const stmt of MIGRATIONS) {
  try { db.exec(stmt); } catch { /* kolom/tabel sudah ada */ }
}

// ---------------------------------------------------------------------------
// Bersih-bersih: kolom hitungan redaman/daya sudah TIDAK dipakai lagi.
// Aplikasi ini memetakan ALUR CORE saja (OLT → ODC → ODP), jadi kolom daya
// dibuang supaya tidak ada field menganggur yang membingungkan teknisi.
// Butuh SQLite 3.35+ untuk DROP COLUMN (Node 22 membawa SQLite 3.4x/3.5x).
// ---------------------------------------------------------------------------
const KOLOM_TIDAK_DIPAKAI = [
  ["core_assignments", "power_dbm"],
  ["odcs", "feeder_loss_db"],
  ["olt_ports", "tx_power"],
  ["olt_ports", "rx_power"],
  ["core_links", "loss_db"],
];
for (const [tabel, kolom] of KOLOM_TIDAK_DIPAKAI) {
  try {
    const ada = db.prepare("SELECT 1 FROM pragma_table_info(?) WHERE name=?").get(tabel, kolom);
    if (ada) db.exec(`ALTER TABLE ${tabel} DROP COLUMN ${kolom}`);
  } catch (err) {
    console.warn(`[arena-api] kolom ${tabel}.${kolom} gagal dibuang: ${err.message}`);
  }
}

// Bangun ulang splitter_outputs pada database lama agar menerima target 'odc'
// (CHECK constraint tidak bisa diubah tanpa membangun ulang tabel).
const outTableSql = db
  .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='splitter_outputs'")
  .get()?.sql ?? "";
if (outTableSql && !outTableSql.includes("target_odc_id")) {
  db.exec("PRAGMA foreign_keys = OFF");
  try {
    db.exec(`
      BEGIN;
      ALTER TABLE splitter_outputs RENAME TO splitter_outputs_lama;
      CREATE TABLE splitter_outputs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        splitter_id INTEGER NOT NULL REFERENCES splitters(id) ON DELETE CASCADE,
        port INTEGER NOT NULL,
        target_type TEXT CHECK (target_type IS NULL OR target_type IN ('odp','odc','splitter')),
        target_odp_id INTEGER REFERENCES odps(id) ON DELETE SET NULL,
        target_splitter_id INTEGER REFERENCES splitters(id) ON DELETE SET NULL,
        target_odc_id INTEGER REFERENCES odcs(id) ON DELETE SET NULL,
        notes TEXT,
        UNIQUE(splitter_id, port)
      );
      INSERT INTO splitter_outputs (id, splitter_id, port, target_type, target_odp_id, target_splitter_id, notes)
        SELECT id, splitter_id, port, target_type, target_odp_id, target_splitter_id, notes FROM splitter_outputs_lama;
      DROP TABLE splitter_outputs_lama;
      COMMIT;
    `);
  } catch {
    try { db.exec("ROLLBACK"); } catch { /* abaikan */ }
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

// Port feeder ODC: satu ODC boleh punya BEBERAPA port feeder dari OLT induknya
const feederTableExisted = !!db
  .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='odc_feeder_ports'")
  .get();
db.exec(`CREATE TABLE IF NOT EXISTS odc_feeder_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  odc_id INTEGER NOT NULL REFERENCES odcs(id) ON DELETE CASCADE,
  port_id INTEGER NOT NULL REFERENCES olt_ports(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(odc_id, port_id)
)`);
if (!feederTableExisted) {
  // Database lama hanya menyimpan satu feeder_port_id per ODC — pindahkan ke tabel baru
  try {
    db.exec(
      "INSERT OR IGNORE INTO odc_feeder_ports (odc_id, port_id) SELECT id, feeder_port_id FROM odcs WHERE feeder_port_id IS NOT NULL",
    );
  } catch { /* kolom feeder_port_id tidak ada (database baru) */ }
}

// Lengkapi database demo lama dengan info feeder/power/sambungan (hanya baris demo)
(function backfillDemoExtras() {
  const odc1 = db.prepare("SELECT id FROM odcs WHERE name='ODC-001'").get();
  const odc2 = db.prepare("SELECT id FROM odcs WHERE name='ODC-002'").get();
  const odp1 = db.prepare("SELECT id FROM odps WHERE name='ODP-001'").get();
  if (!odc1 || !odc2 || !odp1) return;
  if (db.prepare("SELECT COUNT(*) n FROM core_links").get().n === 0) {
    const ins = db.prepare("INSERT INTO core_links (odc_id, odc_core, odp_id, odp_core, notes) VALUES (?,?,?,?,?)");
    ins.run(odc1.id, 1, odp1.id, 1, "Closure Perempatan");
    ins.run(odc1.id, 2, odp1.id, 2, null);
  }
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PASSWORD_HASH_PREFIX = "scrypt";
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(password), salt, 64).toString("hex");
  return `${PASSWORD_HASH_PREFIX}$${salt}$${derived}`;
}
function secretMatches(actual, expected) {
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length === 3 && parts[0] === PASSWORD_HASH_PREFIX) {
    const [, salt, expected] = parts;
    if (!/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(expected)) return false;
    const actual = crypto.scryptSync(String(password), salt, 64).toString("hex");
    return secretMatches(actual, expected);
  }
  // Hash SHA-256 tanpa salt dari versi lama: verifikasi sekali lalu migrasikan
  // ke scrypt saat login berhasil, tanpa memaksa reset password pengguna.
  const legacy = crypto.createHash("sha256").update(String(password)).digest("hex");
  return /^[a-f0-9]{64}$/.test(stored) && secretMatches(legacy, stored);
}
const now = () => new Date().toISOString();
const CORE_STATUSES = new Set(["idle", "used", "reserved", "damaged"]);
const PORT_STATUSES = new Set(["active", "inactive", "reserved", "damaged"]);
const USER_ROLES = new Set(["admin", "operator", "user"]);
const validPositiveInt = (value) => {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n > 0;
};
const validIntRange = (value, min, max) => validPositiveInt(value) && Number(value) >= min && Number(value) <= max;
const cableInfo = (type) => CABLE_TYPES.find((c) => c.value === type) ?? null;
const isText = (value) => typeof value === "string" && value.trim().length > 0;
const isOptionalText = (value) => value == null || typeof value === "string";
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const httpError = (status, message) => Object.assign(new Error(message), { status });

// Validasi daftar port feeder ODC: boleh banyak, tetapi harus milik OLT induk ODC
function checkFeederPorts(oltId, ids) {
  if (!validPositiveInt(oltId)) return "OLT tidak valid";
  const olt = db.prepare("SELECT name FROM olts WHERE id=?").get(Number(oltId));
  if (!olt) return `OLT #${oltId} tidak ditemukan`;
  if (ids == null) return null;
  if (!Array.isArray(ids)) return "Daftar port feeder harus berupa array";
  if (!ids.every(validPositiveInt)) return "Setiap port feeder harus memiliki ID bilangan bulat positif";
  for (const raw of ids) {
    const row = db.prepare(
      "SELECT c.olt_id FROM olt_ports p JOIN olt_cards c ON c.id=p.card_id WHERE p.id=?",
    ).get(Number(raw));
    if (!row) return `Port feeder id ${raw} tidak ditemukan`;
    if (row.olt_id !== Number(oltId)) {
      return `Port feeder harus milik OLT induk ODC (${olt.name})`;
    }
  }
  return null;
}
// Rasio splitter yang sah = rasio yang ditawarkan aplikasi (satu sumber kebenaran),
// supaya tidak ada splitter yang redamannya tidak bisa dihitung anggaran dayanya.
const ratioSah = (ratio) => SPLITTER_RATIOS.includes(String(ratio ?? "").trim());
const splitterPorts = (ratio) => (ratioSah(ratio) ? Number(String(ratio).split(":")[1]) : 0);
const SPLITTER_SQL = `SELECT s.*, d.name AS odc_name, p.name AS odp_name
  FROM splitters s LEFT JOIN odcs d ON d.id = s.odc_id LEFT JOIN odps p ON p.id = s.odp_id`;
const SPLITTER_OUT_SQL = `SELECT o.*,
    CASE WHEN o.target_odp_id IS NOT NULL THEN 'odp'
         WHEN o.target_odc_id IS NOT NULL THEN 'odc'
         WHEN o.target_splitter_id IS NOT NULL THEN 'splitter' ELSE NULL END AS target_type,
    od.name AS target_odp_name, ts.name AS target_splitter_name, tod.name AS target_odc_name
  FROM splitter_outputs o
  LEFT JOIN odps od ON od.id = o.target_odp_id
  LEFT JOIN splitters ts ON ts.id = o.target_splitter_id
  LEFT JOIN odcs tod ON tod.id = o.target_odc_id
  WHERE o.splitter_id = ? ORDER BY o.port`;
function getSplitter(id) {
  const row = db.prepare(SPLITTER_SQL + " WHERE s.id=?").get(id);
  if (!row) return null;
  return { ...row, outputs: db.prepare(SPLITTER_OUT_SQL).all(id) };
}
function syncSplitterPorts(splitterId, ratio) {
  const n = splitterPorts(ratio);
  db.prepare("DELETE FROM splitter_outputs WHERE splitter_id=? AND port>?").run(splitterId, n);
  const ins = db.prepare("INSERT OR IGNORE INTO splitter_outputs (splitter_id, port) VALUES (?,?)");
  for (let i = 1; i <= n; i++) ins.run(splitterId, i);
  return n;
}

// Induk ODC (bila ODC ini diumpan dari output splitter ODC lain)
const odcParentId = (childId) =>
  db.prepare(`
    SELECT s.odc_id AS parent FROM splitter_outputs o
    JOIN splitters s ON s.id = o.splitter_id
    WHERE o.target_odc_id = ? LIMIT 1`).get(Number(childId))?.parent ?? null;

// Apakah `ancestorId` ada di rantai atas dari `nodeId` (dipakai cegah lingkaran)
function odcIsAncestor(ancestorId, nodeId) {
  let cur = Number(nodeId);
  const visited = new Set();
  while (cur && !visited.has(cur)) {
    if (cur === Number(ancestorId)) return true;
    visited.add(cur);
    cur = odcParentId(cur);
  }
  return false;
}

// Cascade splitter harus tetap berupa pohon: menautkan A → B ditolak bila
// B sudah dapat mencapai A melalui salah satu output cascade.
function splitterReaches(startId, targetId) {
  const target = Number(targetId);
  const stack = [Number(startId)];
  const visited = new Set();
  while (stack.length) {
    const id = stack.pop();
    if (id === target) return true;
    if (visited.has(id)) continue;
    visited.add(id);
    const next = db.prepare(
      "SELECT target_splitter_id FROM splitter_outputs WHERE splitter_id=? AND target_type='splitter' AND target_splitter_id IS NOT NULL",
    ).all(id);
    next.forEach((row) => stack.push(Number(row.target_splitter_id)));
  }
  return false;
}

function syncFeederPorts(odcId, ids) {
  db.prepare("DELETE FROM odc_feeder_ports WHERE odc_id=?").run(odcId);
  const ins = db.prepare("INSERT OR IGNORE INTO odc_feeder_ports (odc_id, port_id) VALUES (?,?)");
  for (const raw of ids || []) ins.run(odcId, Number(raw));
}

function send(req, res, status, body, extraHeaders = {}) {
  if (res.headersSent || res.destroyed) return;
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  res.writeHead(status, headers);
  const safeUrl = req.url.replace(/([?&]token=)[^&]+/g, "$1***");
  console.log(`[arena-api] ${req.method} ${safeUrl} -> ${status}${req.authVia ? ` (auth:${req.authVia})` : ""}`);
  res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const fail = (status, message) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      reject(httpError(status, message));
    };

    req.on("data", (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > 1e6) return fail(413, "Body terlalu besar");
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      if (size === 0) return resolve({});
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reject(httpError(400, "JSON tidak valid"));
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return reject(httpError(400, "Body harus berupa objek JSON"));
      }
      resolve(body);
    });
    req.on("error", (error) => fail(400, error.message || "Request body gagal dibaca"));
    req.on("aborted", () => fail(400, "Request body terputus"));
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers["cookie"] || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1) {
      const key = part.slice(0, i).trim();
      const value = part.slice(i + 1).trim();
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        // Cookie rusak tidak boleh mengubah permintaan biasa menjadi 500.
        out[key] = null;
      }
    }
  }
  return out;
}

function authUser(req, url) {
  const header = req.headers["authorization"] || "";
  const cookieToken = parseCookies(req)["fiberops_token"];
  let token = null;
  req.authVia = null;
  if (header.startsWith("Bearer ")) {
    token = header.slice(7);
    req.authVia = "header";
  } else if (cookieToken) {
    token = cookieToken;
    req.authVia = "cookie";
  } else if (url && url.searchParams.get("token")) {
    token = url.searchParams.get("token");
    req.authVia = "param";
  }
  if (!token) return null;
  const row = db
    .prepare(
      "SELECT u.id, u.email, u.full_name, u.role FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
    )
    .get(token);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Seed data demo (hanya saat database masih kosong)
// ---------------------------------------------------------------------------
function seedIfEmpty() {
  const { n } = db.prepare("SELECT COUNT(*) AS n FROM users").get();
  if (n > 0) return;

  const ts = now();
  const insUser = db.prepare(
    "INSERT INTO users (email, password_hash, full_name, role, created_at) VALUES (?,?,?,?,?)",
  );
  insUser.run("admin@arena.test", hashPassword("Arena123!"), "Admin Arena", "admin", ts);
  insUser.run("operator@arena.test", hashPassword("Arena123!"), "Operator Demo", "operator", ts);

  const insOlt = db.prepare(
    "INSERT INTO olts (name, olt_type, location, ip, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  const olt1 = insOlt.run("OLT-PST-01", "ZTE C320", "Data Center Pusat", "10.10.0.1", "OLT utama", ts, ts).lastInsertRowid;
  const olt2 = insOlt.run("OLT-EDGE-02", "Huawei MA5800", "POP Timur", "10.10.0.2", null, ts, ts).lastInsertRowid;

  const insCard = db.prepare(
    "INSERT INTO olt_cards (olt_id, slot, card_type, label, port_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  const card1 = insCard.run(olt1, 1, "GTGO", "GTGO-A", 8, ts, ts).lastInsertRowid;
  const card2 = insCard.run(olt1, 2, "GTGH", "GTGH-B", 16, ts, ts).lastInsertRowid;
  const card3 = insCard.run(olt2, 1, "GPFA", null, 8, ts, ts).lastInsertRowid;

  const insPort = db.prepare(
    "INSERT INTO olt_ports (card_id, port, sfp, serial, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  const p1 = insPort.run(card1, 1, "XGS-PON", "ZTE23A0001", "active", "Feeder ODC-001", ts, ts).lastInsertRowid;
  const p2 = insPort.run(card1, 2, "XGS-PON", "ZTE23A0002", "active", null, ts, ts).lastInsertRowid;
  insPort.run(card1, 3, null, null, "inactive", null, ts, ts);
  insPort.run(card2, 1, "GPON", "ZTE23B0001", "active", null, ts, ts);
  insPort.run(card2, 2, null, null, "reserved", "Rencana ODC-003", ts, ts);
  const p6 = insPort.run(card3, 1, "GPON", "HW23C0001", "active", "Feeder ODC-002", ts, ts).lastInsertRowid;

  const insOdc = db.prepare(
    "INSERT INTO odcs (olt_id, name, location, cable_type, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  const odc1 = insOdc.run(olt1, "ODC-001", "Perempatan Kota", "24_core_4_tube", "Closure utama", ts, ts).lastInsertRowid;
  const odc2 = insOdc.run(olt2, "ODC-002", "Kawasan Industri", "48_core_8_tube", null, ts, ts).lastInsertRowid;
  const odc3 = insOdc.run(olt1, "ODC-003", "Dusun Kenanga (anak ODC-001)", "12_core_2_tube", "ODC anak dari ODC-001", ts, ts).lastInsertRowid;

  const insOdp = db.prepare(
    "INSERT INTO odps (odc_id, name, location, cable_type, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  const odp1 = insOdp.run(odc1, "ODP-001", "Jl. Melati RT 03", "12_core_2_tube", null, ts, ts).lastInsertRowid;
  const odp2 = insOdp.run(odc2, "ODP-002", "Perum Griya Asri", "24_core_2_tube", null, ts, ts).lastInsertRowid;
  const odp3 = insOdp.run(odc1, "ODP-003", "Jl. Kenanga", "12_core_2_tube", null, ts, ts).lastInsertRowid;
  const odp4 = insOdp.run(odc3, "ODP-004", "Dusun Kenanga RT 02", "12_core_2_tube", null, ts, ts).lastInsertRowid;

  const FIBER_COLORS = ["Biru","Jingga","Hijau","Coklat","Abu-abu","Putih","Merah","Hitam","Kuning","Ungu","Pink","Aqua"];
  const insCore = db.prepare(
    "INSERT INTO core_assignments (source, odc_id, odp_id, core, status, destination, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  const core = (source, odcId, odpId, n, status, destination = null) =>
    insCore.run(source, odcId, odpId, n, status, destination, ts, ts);

  core("olt_to_odc", odc1, null, 1, "used", "ODC-001");
  core("olt_to_odc", odc1, null, 2, "used", "ODC-001");
  core("olt_to_odc", odc1, null, 3, "reserved", "ODC-001");
  core("olt_to_odc", odc1, null, 4, "idle");
  core("olt_to_odc", odc1, null, 5, "idle");
  core("olt_to_odc", odc1, null, 6, "damaged", "ODC-001");
  core("olt_to_odc", odc2, null, 1, "used", "ODC-002");
  core("olt_to_odc", odc2, null, 2, "idle");
  core("odc_to_odp", null, odp1, 1, "used", "ODP-001");
  core("odc_to_odp", null, odp1, 2, "used", "ODP-001");
  core("odc_to_odp", null, odp1, 3, "idle");
  core("odc_to_odp", null, odp2, 1, "idle");
  core("odc_to_odp", null, odp3, 1, "used", "ODP-003");
  core("odc_to_odp", null, odp3, 2, "idle");
  core("odc_to_odp", null, odp4, 1, "used", "ODP-004");

  // Sambungan core end-to-end (mapping ODC core <-> ODP core)
  const insLink = db.prepare(
    "INSERT INTO core_links (odc_id, odc_core, odp_id, odp_core, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  insLink.run(odc1, 1, odp1, 1, "Closure Perempatan", ts, ts);
  insLink.run(odc1, 2, odp1, 2, null, ts, ts);

  // Port feeder ODC — satu ODC boleh beberapa port (contoh: ODC-001 memakai 2 port)
  const insFeeder = db.prepare("INSERT OR IGNORE INTO odc_feeder_ports (odc_id, port_id) VALUES (?,?)");
  insFeeder.run(odc1, p1);
  insFeeder.run(odc1, p2);
  insFeeder.run(odc2, p6);

  // Splitter bertingkat sesuai logika lapangan:
  //   OLT → ODC: SPL-1 (1:4) ─cascade─ SPL-2 (1:8)  [keduanya DI DALAM ODC]
  //   keluaran SPL-2 → ODP-001 & ODP-003 (masing-masing berisi SPL 1:8),
  //   dan satu cabang → ODC-003 (ODC anak) yang di dalamnya ada SPL-3 (1:8) → ODP-004
  const insSplitter = db.prepare(
    "INSERT INTO splitters (odc_id, odp_id, name, ratio, input_core, input_note, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const insOut = db.prepare("INSERT INTO splitter_outputs (splitter_id, port) VALUES (?,?)");
  const addPorts = (id, n) => { for (let i = 1; i <= n; i++) insOut.run(id, i); };
  const setOut = (splitterId, port, odp = null, spl = null, odc = null) =>
    db.prepare("UPDATE splitter_outputs SET target_type=?, target_odp_id=?, target_splitter_id=?, target_odc_id=? WHERE splitter_id=? AND port=?")
      .run(odc ? "odc" : odp ? "odp" : spl ? "splitter" : null, odp, spl, odc, splitterId, port);

  const spl1 = insSplitter.run(odc1, null, "SPL-1", "1:4", 1, "Core 1 dari OLT", "Splitter utama ODC", ts, ts).lastInsertRowid;
  const spl2 = insSplitter.run(odc1, null, "SPL-2", "1:8", null, "Cascade dari SPL-1 output 1", "Splitter tahap 2", ts, ts).lastInsertRowid;
  const spl3 = insSplitter.run(odc3, null, "SPL-3", "1:8", 1, "Cabang dari ODC-001", "Splitter di ODC anak", ts, ts).lastInsertRowid;
  const splOdp1 = insSplitter.run(null, odp1, "SPL-ODP1", "1:8", 1, "Core 1 dari ODC-001", null, ts, ts).lastInsertRowid;
  const splOdp3 = insSplitter.run(null, odp3, "SPL-ODP3", "1:8", 1, "Core 1 dari ODC-001", null, ts, ts).lastInsertRowid;
  addPorts(spl1, 4); addPorts(spl2, 8); addPorts(spl3, 8);
  addPorts(splOdp1, 8); addPorts(splOdp3, 8);
  setOut(spl1, 1, null, spl2);    // cascade 1:4 → 1:8 (dua tingkat di dalam ODC)
  setOut(spl2, 1, odp1);          // 1:8 → ODP-001 (di dalamnya SPL 1:8)
  setOut(spl2, 2, odp3);          // 1:8 → ODP-003 (di dalamnya SPL 1:8)
  setOut(spl2, 3, null, null, odc3); // 1:8 → ODC-003 (ODC anak)
  setOut(spl3, 1, odp4);          // di ODC anak: 1:8 → ODP-004 (tanpa splitter tambahan)

  console.log("[arena-api] Database di-seed dengan data demo. Login: admin@arena.test / Arena123!");
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;
  const method = req.method;

  try {
    if (p === "/healthz") return send(req, res, 200, { ok: true, service: "fiberops-arena-api" });

    // ---------------- Login (tanpa auth) ----------------
    if (p === "/api/login" && method === "POST") {
      const body = await readBody(req);
      const user = db.prepare("SELECT * FROM users WHERE email = ?").get(String(body.email || "").toLowerCase().trim());
      const password = String(body.password || "");
      if (!user || !verifyPassword(password, user.password_hash)) {
        return send(req, res, 401, { error: "Email atau password salah" });
      }
      if (!user.password_hash.startsWith(`${PASSWORD_HASH_PREFIX}$`)) {
        db.prepare("UPDATE users SET password_hash=? WHERE id=?").run(hashPassword(password), user.id);
      }
      const token = crypto.randomBytes(24).toString("base64url");
      db.prepare("INSERT INTO sessions (token, user_id) VALUES (?,?)").run(token, user.id);
      return send(
        req,
        res,
        200,
        { token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } },
        { "Set-Cookie": `fiberops_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800` },
      );
    }

    if (!p.startsWith("/api/")) return serveStatic(req, res, p);

    // ---------------- Semua /api/* di bawah ini butuh login ----------------
    const user = authUser(req, url);
    if (!user) return send(req, res, 401, { error: "Silakan login terlebih dahulu" });

    if (p === "/api/logout" && method === "POST") {
      const user0 = authUser(req, url);
      if (user0) {
        const header = req.headers["authorization"] || "";
        const token = header.startsWith("Bearer ")
          ? header.slice(7)
          : parseCookies(req)["fiberops_token"] || url.searchParams.get("token");
        if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
      }
      return send(req, res, 200, { ok: true }, { "Set-Cookie": "fiberops_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
    }

    if (p === "/api/me" && method === "GET") return send(req, res, 200, { user });

    const canWrite = user.role === "admin" || user.role === "operator";
    const isAdmin = user.role === "admin";
    if (method !== "GET" && !canWrite) {
      return send(req, res, 403, { error: "Hanya admin/operator yang dapat mengubah data" });
    }

    // ---------------- Dashboard ----------------
    if (p === "/api/dashboard" && method === "GET") {
      const c = (sql) => db.prepare(sql).get().n;
      const cores = db.prepare("SELECT status, COUNT(*) AS n FROM core_assignments GROUP BY status").all();
      const byStatus = Object.fromEntries(cores.map((r) => [r.status, r.n]));
      return send(req, res, 200, {
        olts: c("SELECT COUNT(*) n FROM olts"),
        cards: c("SELECT COUNT(*) n FROM olt_cards"),
        ports: c("SELECT COUNT(*) n FROM olt_ports"),
        portsActive: c("SELECT COUNT(*) n FROM olt_ports WHERE status='active'"),
        odcs: c("SELECT COUNT(*) n FROM odcs"),
        odps: c("SELECT COUNT(*) n FROM odps"),
        cores: c("SELECT COUNT(*) n FROM core_assignments"),
        links: c("SELECT COUNT(*) n FROM core_links"),
        splitters: c("SELECT COUNT(*) n FROM splitters"),
        coresUsed: byStatus.used ?? 0,
        coresIdle: byStatus.idle ?? 0,
        coresReserved: byStatus.reserved ?? 0,
        coresDamaged: byStatus.damaged ?? 0,
      });
    }

    // ---------------- OLT ----------------
    if (p === "/api/olts" && method === "GET") {
      const rows = db.prepare("SELECT o.*, (SELECT COUNT(*) FROM olt_cards c WHERE c.olt_id=o.id) AS card_count, (SELECT COUNT(*) FROM odcs d WHERE d.olt_id=o.id) AS odc_count FROM olts o ORDER BY o.name").all();
      return send(req, res, 200, rows);
    }
    if (p === "/api/olts" && method === "POST") {
      const b = await readBody(req);
      if (!isText(b.name)) return send(req, res, 400, { error: "Nama OLT wajib diisi" });
      if ([b.olt_type, b.location, b.ip, b.notes].some((v) => !isOptionalText(v))) {
        return send(req, res, 400, { error: "Tipe, lokasi, IP, dan catatan harus berupa teks" });
      }
      const r = db.prepare("INSERT INTO olts (name, olt_type, location, ip, notes) VALUES (?,?,?,?,?)")
        .run(b.name.trim(), b.olt_type || null, b.location || null, b.ip || null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM olts WHERE id=?").get(r.lastInsertRowid));
    }
    let m = p.match(/^\/api\/olts\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const body = await readBody(req);
        const current = db.prepare("SELECT * FROM olts WHERE id=?").get(id);
        if (!current) return send(req, res, 404, { error: "OLT tidak ditemukan" });
        const b = { ...current, ...body };
        if (!isText(b.name)) return send(req, res, 400, { error: "Nama OLT wajib diisi" });
        if ([b.olt_type, b.location, b.ip, b.notes].some((v) => !isOptionalText(v))) {
          return send(req, res, 400, { error: "Tipe, lokasi, IP, dan catatan harus berupa teks" });
        }
        db.prepare("UPDATE olts SET name=?, olt_type=?, location=?, ip=?, notes=?, updated_at=? WHERE id=?")
          .run(b.name.trim(), b.olt_type || null, b.location || null, b.ip || null, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM olts WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        const result = db.prepare("DELETE FROM olts WHERE id=?").run(id);
        if (!result.changes) return send(req, res, 404, { error: "OLT tidak ditemukan" });
        return send(req, res, 200, { ok: true });
      }
    }

    // ---------------- Card OLT ----------------
    if (p === "/api/cards" && method === "GET") {
      const oltId = url.searchParams.get("olt_id");
      const rows = oltId
        ? db.prepare("SELECT * FROM olt_cards WHERE olt_id=? ORDER BY slot").all(Number(oltId))
        : db.prepare("SELECT * FROM olt_cards ORDER BY olt_id, slot").all();
      return send(req, res, 200, rows);
    }
    if (p === "/api/cards" && method === "POST") {
      const b = await readBody(req);
      const portCount = b.port_count ?? 8;
      const cardType = b.card_type ?? "OTHER";
      if (!validPositiveInt(b.olt_id) || !validIntRange(b.slot, 1, 256)) {
        return send(req, res, 400, { error: "OLT dan nomor slot yang valid wajib diisi" });
      }
      if (!db.prepare("SELECT id FROM olts WHERE id=?").get(Number(b.olt_id))) {
        return send(req, res, 400, { error: "OLT tidak ditemukan" });
      }
      if (!validIntRange(portCount, 1, 32)) return send(req, res, 400, { error: "Jumlah port card harus antara 1 dan 32" });
      if (!isText(cardType) || !isOptionalText(b.label) || !isOptionalText(b.notes)) {
        return send(req, res, 400, { error: "Tipe card, label, dan catatan harus berupa teks" });
      }
      if (db.prepare("SELECT id FROM olt_cards WHERE olt_id=? AND slot=?").get(Number(b.olt_id), Number(b.slot))) {
        return send(req, res, 409, { error: `Slot ${b.slot} sudah dipakai pada OLT ini` });
      }
      const r = db.prepare("INSERT INTO olt_cards (olt_id, slot, card_type, label, port_count, notes) VALUES (?,?,?,?,?,?)")
        .run(Number(b.olt_id), Number(b.slot), cardType.trim(), b.label || null, Number(portCount), b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM olt_cards WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/cards\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const body = await readBody(req);
        const current = db.prepare("SELECT * FROM olt_cards WHERE id=?").get(id);
        if (!current) return send(req, res, 404, { error: "Card tidak ditemukan" });
        const b = { ...current, ...body };
        if (!validIntRange(b.slot, 1, 256)) return send(req, res, 400, { error: "Nomor slot harus bilangan bulat antara 1 dan 256" });
        if (!validIntRange(b.port_count, 1, 32)) return send(req, res, 400, { error: "Jumlah port card harus antara 1 dan 32" });
        if (!isText(b.card_type) || !isOptionalText(b.label) || !isOptionalText(b.notes)) {
          return send(req, res, 400, { error: "Tipe card, label, dan catatan harus berupa teks" });
        }
        if (db.prepare("SELECT id FROM olt_cards WHERE olt_id=? AND slot=? AND id<>?").get(current.olt_id, Number(b.slot), id)) {
          return send(req, res, 409, { error: `Slot ${b.slot} sudah dipakai pada OLT ini` });
        }
        const maxPort = db.prepare("SELECT MAX(port) AS n FROM olt_ports WHERE card_id=?").get(id)?.n;
        if (maxPort != null && maxPort > Number(b.port_count)) {
          return send(req, res, 400, { error: `Hapus atau pindahkan port ${maxPort} sebelum mengurangi jumlah port card` });
        }
        db.prepare("UPDATE olt_cards SET slot=?, card_type=?, label=?, port_count=?, notes=?, updated_at=? WHERE id=?")
          .run(Number(b.slot), b.card_type.trim(), b.label || null, Number(b.port_count), b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM olt_cards WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        const result = db.prepare("DELETE FROM olt_cards WHERE id=?").run(id);
        if (!result.changes) return send(req, res, 404, { error: "Card tidak ditemukan" });
        return send(req, res, 200, { ok: true });
      }
    }

    // ---------------- Port OLT ----------------
    if (p === "/api/ports" && method === "GET") {
      const cardId = url.searchParams.get("card_id");
      const rows = cardId
        ? db.prepare("SELECT * FROM olt_ports WHERE card_id=? ORDER BY port").all(Number(cardId))
        : db.prepare(`
            SELECT p.*, c.slot, c.label AS card_label, c.olt_id, o.name AS olt_name
            FROM olt_ports p JOIN olt_cards c ON c.id=p.card_id JOIN olts o ON o.id=c.olt_id
            ORDER BY p.card_id, p.port`).all();
      return send(req, res, 200, rows);
    }
    if (p === "/api/ports" && method === "POST") {
      const b = await readBody(req);
      if (!validPositiveInt(b.card_id)) return send(req, res, 400, { error: "Card tidak valid" });
      const card = db.prepare("SELECT port_count FROM olt_cards WHERE id=?").get(Number(b.card_id));
      if (!card) return send(req, res, 400, { error: "Card tidak ditemukan" });
      if (!validIntRange(b.port, 1, Number(card.port_count))) {
        return send(req, res, 400, { error: `Nomor port harus antara 1 dan ${card.port_count}` });
      }
      const status = b.status ?? "inactive";
      if (!PORT_STATUSES.has(status)) return send(req, res, 400, { error: "Status port tidak valid" });
      if ([b.sfp, b.serial, b.notes].some((v) => !isOptionalText(v))) {
        return send(req, res, 400, { error: "SFP, serial, dan catatan harus berupa teks" });
      }
      if (db.prepare("SELECT id FROM olt_ports WHERE card_id=? AND port=?").get(Number(b.card_id), Number(b.port))) {
        return send(req, res, 409, { error: `Port ${b.port} sudah tercatat pada card ini` });
      }
      const r = db.prepare("INSERT INTO olt_ports (card_id, port, sfp, serial, status, notes) VALUES (?,?,?,?,?,?)")
        .run(Number(b.card_id), Number(b.port), b.sfp || null, b.serial || null, status, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM olt_ports WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/ports\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const body = await readBody(req);
        const current = db.prepare("SELECT * FROM olt_ports WHERE id=?").get(id);
        if (!current) return send(req, res, 404, { error: "Port tidak ditemukan" });
        const b = { ...current, ...body };
        const card = db.prepare("SELECT port_count FROM olt_cards WHERE id=?").get(current.card_id);
        if (!card || !validIntRange(b.port, 1, Number(card.port_count))) {
          return send(req, res, 400, { error: `Nomor port harus antara 1 dan ${card?.port_count ?? 0}` });
        }
        if (!PORT_STATUSES.has(b.status)) return send(req, res, 400, { error: "Status port tidak valid" });
        if ([b.sfp, b.serial, b.notes].some((v) => !isOptionalText(v))) {
          return send(req, res, 400, { error: "SFP, serial, dan catatan harus berupa teks" });
        }
        if (db.prepare("SELECT id FROM olt_ports WHERE card_id=? AND port=? AND id<>?").get(current.card_id, Number(b.port), id)) {
          return send(req, res, 409, { error: `Port ${b.port} sudah tercatat pada card ini` });
        }
        db.prepare("UPDATE olt_ports SET port=?, sfp=?, serial=?, status=?, notes=?, updated_at=? WHERE id=?")
          .run(Number(b.port), b.sfp || null, b.serial || null, b.status, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM olt_ports WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        const result = db.prepare("DELETE FROM olt_ports WHERE id=?").run(id);
        if (!result.changes) return send(req, res, 404, { error: "Port tidak ditemukan" });
        return send(req, res, 200, { ok: true });
      }
    }

    // ---------------- ODC ----------------
    if (p === "/api/odcs" && method === "GET") {
      const rows = db.prepare(`
        SELECT d.*, o.name AS olt_name,
          (SELECT COUNT(*) FROM odps p WHERE p.odc_id=d.id) AS odp_count,
          (SELECT COUNT(*) FROM core_assignments ca WHERE ca.odc_id=d.id AND ca.source='olt_to_odc') AS core_count,
          (SELECT COUNT(*) FROM odc_feeder_ports fp WHERE fp.odc_id=d.id) AS feeder_count
        FROM odcs d JOIN olts o ON o.id=d.olt_id ORDER BY d.name`).all();
      return send(req, res, 200, rows);
    }
    if (p === "/api/odcs" && method === "POST") {
      const b = await readBody(req);
      if (!isText(b.name) || !validPositiveInt(b.olt_id) || !cableInfo(b.cable_type)) {
        return send(req, res, 400, { error: "Nama, OLT, dan tipe kabel yang valid wajib diisi" });
      }
      if (!isOptionalText(b.location) || !isOptionalText(b.notes)) {
        return send(req, res, 400, { error: "Lokasi dan catatan harus berupa teks" });
      }
      const feederIds = b.feeder_port_ids ?? [];
      const badFeeder = checkFeederPorts(b.olt_id, feederIds);
      if (badFeeder) return send(req, res, 400, { error: badFeeder });
      const r = db.prepare("INSERT INTO odcs (olt_id, name, location, cable_type, notes) VALUES (?,?,?,?,?)")
        .run(Number(b.olt_id), b.name.trim(), b.location || null, b.cable_type, b.notes || null);
      syncFeederPorts(r.lastInsertRowid, feederIds);
      return send(req, res, 201, db.prepare("SELECT * FROM odcs WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/odcs\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const body = await readBody(req);
        const current = db.prepare("SELECT * FROM odcs WHERE id=?").get(id);
        if (!current) return send(req, res, 404, { error: "ODC tidak ditemukan" });
        const b = { ...current, ...body };
        if (!isText(b.name) || !validPositiveInt(b.olt_id) || !cableInfo(b.cable_type)) {
          return send(req, res, 400, { error: "Nama, OLT, dan tipe kabel yang valid wajib diisi" });
        }
        if (!isOptionalText(b.location) || !isOptionalText(b.notes)) {
          return send(req, res, 400, { error: "Lokasi dan catatan harus berupa teks" });
        }
        const feederIds = hasOwn(body, "feeder_port_ids")
          ? body.feeder_port_ids
          : db.prepare("SELECT port_id FROM odc_feeder_ports WHERE odc_id=? ORDER BY id").all(id).map((row) => row.port_id);
        const badFeeder = checkFeederPorts(b.olt_id, feederIds);
        if (badFeeder) return send(req, res, 400, { error: badFeeder });
        const capacity = cableInfo(b.cable_type).cores;
        const hasOutOfRangeCore =
          db.prepare("SELECT id FROM core_assignments WHERE source='olt_to_odc' AND odc_id=? AND core>? LIMIT 1").get(id, capacity) ||
          db.prepare("SELECT id FROM core_links WHERE odc_id=? AND odc_core>? LIMIT 1").get(id, capacity) ||
          db.prepare("SELECT id FROM splitters WHERE odc_id=? AND input_core>? LIMIT 1").get(id, capacity);
        if (hasOutOfRangeCore) {
          return send(req, res, 400, { error: `Tipe kabel baru memiliki ${capacity} core; hapus atau sesuaikan assignment, mapping, dan input splitter di atasnya lebih dahulu` });
        }
        db.prepare("UPDATE odcs SET olt_id=?, name=?, location=?, cable_type=?, notes=?, updated_at=? WHERE id=?")
          .run(Number(b.olt_id), b.name.trim(), b.location || null, b.cable_type, b.notes || null, now(), id);
        if (hasOwn(body, "feeder_port_ids") || Number(b.olt_id) !== current.olt_id) syncFeederPorts(id, feederIds);
        return send(req, res, 200, db.prepare("SELECT * FROM odcs WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        const result = db.prepare("DELETE FROM odcs WHERE id=?").run(id);
        if (!result.changes) return send(req, res, 404, { error: "ODC tidak ditemukan" });
        return send(req, res, 200, { ok: true });
      }
    }

    // ---------------- ODP ----------------
    if (p === "/api/odps" && method === "GET") {
      const rows = db.prepare(`
        SELECT p.*, d.name AS odc_name,
          (SELECT COUNT(*) FROM core_assignments ca WHERE ca.odp_id=p.id AND ca.source='odc_to_odp') AS core_count
        FROM odps p JOIN odcs d ON d.id=p.odc_id ORDER BY p.name`).all();
      return send(req, res, 200, rows);
    }
    if (p === "/api/odps" && method === "POST") {
      const b = await readBody(req);
      if (!isText(b.name) || !validPositiveInt(b.odc_id) || !cableInfo(b.cable_type)) {
        return send(req, res, 400, { error: "Nama, ODC, dan tipe kabel yang valid wajib diisi" });
      }
      if (!isOptionalText(b.location) || !isOptionalText(b.notes)) {
        return send(req, res, 400, { error: "Lokasi dan catatan harus berupa teks" });
      }
      if (!db.prepare("SELECT id FROM odcs WHERE id=?").get(Number(b.odc_id))) {
        return send(req, res, 400, { error: "ODC tidak ditemukan" });
      }
      const r = db.prepare("INSERT INTO odps (odc_id, name, location, cable_type, notes) VALUES (?,?,?,?,?)")
        .run(Number(b.odc_id), b.name.trim(), b.location || null, b.cable_type, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM odps WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/odps\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const body = await readBody(req);
        const current = db.prepare("SELECT * FROM odps WHERE id=?").get(id);
        if (!current) return send(req, res, 404, { error: "ODP tidak ditemukan" });
        const b = { ...current, ...body };
        if (!isText(b.name) || !validPositiveInt(b.odc_id) || !cableInfo(b.cable_type)) {
          return send(req, res, 400, { error: "Nama, ODC, dan tipe kabel yang valid wajib diisi" });
        }
        if (!isOptionalText(b.location) || !isOptionalText(b.notes)) {
          return send(req, res, 400, { error: "Lokasi dan catatan harus berupa teks" });
        }
        if (!db.prepare("SELECT id FROM odcs WHERE id=?").get(Number(b.odc_id))) {
          return send(req, res, 400, { error: "ODC tidak ditemukan" });
        }
        if (Number(b.odc_id) !== current.odc_id && db.prepare("SELECT id FROM core_links WHERE odp_id=? LIMIT 1").get(id)) {
          return send(req, res, 400, { error: "Hapus atau buat ulang mapping core sebelum memindahkan ODP ke ODC lain" });
        }
        const capacity = cableInfo(b.cable_type).cores;
        const hasOutOfRangeCore =
          db.prepare("SELECT id FROM core_assignments WHERE source='odc_to_odp' AND odp_id=? AND core>? LIMIT 1").get(id, capacity) ||
          db.prepare("SELECT id FROM core_links WHERE odp_id=? AND odp_core>? LIMIT 1").get(id, capacity) ||
          db.prepare("SELECT id FROM splitters WHERE odp_id=? AND input_core>? LIMIT 1").get(id, capacity);
        if (hasOutOfRangeCore) {
          return send(req, res, 400, { error: `Tipe kabel baru memiliki ${capacity} core; hapus atau sesuaikan assignment, mapping, dan input splitter di atasnya lebih dahulu` });
        }
        db.prepare("UPDATE odps SET odc_id=?, name=?, location=?, cable_type=?, notes=?, updated_at=? WHERE id=?")
          .run(Number(b.odc_id), b.name.trim(), b.location || null, b.cable_type, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM odps WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        const result = db.prepare("DELETE FROM odps WHERE id=?").run(id);
        if (!result.changes) return send(req, res, 404, { error: "ODP tidak ditemukan" });
        return send(req, res, 200, { ok: true });
      }
    }

    // ---------------- Core assignments ----------------
    if (p === "/api/cores" && method === "GET") {
      const { source, odc_id, odp_id } = Object.fromEntries(url.searchParams);
      let rows;
      if (source === "olt_to_odc" && odc_id) {
        rows = db.prepare("SELECT * FROM core_assignments WHERE source='olt_to_odc' AND odc_id=? ORDER BY core").all(Number(odc_id));
      } else if (source === "odc_to_odp" && odp_id) {
        rows = db.prepare("SELECT * FROM core_assignments WHERE source='odc_to_odp' AND odp_id=? ORDER BY core").all(Number(odp_id));
      } else if (source === "odc_to_odp" && odc_id) {
        rows = db.prepare(`
          SELECT ca.*, pd.name AS odp_name
          FROM core_assignments ca JOIN odps pd ON pd.id = ca.odp_id
          WHERE ca.source='odc_to_odp' AND pd.odc_id=?
          ORDER BY pd.name, ca.core`).all(Number(odc_id));
      } else {
        rows = db.prepare("SELECT * FROM core_assignments ORDER BY source, core").all();
      }
      return send(req, res, 200, rows);
    }
    if (p === "/api/cores" && method === "POST") {
      const b = await readBody(req);
      if (!validPositiveInt(b.core) || !CORE_STATUSES.has(b.status ?? "idle")) {
        return send(req, res, 400, { error: "Nomor core atau status tidak valid" });
      }
      if (!isOptionalText(b.destination) || !isOptionalText(b.notes)) {
        return send(req, res, 400, { error: "Tujuan dan catatan harus berupa teks" });
      }
      let source;
      let parentId;
      let capacity;
      if (b.source === "olt_to_odc") {
        if (!validPositiveInt(b.odc_id) || (b.odp_id != null && b.odp_id !== "")) {
          return send(req, res, 400, { error: "Core feeder harus terhubung ke satu ODC saja" });
        }
        source = "olt_to_odc";
        parentId = Number(b.odc_id);
        const parent = db.prepare("SELECT cable_type FROM odcs WHERE id=?").get(parentId);
        if (!parent) return send(req, res, 400, { error: "ODC tidak ditemukan" });
        capacity = cableInfo(parent.cable_type)?.cores;
      } else if (b.source === "odc_to_odp") {
        if (!validPositiveInt(b.odp_id) || (b.odc_id != null && b.odc_id !== "")) {
          return send(req, res, 400, { error: "Core ODP harus terhubung ke satu ODP saja" });
        }
        source = "odc_to_odp";
        parentId = Number(b.odp_id);
        const parent = db.prepare("SELECT cable_type FROM odps WHERE id=?").get(parentId);
        if (!parent) return send(req, res, 400, { error: "ODP tidak ditemukan" });
        capacity = cableInfo(parent.cable_type)?.cores;
      } else {
        return send(req, res, 400, { error: "Sumber core tidak valid" });
      }
      if (!capacity || Number(b.core) > capacity) {
        return send(req, res, 400, { error: `Nomor core melebihi kapasitas kabel (${capacity ?? 0} core)` });
      }
      const duplicate = source === "olt_to_odc"
        ? db.prepare("SELECT id FROM core_assignments WHERE source=? AND odc_id=? AND core=?").get(source, parentId, Number(b.core))
        : db.prepare("SELECT id FROM core_assignments WHERE source=? AND odp_id=? AND core=?").get(source, parentId, Number(b.core));
      if (duplicate) return send(req, res, 409, { error: `Core ${b.core} sudah memiliki assignment` });
      const r = db.prepare("INSERT INTO core_assignments (source, odc_id, odp_id, core, status, destination, notes) VALUES (?,?,?,?,?,?,?)")
        .run(source, source === "olt_to_odc" ? parentId : null, source === "odc_to_odp" ? parentId : null, Number(b.core), b.status ?? "idle", b.destination || null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM core_assignments WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/cores\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const body = await readBody(req);
        const current = db.prepare("SELECT * FROM core_assignments WHERE id=?").get(id);
        if (!current) return send(req, res, 404, { error: "Assignment core tidak ditemukan" });
        const status = hasOwn(body, "status") ? body.status : current.status;
        const destination = hasOwn(body, "destination") ? body.destination : current.destination;
        const notes = hasOwn(body, "notes") ? body.notes : current.notes;
        if (!CORE_STATUSES.has(status)) return send(req, res, 400, { error: "Status core tidak valid" });
        if (!isOptionalText(destination) || !isOptionalText(notes)) {
          return send(req, res, 400, { error: "Tujuan dan catatan harus berupa teks" });
        }
        db.prepare("UPDATE core_assignments SET status=?, destination=?, notes=?, updated_at=? WHERE id=?")
          .run(status, destination || null, notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM core_assignments WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        const result = db.prepare("DELETE FROM core_assignments WHERE id=?").run(id);
        if (!result.changes) return send(req, res, 404, { error: "Assignment core tidak ditemukan" });
        return send(req, res, 200, { ok: true });
      }
    }

    // ---------------- Port feeder ODC (boleh banyak per ODC) ----------------
    if (p === "/api/feeder-ports" && method === "GET") {
      const odcId = url.searchParams.get("odc_id");
      const base = `
        SELECT fp.id, fp.odc_id, fp.port_id,
          o.id AS olt_id, o.name AS olt_name,
          c.slot, c.label AS card_label,
          pt.port, pt.sfp
        FROM odc_feeder_ports fp
        JOIN olt_ports pt ON pt.id = fp.port_id
        JOIN olt_cards c ON c.id = pt.card_id
        JOIN olts o ON o.id = c.olt_id`;
      const rows = odcId
        ? db.prepare(base + " WHERE fp.odc_id=? ORDER BY o.name, c.slot, pt.port").all(Number(odcId))
        : db.prepare(base + " ORDER BY fp.odc_id, o.name, c.slot, pt.port").all();
      return send(req, res, 200, rows);
    }

    // ---------------- Sambungan core (mapping ODC core <-> ODP core) ----------------
    if (p === "/api/links" && method === "GET") {
      const odcId = url.searchParams.get("odc_id");
      const rows = odcId
        ? db.prepare(`
            SELECT l.*, pd.name AS odp_name
            FROM core_links l JOIN odps pd ON pd.id = l.odp_id
            WHERE l.odc_id=? ORDER BY l.odc_core`).all(Number(odcId))
        : db.prepare(`
            SELECT l.*, d.name AS odc_name, pd.name AS odp_name
            FROM core_links l JOIN odcs d ON d.id=l.odc_id JOIN odps pd ON pd.id=l.odp_id
            ORDER BY d.name, l.odc_core`).all();
      return send(req, res, 200, rows);
    }
    if (p === "/api/links" && method === "POST") {
      const b = await readBody(req);
      if (!validPositiveInt(b.odc_id) || !validPositiveInt(b.odp_id) || !validPositiveInt(b.odc_core) || !validPositiveInt(b.odp_core)) {
        return send(req, res, 400, { error: "ODC, ODP, dan nomor core yang valid wajib diisi" });
      }
      if (!isOptionalText(b.notes)) return send(req, res, 400, { error: "Catatan harus berupa teks" });
      const odc = db.prepare("SELECT cable_type FROM odcs WHERE id=?").get(Number(b.odc_id));
      const odp = db.prepare("SELECT odc_id, cable_type FROM odps WHERE id=?").get(Number(b.odp_id));
      if (!odc) return send(req, res, 400, { error: "ODC tidak ditemukan" });
      if (!odp) return send(req, res, 400, { error: "ODP tidak ditemukan" });
      if (Number(odp.odc_id) !== Number(b.odc_id)) {
        return send(req, res, 400, { error: "ODP tujuan harus berada di bawah ODC yang dipilih" });
      }
      const odcCapacity = cableInfo(odc.cable_type)?.cores ?? 0;
      const odpCapacity = cableInfo(odp.cable_type)?.cores ?? 0;
      if (Number(b.odc_core) > odcCapacity || Number(b.odp_core) > odpCapacity) {
        return send(req, res, 400, { error: `Nomor core melebihi kapasitas kabel (ODC ${odcCapacity}, ODP ${odpCapacity})` });
      }
      if (db.prepare("SELECT id FROM core_links WHERE odc_id=? AND odc_core=?").get(Number(b.odc_id), Number(b.odc_core))) {
        return send(req, res, 409, { error: `Core ${b.odc_core} di ODC ini sudah tersambung ke ODP lain` });
      }
      if (db.prepare("SELECT id FROM core_links WHERE odp_id=? AND odp_core=?").get(Number(b.odp_id), Number(b.odp_core))) {
        return send(req, res, 409, { error: `Core ${b.odp_core} di ODP tersebut sudah terpakai sambungan lain` });
      }
      const r = db.prepare("INSERT INTO core_links (odc_id, odc_core, odp_id, odp_core, notes) VALUES (?,?,?,?,?)")
        .run(Number(b.odc_id), Number(b.odc_core), Number(b.odp_id), Number(b.odp_core), b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM core_links WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/links\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const body = await readBody(req);
        const current = db.prepare("SELECT * FROM core_links WHERE id=?").get(id);
        if (!current) return send(req, res, 404, { error: "Sambungan core tidak ditemukan" });
        const notes = hasOwn(body, "notes") ? body.notes : current.notes;
        if (!isOptionalText(notes)) return send(req, res, 400, { error: "Catatan harus berupa teks" });
        db.prepare("UPDATE core_links SET notes=?, updated_at=? WHERE id=?")
          .run(notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM core_links WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        const result = db.prepare("DELETE FROM core_links WHERE id=?").run(id);
        if (!result.changes) return send(req, res, 404, { error: "Sambungan core tidak ditemukan" });
        return send(req, res, 200, { ok: true });
      }
    }

    // ---------------- Splitter (boleh bertingkat/cascade, di ODC atau ODP) ----------------
    if (p === "/api/splitters" && method === "GET") {
      const { odc_id, odp_id } = Object.fromEntries(url.searchParams);
      let rows;
      if (odc_id) rows = db.prepare(SPLITTER_SQL + " WHERE s.odc_id=? ORDER BY s.name").all(Number(odc_id));
      else if (odp_id) rows = db.prepare(SPLITTER_SQL + " WHERE s.odp_id=? ORDER BY s.name").all(Number(odp_id));
      else rows = db.prepare(SPLITTER_SQL + " ORDER BY s.name").all();
      const outStmt = db.prepare(SPLITTER_OUT_SQL);
      return send(req, res, 200, rows.map((r) => ({ ...r, outputs: outStmt.all(r.id) })));
    }
    if (p === "/api/splitters" && method === "POST") {
      const b = await readBody(req);
      if (!isText(b.name) || !ratioSah(b.ratio)) {
        return send(req, res, 400, { error: `Nama dan rasio splitter valid wajib diisi — pilih: ${SPLITTER_RATIOS.join(", ")}` });
      }
      const hasOdc = b.odc_id != null && b.odc_id !== "";
      const hasOdp = b.odp_id != null && b.odp_id !== "";
      if (hasOdc === hasOdp) return send(req, res, 400, { error: "Splitter harus ditempatkan di tepat satu ODC atau ODP" });
      let parentId;
      let parentType;
      let capacity;
      if (hasOdc) {
        if (!validPositiveInt(b.odc_id)) return send(req, res, 400, { error: "ODC tidak valid" });
        parentId = Number(b.odc_id);
        parentType = "odc";
        capacity = cableInfo(db.prepare("SELECT cable_type FROM odcs WHERE id=?").get(parentId)?.cable_type)?.cores;
      } else {
        if (!validPositiveInt(b.odp_id)) return send(req, res, 400, { error: "ODP tidak valid" });
        parentId = Number(b.odp_id);
        parentType = "odp";
        capacity = cableInfo(db.prepare("SELECT cable_type FROM odps WHERE id=?").get(parentId)?.cable_type)?.cores;
      }
      if (!capacity) return send(req, res, 400, { error: `${parentType.toUpperCase()} tidak ditemukan atau tipe kabelnya tidak valid` });
      const inputCore = b.input_core == null || b.input_core === "" ? null : b.input_core;
      if (inputCore != null && !validIntRange(inputCore, 1, capacity)) {
        return send(req, res, 400, { error: `Input core harus antara 1 dan ${capacity}` });
      }
      if (!isOptionalText(b.input_note) || !isOptionalText(b.notes)) {
        return send(req, res, 400, { error: "Keterangan input dan catatan harus berupa teks" });
      }
      const r = db.prepare("INSERT INTO splitters (odc_id, odp_id, name, ratio, input_core, input_note, notes) VALUES (?,?,?,?,?,?,?)")
        .run(parentType === "odc" ? parentId : null, parentType === "odp" ? parentId : null, b.name.trim(), b.ratio, inputCore == null ? null : Number(inputCore), b.input_note || null, b.notes || null);
      syncSplitterPorts(r.lastInsertRowid, b.ratio);
      return send(req, res, 201, getSplitter(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/splitters\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const body = await readBody(req);
        const current = db.prepare("SELECT * FROM splitters WHERE id=?").get(id);
        if (!current) return send(req, res, 404, { error: "Splitter tidak ditemukan" });
        const b = { ...current, ...body };
        if (!isText(b.name) || !ratioSah(b.ratio)) {
          return send(req, res, 400, { error: `Nama dan rasio splitter valid wajib diisi — pilih: ${SPLITTER_RATIOS.join(", ")}` });
        }
        const inputCore = b.input_core == null || b.input_core === "" ? null : b.input_core;
        const parentCable = b.odc_id != null
          ? db.prepare("SELECT cable_type FROM odcs WHERE id=?").get(b.odc_id)?.cable_type
          : db.prepare("SELECT cable_type FROM odps WHERE id=?").get(b.odp_id)?.cable_type;
        const capacity = cableInfo(parentCable)?.cores;
        if (!capacity) return send(req, res, 400, { error: "Tipe kabel induk splitter tidak valid" });
        if (inputCore != null && !validIntRange(inputCore, 1, capacity)) {
          return send(req, res, 400, { error: `Input core harus antara 1 dan ${capacity}` });
        }
        if (!isOptionalText(b.input_note) || !isOptionalText(b.notes)) {
          return send(req, res, 400, { error: "Keterangan input dan catatan harus berupa teks" });
        }
        db.prepare("UPDATE splitters SET name=?, ratio=?, input_core=?, input_note=?, notes=?, updated_at=? WHERE id=?")
          .run(b.name.trim(), b.ratio, inputCore == null ? null : Number(inputCore), b.input_note || null, b.notes || null, now(), id);
        syncSplitterPorts(id, b.ratio);
        return send(req, res, 200, getSplitter(id));
      }
      if (method === "DELETE") {
        const found = db.prepare("SELECT id FROM splitters WHERE id=?").get(id);
        if (!found) return send(req, res, 404, { error: "Splitter tidak ditemukan" });
        db.prepare("UPDATE splitter_outputs SET target_type=NULL, target_splitter_id=NULL WHERE target_splitter_id=?").run(id);
        db.prepare("UPDATE splitter_outputs SET target_type=NULL, target_odc_id=NULL WHERE target_odc_id=?").run(id);
        db.prepare("DELETE FROM splitters WHERE id=?").run(id);
        return send(req, res, 200, { ok: true });
      }
    }
    m = p.match(/^\/api\/splitter-outputs\/(\d+)$/);
    if (m && method === "PATCH") {
      const id = Number(m[1]);
      const out = db.prepare("SELECT * FROM splitter_outputs WHERE id=?").get(id);
      if (!out) return send(req, res, 404, { error: "Output splitter tidak ditemukan" });
      const b = await readBody(req);
      const notes = hasOwn(b, "notes") ? b.notes : out.notes;
      if (!isOptionalText(notes)) return send(req, res, 400, { error: "Catatan harus berupa teks" });
      let odpId = null;
      let splId = null;
      let odcId = null;
      let targetType = out.target_odp_id ? "odp" : out.target_odc_id ? "odc" : out.target_splitter_id ? "splitter" : null;
      if (hasOwn(b, "target_type")) {
        targetType = b.target_type;
        if (targetType === "odc") {
          if (!validPositiveInt(b.target_id)) return send(req, res, 400, { error: "ODC tujuan tidak valid" });
          odcId = Number(b.target_id);
          if (!db.prepare("SELECT id FROM odcs WHERE id=?").get(odcId)) {
            return send(req, res, 400, { error: "ODC tujuan tidak ditemukan" });
          }
          if (db.prepare("SELECT id FROM splitter_outputs WHERE target_odc_id=? AND id<>? LIMIT 1").get(odcId, id)) {
            return send(req, res, 409, { error: "ODC anak sudah memiliki koneksi dari output splitter lain" });
          }
          const owner = db.prepare("SELECT odc_id FROM splitters WHERE id=?").get(out.splitter_id)?.odc_id;
          if (!owner) {
            return send(req, res, 400, { error: "Hanya splitter di dalam ODC yang bisa diarahkan ke ODC anak" });
          }
          if (odcIsAncestor(odcId, owner)) {
            return send(req, res, 400, { error: "Akan membentuk lingkaran ODC induk/anak" });
          }
        } else if (targetType === "odp") {
          if (!validPositiveInt(b.target_id)) return send(req, res, 400, { error: "ODP tujuan tidak valid" });
          odpId = Number(b.target_id);
          if (!db.prepare("SELECT id FROM odps WHERE id=?").get(odpId)) {
            return send(req, res, 400, { error: "ODP tujuan tidak ditemukan" });
          }
        } else if (targetType === "splitter") {
          if (!validPositiveInt(b.target_id)) return send(req, res, 400, { error: "Splitter tujuan tidak valid" });
          splId = Number(b.target_id);
          if (!db.prepare("SELECT id FROM splitters WHERE id=?").get(splId)) {
            return send(req, res, 400, { error: "Splitter tujuan tidak ditemukan" });
          }
          if (splId === out.splitter_id) {
            return send(req, res, 400, { error: "Splitter tidak bisa di-cascade ke dirinya sendiri" });
          }
          if (splitterReaches(splId, out.splitter_id)) {
            return send(req, res, 400, { error: "Cascade akan membentuk lingkaran antar-splitter" });
          }
        } else if (targetType == null || targetType === "") {
          targetType = null;
        } else {
          return send(req, res, 400, { error: "Tipe tujuan output tidak valid" });
        }
      } else {
        odpId = out.target_odp_id;
        splId = out.target_splitter_id;
        odcId = out.target_odc_id;
      }
      db.prepare("UPDATE splitter_outputs SET target_type=?, target_odp_id=?, target_splitter_id=?, target_odc_id=?, notes=? WHERE id=?")
        .run(targetType, odpId, splId, odcId, notes || null, id);
      return send(req, res, 200, db.prepare(
        `SELECT o.*,
           CASE WHEN o.target_odp_id IS NOT NULL THEN 'odp'
                WHEN o.target_odc_id IS NOT NULL THEN 'odc'
                WHEN o.target_splitter_id IS NOT NULL THEN 'splitter' ELSE NULL END AS target_type,
           od.name AS target_odp_name, ts.name AS target_splitter_name, tod.name AS target_odc_name
         FROM splitter_outputs o
         LEFT JOIN odps od ON od.id = o.target_odp_id
         LEFT JOIN splitters ts ON ts.id = o.target_splitter_id
         LEFT JOIN odcs tod ON tod.id = o.target_odc_id
         WHERE o.id=?`).get(id));
    }

    // ---------------- Laporan ----------------
    if (p === "/api/laporan" && method === "GET") {
      const rows = db.prepare(`
        SELECT ca.id, ca.source, ca.core, ca.status, ca.destination, ca.notes,
          CASE WHEN ca.source='olt_to_odc' THEN d.name ELSE pd.name END AS link_name,
          CASE WHEN ca.source='olt_to_odc' THEN o.name ELSE d2.name END AS uplink_name,
          CASE WHEN ca.source='olt_to_odc' THEN d.cable_type ELSE pd.cable_type END AS cable_type
        FROM core_assignments ca
        LEFT JOIN odcs d ON d.id = ca.odc_id
        LEFT JOIN olts o ON o.id = d.olt_id
        LEFT JOIN odps pd ON pd.id = ca.odp_id
        LEFT JOIN odcs d2 ON d2.id = pd.odc_id
        ORDER BY ca.source, ca.core`).all();
      return send(req, res, 200, rows);
    }

    // ---------------- Users (admin only) ----------------
    if (p.startsWith("/api/users")) {
      if (!isAdmin) return send(req, res, 403, { error: "Hanya admin yang dapat mengelola user" });

      if (p === "/api/users" && method === "GET") {
        return send(req, res, 200, db.prepare("SELECT id, email, full_name, role, created_at FROM users ORDER BY created_at").all());
      }
      if (p === "/api/users" && method === "POST") {
        const b = await readBody(req);
        if (typeof b.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email.trim())) {
          return send(req, res, 400, { error: "Email tidak valid" });
        }
        if (!isText(b.full_name)) return send(req, res, 400, { error: "Nama wajib diisi" });
        if (typeof b.password !== "string" || b.password.length < 8) {
          return send(req, res, 400, { error: "Password minimal 8 karakter" });
        }
        if (!USER_ROLES.has(b.role)) return send(req, res, 400, { error: "Peran tidak valid" });
        const email = b.email.toLowerCase().trim();
        if (db.prepare("SELECT id FROM users WHERE email=?").get(email)) {
          return send(req, res, 409, { error: "Email sudah terdaftar" });
        }
        const r = db.prepare("INSERT INTO users (email, password_hash, full_name, role) VALUES (?,?,?,?)")
          .run(email, hashPassword(b.password), b.full_name.trim(), b.role);
        return send(req, res, 201, db.prepare("SELECT id, email, full_name, role, created_at FROM users WHERE id=?").get(r.lastInsertRowid));
      }
      m = p.match(/^\/api\/users\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        if (method === "PATCH") {
          const body = await readBody(req);
          const current = db.prepare("SELECT id, full_name, role FROM users WHERE id=?").get(id);
          if (!current) return send(req, res, 404, { error: "User tidak ditemukan" });
          const b = { ...current, ...body };
          if (!isText(b.full_name)) return send(req, res, 400, { error: "Nama wajib diisi" });
          if (!USER_ROLES.has(b.role)) return send(req, res, 400, { error: "Peran tidak valid" });
          if (id === user.id && b.role !== "admin") {
            return send(req, res, 400, { error: "Admin tidak dapat menurunkan peran akunnya sendiri" });
          }
          db.prepare("UPDATE users SET full_name=?, role=? WHERE id=?").run(b.full_name.trim(), b.role, id);
          return send(req, res, 200, db.prepare("SELECT id, email, full_name, role, created_at FROM users WHERE id=?").get(id));
        }
        if (method === "DELETE") {
          if (id === user.id) return send(req, res, 400, { error: "Tidak bisa menghapus akun sendiri" });
          const result = db.prepare("DELETE FROM users WHERE id=?").run(id);
          if (!result.changes) return send(req, res, 404, { error: "User tidak ditemukan" });
          return send(req, res, 200, { ok: true });
        }
      }
    }

    return send(req, res, 404, { error: `Endpoint tidak ditemukan: ${method} ${p}` });
  } catch (e) {
    console.error("[arena-api] error:", e);
    return send(req, res, e.status ?? 500, { error: e.message });
  }
});

seedIfEmpty();
server.listen(PORT, HOST, () => {
  console.log(`[arena-api] FiberOps Arena API siap di http://${HOST}:${PORT}`);
});
