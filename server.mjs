#!/usr/bin/env node
/**
 * FiberOps Arena — server API sederhana.
 *
 * Database: SQLite bawaan Node (node:sqlite), tersimpan di arena-app/data/fiberops.db.
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
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "fiberops.db");
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
  "ALTER TABLE odcs ADD COLUMN power_source TEXT",
  "ALTER TABLE odcs ADD COLUMN feeder_port_id INTEGER REFERENCES olt_ports(id) ON DELETE SET NULL",
  "ALTER TABLE odps ADD COLUMN power_source TEXT",
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

// Lengkapi database demo lama dengan info feeder/power/sambungan (hanya baris demo)
(function backfillDemoExtras() {
  const odc1 = db.prepare("SELECT id FROM odcs WHERE name='ODC-001'").get();
  const odc2 = db.prepare("SELECT id FROM odcs WHERE name='ODC-002'").get();
  const odp1 = db.prepare("SELECT id FROM odps WHERE name='ODP-001'").get();
  if (!odc1 || !odc2 || !odp1) return;
  db.prepare("UPDATE odps SET power_source=COALESCE(power_source,'PLN') WHERE name='ODP-001'").run();
  db.prepare("UPDATE odps SET power_source=COALESCE(power_source,'PLN + Baterai') WHERE name='ODP-002'").run();
  db.prepare("UPDATE odcs SET power_source=COALESCE(power_source,'PLN + Baterai'), feeder_port_id=COALESCE(feeder_port_id,(SELECT p.id FROM olt_ports p WHERE p.notes LIKE '%Feeder ODC-001%' LIMIT 1)) WHERE id=?").run(odc1.id);
  db.prepare("UPDATE odcs SET power_source=COALESCE(power_source,'PLN'), feeder_port_id=COALESCE(feeder_port_id,(SELECT p.id FROM olt_ports p WHERE p.notes LIKE '%Feeder ODC-002%' LIMIT 1)) WHERE id=?").run(odc2.id);
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
  insPort.run(card1, 2, "XGS-PON", "ZTE23A0002", "active", null, "2.3", "-19.0", ts, ts);
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
    "INSERT INTO odps (odc_id, name, location, cable_type, power_source, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  const odp1 = insOdp.run(odc1, "ODP-001", "Jl. Melati RT 03", "12_core_2_tube", "PLN", null, ts, ts).lastInsertRowid;
  const odp2 = insOdp.run(odc2, "ODP-002", "Perum Griya Asri", "24_core_2_tube", "PLN + Baterai", null, ts, ts).lastInsertRowid;

  const FIBER_COLORS = ["Biru","Jingga","Hijau","Coklat","Abu-abu","Putih","Merah","Hitam","Kuning","Ungu","Pink","Aqua"];
  const insCore = db.prepare(
    "INSERT INTO core_assignments (source, odc_id, odp_id, core, status, customer, destination, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
  );
  const core = (source, odcId, odpId, n, status, customer = null, destination = null) =>
    insCore.run(source, odcId, odpId, n, status, customer, destination, ts, ts);

  core("olt_to_odc", odc1, null, 1, "used", "Backbone ISP", "ODC-001");
  core("olt_to_odc", odc1, null, 2, "used", "Backbone ISP", "ODC-001");
  core("olt_to_odc", odc1, null, 3, "reserved", null, "ODC-001");
  core("olt_to_odc", odc1, null, 4, "idle");
  core("olt_to_odc", odc1, null, 5, "idle");
  core("olt_to_odc", odc1, null, 6, "damaged", null, "ODC-001");
  core("olt_to_odc", odc2, null, 1, "used", "Link Pabrik A", "ODC-002");
  core("olt_to_odc", odc2, null, 2, "idle");
  core("odc_to_odp", null, odp1, 1, "used", "Pelanggan Budi", "ODP-001");
  core("odc_to_odp", null, odp1, 2, "used", "Pelanggan Siti", "ODP-001");
  core("odc_to_odp", null, odp1, 3, "idle");
  core("odc_to_odp", null, odp2, 1, "idle");

  // Sambungan core end-to-end (mapping ODC core <-> ODP core)
  const insLink = db.prepare(
    "INSERT INTO core_links (odc_id, odc_core, odp_id, odp_core, loss_db, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  insLink.run(odc1, 1, odp1, 1, 0.15, "Closure Perempatan", ts, ts);
  insLink.run(odc1, 2, odp1, 2, 0.2, null, ts, ts);

  // Sumber power & port feeder ODC
  db.prepare("UPDATE odcs SET power_source=?, feeder_port_id=? WHERE id=?").run("PLN + Baterai", p1, odc1);
  db.prepare("UPDATE odcs SET power_source=?, feeder_port_id=? WHERE id=?").run("PLN", p6, odc2);
  db.prepare("UPDATE core_assignments SET power_dbm='-19.5' WHERE odc_id=? AND core=1 AND source='olt_to_odc'").run(odc1);
  db.prepare("UPDATE core_assignments SET power_dbm='-20.2' WHERE odc_id=? AND core=2 AND source='olt_to_odc'").run(odc1);

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
          fp.port AS feeder_port, fc.slot AS feeder_slot, fc.label AS feeder_card_label
        FROM odcs d
        JOIN olts o ON o.id=d.olt_id
        LEFT JOIN olt_ports fp ON fp.id=d.feeder_port_id
        LEFT JOIN olt_cards fc ON fc.id=fp.card_id
        ORDER BY d.name`).all();
      return send(req, res, 200, rows);
    }
    if (p === "/api/odcs" && method === "POST") {
      const b = await readBody(req);
      if (!b.name?.trim() || !b.olt_id || !b.cable_type) return send(req, res, 400, { error: "Nama, OLT, dan tipe kabel wajib diisi" });
      const r = db.prepare("INSERT INTO odcs (olt_id, name, location, cable_type, power_source, feeder_port_id, notes) VALUES (?,?,?,?,?,?,?)")
        .run(b.olt_id, b.name.trim(), b.location || null, b.cable_type, b.power_source || null, b.feeder_port_id || null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM odcs WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/odcs\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE odcs SET olt_id=?, name=?, location=?, cable_type=?, power_source=?, feeder_port_id=?, notes=?, updated_at=? WHERE id=?")
          .run(b.olt_id, b.name, b.location || null, b.cable_type, b.power_source || null, b.feeder_port_id || null, b.notes || null, now(), id);
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
      const r = db.prepare("INSERT INTO odps (odc_id, name, location, cable_type, power_source, notes) VALUES (?,?,?,?,?,?)")
        .run(b.odc_id, b.name.trim(), b.location || null, b.cable_type, b.power_source || null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM odps WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/odps\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE odps SET odc_id=?, name=?, location=?, cable_type=?, power_source=?, notes=?, updated_at=? WHERE id=?")
          .run(b.odc_id, b.name, b.location || null, b.cable_type, b.power_source || null, b.notes || null, now(), id);
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
      const r = db.prepare("INSERT INTO core_assignments (source, odc_id, odp_id, core, status, customer, destination, power_dbm, notes) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(b.source, b.odc_id || null, b.odp_id || null, b.core, b.status || "idle", b.customer || null, b.destination || null, b.power_dbm || null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM core_assignments WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/cores\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE core_assignments SET status=?, customer=?, destination=?, power_dbm=?, notes=?, updated_at=? WHERE id=?")
          .run(b.status || "idle", b.customer || null, b.destination || null, b.power_dbm || null, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM core_assignments WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM core_assignments WHERE id=?").run(id);
        return send(req, res, 200, { ok: true });
      }
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

    // ---------------- Laporan ----------------
    if (p === "/api/laporan" && method === "GET") {
      const rows = db.prepare(`
        SELECT ca.id, ca.source, ca.core, ca.status, ca.customer, ca.destination, ca.notes,
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
