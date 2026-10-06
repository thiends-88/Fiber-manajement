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
function sendFile(res, filePath) {
  const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": type });
  res.end(fs.readFileSync(filePath));
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
  const filePath = path.normalize(path.join(DIST_DIR, p));
  if (!filePath.startsWith(DIST_DIR)) return send(req, res, 403, { error: "Forbidden" });
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) return sendFile(res, filePath);
  return sendFile(res, path.join(DIST_DIR, "index.html")); // fallback SPA (route /login, /olt, dst.)
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
    power_dbm TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// ---------------------------------------------------------------------------
// Migrasi ringan: database lama otomatis mendapat kolom/tabel baru
// ---------------------------------------------------------------------------
const MIGRATIONS = [
  "ALTER TABLE core_assignments ADD COLUMN power_dbm TEXT",
  "ALTER TABLE olt_ports ADD COLUMN tx_power TEXT",
  "ALTER TABLE olt_ports ADD COLUMN rx_power TEXT",
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
    target_type TEXT CHECK (target_type IS NULL OR target_type IN ('odp','splitter')),
    target_odp_id INTEGER REFERENCES odps(id) ON DELETE SET NULL,
    target_splitter_id INTEGER REFERENCES splitters(id) ON DELETE SET NULL,
    notes TEXT,
    UNIQUE(splitter_id, port)
  )`,
  `CREATE TABLE IF NOT EXISTS core_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    odc_id INTEGER NOT NULL REFERENCES odcs(id) ON DELETE CASCADE,
    odc_core INTEGER NOT NULL,
    odp_id INTEGER NOT NULL REFERENCES odps(id) ON DELETE CASCADE,
    odp_core INTEGER NOT NULL,
    loss_db REAL,
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
    const ins = db.prepare("INSERT INTO core_links (odc_id, odc_core, odp_id, odp_core, loss_db, notes) VALUES (?,?,?,?,?,?)");
    ins.run(odc1.id, 1, odp1.id, 1, 0.15, "Closure Perempatan");
    ins.run(odc1.id, 2, odp1.id, 2, 0.2, null);
  }
  db.prepare("UPDATE core_assignments SET power_dbm=COALESCE(power_dbm,'-19.5') WHERE odc_id=? AND core=1 AND source='olt_to_odc'").run(odc1.id);
  db.prepare("UPDATE core_assignments SET power_dbm=COALESCE(power_dbm,'-20.2') WHERE odc_id=? AND core=2 AND source='olt_to_odc'").run(odc1.id);
  db.prepare("UPDATE olt_ports SET tx_power=COALESCE(tx_power,'2.5'), rx_power=COALESCE(rx_power,'-18.4') WHERE notes LIKE '%Feeder ODC-001%'").run();
  db.prepare("UPDATE olt_ports SET tx_power=COALESCE(tx_power,'2.6'), rx_power=COALESCE(rx_power,'-19.1') WHERE notes LIKE '%Feeder ODC-002%'").run();
})();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const hash = (pw) => crypto.createHash("sha256").update(pw).digest("hex");
const now = () => new Date().toISOString();

// Validasi daftar port feeder ODC: boleh banyak, tetapi harus milik OLT induk ODC
function checkFeederPorts(oltId, ids) {
  if (!ids || !ids.length) return null;
  const olt = db.prepare("SELECT name FROM olts WHERE id=?").get(Number(oltId));
  for (const raw of ids) {
    const row = db.prepare(
      "SELECT c.olt_id FROM olt_ports p JOIN olt_cards c ON c.id=p.card_id WHERE p.id=?",
    ).get(Number(raw));
    if (!row) return `Port feeder id ${raw} tidak ditemukan`;
    if (row.olt_id !== Number(oltId)) {
      return `Port feeder harus milik OLT induk ODC (${olt?.name ?? `OLT #${oltId}`})`;
    }
  }
  return null;
}
const SPLITTER_RATIO_RE = /^1:(\d+)$/;
// Hanya rasio 1:N yang sah (mis. 1:8); mengembalikan 0 bila tidak valid
const splitterPorts = (ratio) => {
  const m = SPLITTER_RATIO_RE.exec(String(ratio ?? ""));
  const n = m ? Number(m[1]) : 0;
  return n >= 2 && n <= 64 ? n : 0;
};
const SPLITTER_SQL = `SELECT s.*, d.name AS odc_name, p.name AS odp_name
  FROM splitters s LEFT JOIN odcs d ON d.id = s.odc_id LEFT JOIN odps p ON p.id = s.odp_id`;
const SPLITTER_OUT_SQL = `SELECT o.*,
    CASE WHEN o.target_odp_id IS NOT NULL THEN 'odp'
         WHEN o.target_splitter_id IS NOT NULL THEN 'splitter' ELSE NULL END AS target_type,
    od.name AS target_odp_name, ts.name AS target_splitter_name
  FROM splitter_outputs o
  LEFT JOIN odps od ON od.id = o.target_odp_id
  LEFT JOIN splitters ts ON ts.id = o.target_splitter_id
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

function syncFeederPorts(odcId, ids) {
  db.prepare("DELETE FROM odc_feeder_ports WHERE odc_id=?").run(odcId);
  const ins = db.prepare("INSERT OR IGNORE INTO odc_feeder_ports (odc_id, port_id) VALUES (?,?)");
  for (const raw of ids || []) ins.run(odcId, Number(raw));
}

let extraCookies = null;
function setCookie(value) {
  extraCookies = value;
}
function send(req, res, status, body) {
  const headers = { "Content-Type": "application/json" };
  if (extraCookies) {
    headers["Set-Cookie"] = extraCookies;
    extraCookies = null;
  }
  res.writeHead(status, headers);
  const safeUrl = req.url.replace(/([?&]token=)[^&]+/g, "$1***");
  console.log(`[arena-api] ${req.method} ${safeUrl} -> ${status}${authVia ? ` (auth:${authVia})` : ""}`);
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error("Body terlalu besar"));
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("JSON tidak valid"));
      }
    });
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers["cookie"] || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

let authVia = null;
function authUser(req, url) {
  const header = req.headers["authorization"] || "";
  let token = null;
  authVia = null;
  if (header.startsWith("Bearer ")) {
    token = header.slice(7);
    authVia = "header";
  } else if (parseCookies(req)["fiberops_token"]) {
    token = parseCookies(req)["fiberops_token"];
    authVia = "cookie";
  } else if (url && url.searchParams.get("token")) {
    token = url.searchParams.get("token");
    authVia = "param";
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
  insUser.run("admin@arena.test", hash("Arena123!"), "Admin Arena", "admin", ts);
  insUser.run("operator@arena.test", hash("Arena123!"), "Operator Demo", "operator", ts);

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
    "INSERT INTO olt_ports (card_id, port, sfp, serial, status, notes, tx_power, rx_power, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  );
  const p1 = insPort.run(card1, 1, "XGS-PON", "ZTE23A0001", "active", "Feeder ODC-001", "2.5", "-18.4", ts, ts).lastInsertRowid;
  const p2 = insPort.run(card1, 2, "XGS-PON", "ZTE23A0002", "active", null, "2.3", "-19.0", ts, ts).lastInsertRowid;
  insPort.run(card1, 3, null, null, "inactive", null, null, null, ts, ts);
  insPort.run(card2, 1, "GPON", "ZTE23B0001", "active", null, "2.1", "-20.3", ts, ts);
  insPort.run(card2, 2, null, null, "reserved", "Rencana ODC-003", null, null, ts, ts);
  const p6 = insPort.run(card3, 1, "GPON", "HW23C0001", "active", "Feeder ODC-002", "2.6", "-19.1", ts, ts).lastInsertRowid;

  const insOdc = db.prepare(
    "INSERT INTO odcs (olt_id, name, location, cable_type, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  const odc1 = insOdc.run(olt1, "ODC-001", "Perempatan Kota", "24_core_4_tube", "Closure utama", ts, ts).lastInsertRowid;
  const odc2 = insOdc.run(olt2, "ODC-002", "Kawasan Industri", "48_core_8_tube", null, ts, ts).lastInsertRowid;

  const insOdp = db.prepare(
    "INSERT INTO odps (odc_id, name, location, cable_type, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  );
  const odp1 = insOdp.run(odc1, "ODP-001", "Jl. Melati RT 03", "12_core_2_tube", null, ts, ts).lastInsertRowid;
  const odp2 = insOdp.run(odc2, "ODP-002", "Perum Griya Asri", "24_core_2_tube", null, ts, ts).lastInsertRowid;
  const odp3 = insOdp.run(odc1, "ODP-003", "Jl. Kenanga", "12_core_2_tube", null, ts, ts).lastInsertRowid;

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

  // Sambungan core end-to-end (mapping ODC core <-> ODP core)
  const insLink = db.prepare(
    "INSERT INTO core_links (odc_id, odc_core, odp_id, odp_core, loss_db, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  insLink.run(odc1, 1, odp1, 1, 0.15, "Closure Perempatan", ts, ts);
  insLink.run(odc1, 2, odp1, 2, 0.2, null, ts, ts);

  // Port feeder ODC — satu ODC boleh beberapa port (contoh: ODC-001 memakai 2 port)
  const insFeeder = db.prepare("INSERT OR IGNORE INTO odc_feeder_ports (odc_id, port_id) VALUES (?,?)");
  insFeeder.run(odc1, p1);
  insFeeder.run(odc1, p2);
  insFeeder.run(odc2, p6);
  db.prepare("UPDATE core_assignments SET power_dbm='-19.5' WHERE odc_id=? AND core=1 AND source='olt_to_odc'").run(odc1);
  db.prepare("UPDATE core_assignments SET power_dbm='-20.2' WHERE odc_id=? AND core=2 AND source='olt_to_odc'").run(odc1);

  // Splitter bertingkat — contoh topologi 4:8:8:
  //   OLT → ODC: SPL-1 (1:4) → cascade SPL-2 (1:8) → ODP-003, dan langsung ke ODP-001
  //   Di dalam ODP juga ada splitter 1:8 (SPL-ODP1 / SPL-ODP3)
  const insSplitter = db.prepare(
    "INSERT INTO splitters (odc_id, odp_id, name, ratio, input_core, input_note, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const insOut = db.prepare("INSERT INTO splitter_outputs (splitter_id, port) VALUES (?,?)");
  const addPorts = (id, n) => { for (let i = 1; i <= n; i++) insOut.run(id, i); };
  const setOut = (splitterId, port, odp = null, spl = null) =>
    db.prepare("UPDATE splitter_outputs SET target_type=?, target_odp_id=?, target_splitter_id=? WHERE splitter_id=? AND port=?")
      .run(odp ? "odp" : spl ? "splitter" : null, odp, spl, splitterId, port);

  const spl1 = insSplitter.run(odc1, null, "SPL-1", "1:4", 1, "Core 1 dari OLT", "Splitter utama ODC", ts, ts).lastInsertRowid;
  const spl2 = insSplitter.run(odc1, null, "SPL-2", "1:8", null, "Cascade dari SPL-1 output 1", "Splitter tahap 2", ts, ts).lastInsertRowid;
  const splOdp1 = insSplitter.run(null, odp1, "SPL-ODP1", "1:8", 1, "Core 1 dari ODC-001", null, ts, ts).lastInsertRowid;
  const splOdp3 = insSplitter.run(null, odp3, "SPL-ODP3", "1:8", 1, "Core 1 dari ODC-001", null, ts, ts).lastInsertRowid;
  addPorts(spl1, 4); addPorts(spl2, 8); addPorts(splOdp1, 8); addPorts(splOdp3, 8);
  setOut(spl1, 1, null, spl2);   // cascade 1:4 → 1:8
  setOut(spl1, 2, odp1);         // langsung ke ODP-001
  setOut(spl2, 1, odp3);         // 1:8 → ODP-003

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
      if (!user || user.password_hash !== hash(String(body.password || ""))) {
        return send(req, res, 401, { error: "Email atau password salah" });
      }
      const token = crypto.randomBytes(24).toString("base64url");
      db.prepare("INSERT INTO sessions (token, user_id) VALUES (?,?)").run(token, user.id);
      setCookie(`fiberops_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);
      return send(req, res, 200, { token, user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role } });
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
      setCookie("fiberops_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
      return send(req, res, 200, { ok: true });
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
      if (!b.name?.trim()) return send(req, res, 400, { error: "Nama OLT wajib diisi" });
      const r = db.prepare("INSERT INTO olts (name, olt_type, location, ip, notes) VALUES (?,?,?,?,?)")
        .run(b.name.trim(), b.olt_type || null, b.location || null, b.ip || null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM olts WHERE id=?").get(r.lastInsertRowid));
    }
    let m = p.match(/^\/api\/olts\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE olts SET name=?, olt_type=?, location=?, ip=?, notes=?, updated_at=? WHERE id=?")
          .run(b.name, b.olt_type || null, b.location || null, b.ip || null, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM olts WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM olts WHERE id=?").run(id);
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
      if (!b.olt_id || !b.slot) return send(req, res, 400, { error: "olt_id dan slot wajib diisi" });
      const r = db.prepare("INSERT INTO olt_cards (olt_id, slot, card_type, label, port_count, notes) VALUES (?,?,?,?,?,?)")
        .run(b.olt_id, b.slot, b.card_type || "OTHER", b.label || null, b.port_count || 8, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM olt_cards WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/cards\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE olt_cards SET slot=?, card_type=?, label=?, port_count=?, notes=?, updated_at=? WHERE id=?")
          .run(b.slot, b.card_type, b.label || null, b.port_count || 8, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM olt_cards WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM olt_cards WHERE id=?").run(id);
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
      if (!b.card_id || !b.port) return send(req, res, 400, { error: "card_id dan nomor port wajib diisi" });
      const r = db.prepare("INSERT INTO olt_ports (card_id, port, sfp, serial, status, tx_power, rx_power, notes) VALUES (?,?,?,?,?,?,?,?)")
        .run(b.card_id, b.port, b.sfp || null, b.serial || null, b.status || "inactive", b.tx_power || null, b.rx_power || null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM olt_ports WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/ports\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE olt_ports SET port=?, sfp=?, serial=?, status=?, tx_power=?, rx_power=?, notes=?, updated_at=? WHERE id=?")
          .run(b.port, b.sfp || null, b.serial || null, b.status || "inactive", b.tx_power || null, b.rx_power || null, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM olt_ports WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM olt_ports WHERE id=?").run(id);
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
      if (!b.name?.trim() || !b.olt_id || !b.cable_type) return send(req, res, 400, { error: "Nama, OLT, dan tipe kabel wajib diisi" });
      const badFeeder = checkFeederPorts(b.olt_id, b.feeder_port_ids);
      if (badFeeder) return send(req, res, 400, { error: badFeeder });
      const r = db.prepare("INSERT INTO odcs (olt_id, name, location, cable_type, notes) VALUES (?,?,?,?,?)")
        .run(b.olt_id, b.name.trim(), b.location || null, b.cable_type, b.notes || null);
      syncFeederPorts(r.lastInsertRowid, b.feeder_port_ids);
      return send(req, res, 201, db.prepare("SELECT * FROM odcs WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/odcs\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        const cur = db.prepare("SELECT olt_id FROM odcs WHERE id=?").get(id);
        const oltId = b.olt_id ?? cur?.olt_id;
        const badFeeder = checkFeederPorts(oltId, b.feeder_port_ids);
        if (badFeeder) return send(req, res, 400, { error: badFeeder });
        db.prepare("UPDATE odcs SET olt_id=?, name=?, location=?, cable_type=?, notes=?, updated_at=? WHERE id=?")
          .run(oltId, b.name, b.location || null, b.cable_type, b.notes || null, now(), id);
        if (b.feeder_port_ids !== undefined) syncFeederPorts(id, b.feeder_port_ids);
        return send(req, res, 200, db.prepare("SELECT * FROM odcs WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM odcs WHERE id=?").run(id);
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
      if (!b.name?.trim() || !b.odc_id || !b.cable_type) return send(req, res, 400, { error: "Nama, ODC, dan tipe kabel wajib diisi" });
      const r = db.prepare("INSERT INTO odps (odc_id, name, location, cable_type, notes) VALUES (?,?,?,?,?)")
        .run(b.odc_id, b.name.trim(), b.location || null, b.cable_type, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM odps WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/odps\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE odps SET odc_id=?, name=?, location=?, cable_type=?, notes=?, updated_at=? WHERE id=?")
          .run(b.odc_id, b.name, b.location || null, b.cable_type, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM odps WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM odps WHERE id=?").run(id);
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
      if (!b.source || !b.core) return send(req, res, 400, { error: "source dan nomor core wajib diisi" });
      const r = db.prepare("INSERT INTO core_assignments (source, odc_id, odp_id, core, status, destination, power_dbm, notes) VALUES (?,?,?,?,?,?,?,?)")
        .run(b.source, b.odc_id || null, b.odp_id || null, b.core, b.status || "idle", b.destination || null, b.power_dbm || null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM core_assignments WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/cores\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE core_assignments SET status=?, destination=?, power_dbm=?, notes=?, updated_at=? WHERE id=?")
          .run(b.status || "idle", b.destination || null, b.power_dbm || null, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM core_assignments WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM core_assignments WHERE id=?").run(id);
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
          pt.port, pt.sfp, pt.tx_power, pt.rx_power
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
      if (!b.odc_id || !b.odc_core || !b.odp_id || !b.odp_core) {
        return send(req, res, 400, { error: "odc_id, odc_core, odp_id, dan odp_core wajib diisi" });
      }
      if (db.prepare("SELECT id FROM core_links WHERE odc_id=? AND odc_core=?").get(b.odc_id, b.odc_core)) {
        return send(req, res, 409, { error: `Core ${b.odc_core} di ODC ini sudah tersambung ke ODP lain` });
      }
      if (db.prepare("SELECT id FROM core_links WHERE odp_id=? AND odp_core=?").get(b.odp_id, b.odp_core)) {
        return send(req, res, 409, { error: `Core ${b.odp_core} di ODP tersebut sudah terpakai sambungan lain` });
      }
      const r = db.prepare("INSERT INTO core_links (odc_id, odc_core, odp_id, odp_core, loss_db, notes) VALUES (?,?,?,?,?,?)")
        .run(b.odc_id, b.odc_core, b.odp_id, b.odp_core, b.loss_db ?? null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM core_links WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/links\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE core_links SET loss_db=?, notes=?, updated_at=? WHERE id=?")
          .run(b.loss_db ?? null, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM core_links WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM core_links WHERE id=?").run(id);
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
      if (!b.name?.trim() || !b.ratio) return send(req, res, 400, { error: "Nama dan rasio splitter wajib diisi" });
      if (!b.odc_id && !b.odp_id) return send(req, res, 400, { error: "Splitter harus ditempatkan di ODC atau ODP" });
      if (!splitterPorts(b.ratio)) return send(req, res, 400, { error: "Rasio splitter tidak valid (contoh 1:4)" });
      const r = db.prepare("INSERT INTO splitters (odc_id, odp_id, name, ratio, input_core, input_note, notes) VALUES (?,?,?,?,?,?,?)")
        .run(b.odc_id || null, b.odp_id || null, b.name.trim(), b.ratio, b.input_core || null, b.input_note || null, b.notes || null);
      syncSplitterPorts(r.lastInsertRowid, b.ratio);
      return send(req, res, 201, getSplitter(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/splitters\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        if (!splitterPorts(b.ratio)) return send(req, res, 400, { error: "Rasio splitter tidak valid (contoh 1:8)" });
        db.prepare("UPDATE splitters SET name=?, ratio=?, input_core=?, input_note=?, notes=?, updated_at=? WHERE id=?")
          .run(b.name, b.ratio, b.input_core || null, b.input_note || null, b.notes || null, now(), id);
        syncSplitterPorts(id, b.ratio);
        return send(req, res, 200, getSplitter(id));
      }
      if (method === "DELETE") {
        db.prepare("UPDATE splitter_outputs SET target_type=NULL, target_splitter_id=NULL WHERE target_splitter_id=?").run(id);
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
      let odpId = null;
      let splId = null;
      if (b.target_type === "odp") {
        if (!db.prepare("SELECT id FROM odps WHERE id=?").get(Number(b.target_id))) {
          return send(req, res, 400, { error: "ODP tujuan tidak ditemukan" });
        }
        odpId = Number(b.target_id);
      } else if (b.target_type === "splitter") {
        splId = Number(b.target_id);
        if (!db.prepare("SELECT id FROM splitters WHERE id=?").get(splId)) {
          return send(req, res, 400, { error: "Splitter tujuan tidak ditemukan" });
        }
        if (splId === out.splitter_id) {
          return send(req, res, 400, { error: "Splitter tidak bisa di-cascade ke dirinya sendiri" });
        }
      }
      db.prepare("UPDATE splitter_outputs SET target_type=?, target_odp_id=?, target_splitter_id=?, notes=? WHERE id=?")
        .run(odpId ? "odp" : splId ? "splitter" : null, odpId, splId, b.notes || null, id);
      return send(req, res, 200, db.prepare(
        `SELECT o.*, od.name AS target_odp_name, ts.name AS target_splitter_name
         FROM splitter_outputs o
         LEFT JOIN odps od ON od.id = o.target_odp_id
         LEFT JOIN splitters ts ON ts.id = o.target_splitter_id
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
        if (!b.email?.includes("@")) return send(req, res, 400, { error: "Email tidak valid" });
        if (!b.full_name?.trim()) return send(req, res, 400, { error: "Nama wajib diisi" });
        if (String(b.password || "").length < 8) return send(req, res, 400, { error: "Password minimal 8 karakter" });
        if (!["admin", "operator", "user"].includes(b.role)) return send(req, res, 400, { error: "Peran tidak valid" });
        if (db.prepare("SELECT id FROM users WHERE email=?").get(b.email.toLowerCase().trim())) {
          return send(req, res, 409, { error: "Email sudah terdaftar" });
        }
        const r = db.prepare("INSERT INTO users (email, password_hash, full_name, role) VALUES (?,?,?,?)")
          .run(b.email.toLowerCase().trim(), hash(b.password), b.full_name.trim(), b.role);
        return send(req, res, 201, db.prepare("SELECT id, email, full_name, role, created_at FROM users WHERE id=?").get(r.lastInsertRowid));
      }
      m = p.match(/^\/api\/users\/(\d+)$/);
      if (m) {
        const id = Number(m[1]);
        if (method === "PATCH") {
          const b = await readBody(req);
          if (id === user.id && b.role && b.role !== "admin") {
            return send(req, res, 400, { error: "Admin tidak dapat menurunkan peran akunnya sendiri" });
          }
          db.prepare("UPDATE users SET full_name=?, role=? WHERE id=?").run(b.full_name, b.role, id);
          return send(req, res, 200, db.prepare("SELECT id, email, full_name, role, created_at FROM users WHERE id=?").get(id));
        }
        if (method === "DELETE") {
          if (id === user.id) return send(req, res, 400, { error: "Tidak bisa menghapus akun sendiri" });
          db.prepare("DELETE FROM users WHERE id=?").run(id);
          return send(req, res, 200, { ok: true });
        }
      }
    }

    return send(req, res, 404, { error: `Endpoint tidak ditemukan: ${method} ${p}` });
  } catch (e) {
    console.error("[arena-api] error:", e);
    return send(req, res, 500, { error: e.message });
  }
});

seedIfEmpty();
server.listen(PORT, HOST, () => {
  console.log(`[arena-api] FiberOps Arena API siap di http://${HOST}:${PORT}`);
});
