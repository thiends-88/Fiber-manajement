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
  console.log(`[arena-api] ${req.method} ${req.url} -> ${status}`);
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

function authUser(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ")
    ? header.slice(7)
    : parseCookies(req)["fiberops_token"] || null;
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
    "INSERT INTO olt_ports (card_id, port, sfp, serial, status, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
  );
  const p1 = insPort.run(card1, 1, "XGS-PON", "ZTE23A0001", "active", "Feeder ODC-001", ts, ts).lastInsertRowid;
  insPort.run(card1, 2, "XGS-PON", "ZTE23A0002", "active", null, ts, ts);
  insPort.run(card1, 3, null, null, "inactive", null, ts, ts);
  insPort.run(card2, 1, "GPON", "ZTE23B0001", "active", null, ts, ts);
  insPort.run(card2, 2, null, null, "reserved", "Rencana ODC-003", ts, ts);
  insPort.run(card3, 1, "GPON", "HW23C0001", "active", "Feeder ODC-002", ts, ts);

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

    if (!p.startsWith("/api/")) return send(req, res, 404, { error: "Not found" });

    // ---------------- Semua /api/* di bawah ini butuh login ----------------
    const user = authUser(req);
    if (!user) return send(req, res, 401, { error: "Silakan login terlebih dahulu" });

    if (p === "/api/logout" && method === "POST") {
      const user0 = authUser(req);
      if (user0) {
        const header = req.headers["authorization"] || "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : parseCookies(req)["fiberops_token"];
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
        : db.prepare("SELECT * FROM olt_ports ORDER BY card_id, port").all();
      return send(req, res, 200, rows);
    }
    if (p === "/api/ports" && method === "POST") {
      const b = await readBody(req);
      if (!b.card_id || !b.port) return send(req, res, 400, { error: "card_id dan nomor port wajib diisi" });
      const r = db.prepare("INSERT INTO olt_ports (card_id, port, sfp, serial, status, notes) VALUES (?,?,?,?,?,?)")
        .run(b.card_id, b.port, b.sfp || null, b.serial || null, b.status || "inactive", b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM olt_ports WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/ports\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE olt_ports SET port=?, sfp=?, serial=?, status=?, notes=?, updated_at=? WHERE id=?")
          .run(b.port, b.sfp || null, b.serial || null, b.status || "inactive", b.notes || null, now(), id);
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
          (SELECT COUNT(*) FROM core_assignments ca WHERE ca.odc_id=d.id AND ca.source='olt_to_odc') AS core_count
        FROM odcs d JOIN olts o ON o.id=d.olt_id ORDER BY d.name`).all();
      return send(req, res, 200, rows);
    }
    if (p === "/api/odcs" && method === "POST") {
      const b = await readBody(req);
      if (!b.name?.trim() || !b.olt_id || !b.cable_type) return send(req, res, 400, { error: "Nama, OLT, dan tipe kabel wajib diisi" });
      const r = db.prepare("INSERT INTO odcs (olt_id, name, location, cable_type, notes) VALUES (?,?,?,?,?)")
        .run(b.olt_id, b.name.trim(), b.location || null, b.cable_type, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM odcs WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/odcs\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE odcs SET olt_id=?, name=?, location=?, cable_type=?, notes=?, updated_at=? WHERE id=?")
          .run(b.olt_id, b.name, b.location || null, b.cable_type, b.notes || null, now(), id);
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
      } else {
        rows = db.prepare("SELECT * FROM core_assignments ORDER BY source, core").all();
      }
      return send(req, res, 200, rows);
    }
    if (p === "/api/cores" && method === "POST") {
      const b = await readBody(req);
      if (!b.source || !b.core) return send(req, res, 400, { error: "source dan nomor core wajib diisi" });
      const r = db.prepare("INSERT INTO core_assignments (source, odc_id, odp_id, core, status, customer, destination, notes) VALUES (?,?,?,?,?,?,?,?)")
        .run(b.source, b.odc_id || null, b.odp_id || null, b.core, b.status || "idle", b.customer || null, b.destination || null, b.notes || null);
      return send(req, res, 201, db.prepare("SELECT * FROM core_assignments WHERE id=?").get(r.lastInsertRowid));
    }
    m = p.match(/^\/api\/cores\/(\d+)$/);
    if (m) {
      const id = Number(m[1]);
      if (method === "PATCH") {
        const b = await readBody(req);
        db.prepare("UPDATE core_assignments SET status=?, customer=?, destination=?, notes=?, updated_at=? WHERE id=?")
          .run(b.status || "idle", b.customer || null, b.destination || null, b.notes || null, now(), id);
        return send(req, res, 200, db.prepare("SELECT * FROM core_assignments WHERE id=?").get(id));
      }
      if (method === "DELETE") {
        db.prepare("DELETE FROM core_assignments WHERE id=?").run(id);
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
