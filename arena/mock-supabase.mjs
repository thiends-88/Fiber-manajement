#!/usr/bin/env node
/**
 * Arena Mock Supabase — backend lokal mandiri untuk menjalankan FiberOps di
 * lingkungan Arena tanpa koneksi ke Lovable Cloud / Supabase.
 *
 * Mengimplementasikan subset API yang dipakai aplikasi ini:
 *   - GoTrue auth : /auth/v1/{token,signup,user,logout,settings,admin/users}
 *   - PostgREST   : /rest/v1/<table>  (GET/HEAD/POST/PATCH/DELETE)
 *   - RPC         : /rest/v1/rpc/has_role
 *
 * Data disimpan di arena/db.json (di-seed otomatis saat pertama dijalankan).
 * Jalankan: node arena/mock-supabase.mjs   (default port 54321)
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_FILE = process.env.ARENA_DB_FILE || path.join(__dirname, "db.json");
const PORT = Number(process.env.ARENA_PORT || 54321);
const HOST = process.env.ARENA_HOST || "0.0.0.0";
const SERVICE_KEY = process.env.ARENA_SERVICE_KEY || "arena-service-role-secret";
const TOKEN_TTL = 3600; // detik

const TABLES = [
  "olts", "olt_cards", "olt_ports",
  "odcs", "odps", "core_assignments", "odc_power_sources",
  "profiles", "user_roles",
];

// ---------------------------------------------------------------------------
// Util
// ---------------------------------------------------------------------------
const now = () => new Date().toISOString();
const uuid = () => crypto.randomUUID();
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

function makeJwt(user) {
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    sub: user.id,
    email: user.email,
    role: "authenticated",
    aud: "authenticated",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + TOKEN_TTL,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: user.full_name ?? user.email },
    is_anonymous: false,
  };
  return `${b64url(header)}.${b64url(payload)}.${b64url("arena-mock-signature")}`;
}

function decodeJwt(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Seed data — contoh jaringan demo supaya preview langsung hidup
// ---------------------------------------------------------------------------
function seedDb() {
  const ts = now();
  const adminId = uuid();
  const operatorId = uuid();

  const olt1 = uuid(); // OLT pusat
  const olt2 = uuid();
  const card1 = uuid();
  const card2 = uuid();
  const card3 = uuid();
  const portIds = Array.from({ length: 12 }, () => uuid());
  const odc1 = uuid();
  const odc2 = uuid();
  const odp1 = uuid();
  const odp2 = uuid();

  const assignment = (src, extra, i, status, customer = null, destination = null) => ({
    id: uuid(),
    source: src,
    core_number: i,
    color: ["Biru", "Jingga", "Hijau", "Coklat", "Abu-abu", "Putih", "Merah", "Hitam", "Kuning", "Ungu", "Pink", "Aqua"][(i - 1) % 12],
    tube_number: Math.floor((i - 1) / 12) + 1,
    status,
    customer,
    destination,
    notes: null,
    created_at: ts,
    updated_at: ts,
    ...extra,
  });

  const db = {
    users: [
      {
        id: adminId,
        email: "admin@arena.test",
        password: "Arena123!",
        full_name: "Admin Arena",
        email_confirmed_at: ts,
        created_at: ts,
        updated_at: ts,
        last_sign_in_at: ts,
      },
      {
        id: operatorId,
        email: "operator@arena.test",
        password: "Arena123!",
        full_name: "Operator Demo",
        email_confirmed_at: ts,
        created_at: ts,
        updated_at: ts,
        last_sign_in_at: ts,
      },
    ],
    refreshTokens: {},
    tables: {
      profiles: [
        { id: adminId, email: "admin@arena.test", full_name: "Admin Arena", created_at: ts, updated_at: ts },
        { id: operatorId, email: "operator@arena.test", full_name: "Operator Demo", created_at: ts, updated_at: ts },
      ],
      user_roles: [
        { id: uuid(), user_id: adminId, role: "admin", created_at: ts },
        { id: uuid(), user_id: operatorId, role: "operator", created_at: ts },
      ],
      olts: [
        { id: olt1, name: "OLT-PST-01", olt_type: "ZTE C320", location: "Data Center Pusat", ip_address: "10.10.0.1", notes: "OLT utama", created_at: ts, updated_at: ts },
        { id: olt2, name: "OLT-EDGE-02", olt_type: "Huawei MA5800", location: "POP Timur", ip_address: "10.10.0.2", notes: null, created_at: ts, updated_at: ts },
      ],
      olt_cards: [
        { id: card1, olt_id: olt1, slot_number: 1, card_type: "GTGO", card_label: "GTGO-A", port_count: 8, notes: null, created_at: ts, updated_at: ts },
        { id: card2, olt_id: olt1, slot_number: 2, card_type: "GTGH", card_label: "GTGH-B", port_count: 16, notes: null, created_at: ts, updated_at: ts },
        { id: card3, olt_id: olt2, slot_number: 1, card_type: "GPFA", card_label: null, port_count: 8, notes: null, created_at: ts, updated_at: ts },
      ],
      olt_ports: [
        { id: portIds[0], card_id: card1, port_number: 1, sfp_model: "XGS-PON", sfp_serial: "ZTE23A0001", sfp_tx_power: "2.5", status: "active", notes: "Feeder ODC-001", created_at: ts, updated_at: ts },
        { id: portIds[1], card_id: card1, port_number: 2, sfp_model: "XGS-PON", sfp_serial: "ZTE23A0002", sfp_tx_power: "2.3", status: "active", notes: null, created_at: ts, updated_at: ts },
        { id: portIds[2], card_id: card1, port_number: 3, sfp_model: null, sfp_serial: null, sfp_tx_power: null, status: "inactive", notes: null, created_at: ts, updated_at: ts },
        { id: portIds[3], card_id: card2, port_number: 1, sfp_model: "GPON", sfp_serial: "ZTE23B0001", sfp_tx_power: "2.1", status: "active", notes: null, created_at: ts, updated_at: ts },
        { id: portIds[4], card_id: card2, port_number: 2, sfp_model: null, sfp_serial: null, sfp_tx_power: null, status: "reserved", notes: "Rencana ODC-003", created_at: ts, updated_at: ts },
        { id: portIds[5], card_id: card3, port_number: 1, sfp_model: "GPON", sfp_serial: "HW23C0001", sfp_tx_power: "2.6", status: "active", notes: "Feeder ODC-002", created_at: ts, updated_at: ts },
      ],
      odcs: [
        { id: odc1, olt_id: olt1, name: "ODC-001", location: "Perempatan Kota", cable_type: "24_core_4_tube", notes: "Closure utama", created_at: ts, updated_at: ts },
        { id: odc2, olt_id: olt2, name: "ODC-002", location: "Kawasan Industri", cable_type: "48_core_8_tube", notes: null, created_at: ts, updated_at: ts },
      ],
      odps: [
        { id: odp1, odc_id: odc1, name: "ODP-001", location: "Jl. Melati RT 03", cable_type: "12_core_2_tube", notes: null, created_at: ts, updated_at: ts },
        { id: odp2, odc_id: odc2, name: "ODP-002", location: "Perum Griya Asri", cable_type: "24_core_2_tube", notes: null, created_at: ts, updated_at: ts },
      ],
      core_assignments: [
        assignment("olt_to_odc", { odc_id: odc1 }, 1, "used", "Backbone ISP", "ODC-001"),
        assignment("olt_to_odc", { odc_id: odc1 }, 2, "used", "Backbone ISP", "ODC-001"),
        assignment("olt_to_odc", { odc_id: odc1 }, 3, "reserved", null, "ODC-001"),
        assignment("olt_to_odc", { odc_id: odc1 }, 4, "idle"),
        assignment("olt_to_odc", { odc_id: odc1 }, 5, "idle"),
        assignment("olt_to_odc", { odc_id: odc1 }, 6, "damaged", null, "ODC-001"),
        assignment("olt_to_odc", { odc_id: odc2 }, 1, "used", "Link Pabrik A", "ODC-002"),
        assignment("olt_to_odc", { odc_id: odc2 }, 2, "idle"),
        assignment("odc_to_odp", { odp_id: odp1 }, 1, "used", "Pelanggan Budi", "ODP-001"),
        assignment("odc_to_odp", { odp_id: odp1 }, 2, "used", "Pelanggan Siti", "ODP-001"),
        assignment("odc_to_odp", { odp_id: odp1 }, 3, "idle"),
        assignment("odc_to_odp", { odp_id: odp2 }, 1, "idle"),
      ],
      odc_power_sources: [
        { id: uuid(), odc_id: odc1, port_id: portIds[0], created_at: ts },
      ],
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// Persistensi
// ---------------------------------------------------------------------------
let db;
function loadDb() {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
    console.log(`[arena-mock] DB dimuat dari ${DB_FILE}`);
  } catch {
    db = seedDb();
    saveDb();
    console.log(`[arena-mock] DB baru di-seed ke ${DB_FILE}`);
    console.log("[arena-mock] Login demo: admin@arena.test / Arena123!");
  }
}
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    } catch (e) {
      console.error("[arena-mock] gagal menyimpan db:", e.message);
    }
  }, 50);
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function send(res, status, body, headers = {}) {
  const isJson = typeof body !== "string";
  const payload = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,PUT,DELETE,HEAD,OPTIONS",
    "Access-Control-Expose-Headers": "Content-Range",
    ...headers,
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      if (!raw) return resolve(null);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(raw);
      }
    });
  });
}

function publicUser(u) {
  return {
    id: u.id,
    aud: "authenticated",
    role: "authenticated",
    email: u.email,
    email_confirmed_at: u.email_confirmed_at,
    phone: null,
    confirmed_at: u.email_confirmed_at,
    last_sign_in_at: u.last_sign_in_at,
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: { full_name: u.full_name ?? u.email },
    identities: [
      {
        id: u.id,
        identity_id: uuid(),
        user_id: u.id,
        identity_data: { email: u.email, sub: u.id },
        provider: "email",
        created_at: u.created_at,
        updated_at: u.updated_at,
        last_sign_in_at: u.last_sign_in_at,
      },
    ],
    created_at: u.created_at,
    updated_at: u.updated_at,
    is_anonymous: false,
  };
}

// Emulasi trigger `handle_new_user` di Supabase asli: setiap user baru
// otomatis dibuatkan profile + role (user pertama menjadi admin).
function ensureProfileAndRole(user) {
  const profiles = db.tables.profiles || (db.tables.profiles = []);
  const roles = db.tables.user_roles || (db.tables.user_roles = []);
  if (!profiles.some((p) => p.id === user.id)) {
    profiles.push({
      id: user.id,
      email: user.email,
      full_name: user.full_name ?? user.email,
      created_at: now(),
      updated_at: now(),
    });
  }
  if (!roles.some((r) => r.user_id === user.id)) {
    const isFirst = roles.length === 0;
    roles.push({
      id: uuid(),
      user_id: user.id,
      role: isFirst ? "admin" : "user",
      created_at: now(),
    });
  }
}

function sessionFor(user) {
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  db.refreshTokens[refreshToken] = user.id;
  user.last_sign_in_at = now();
  saveDb();
  return {
    access_token: makeJwt(user),
    token_type: "bearer",
    expires_in: TOKEN_TTL,
    expires_at: Math.floor(Date.now() / 1000) + TOKEN_TTL,
    refresh_token: refreshToken,
    user: publicUser(user),
  };
}

function userFromRequest(req) {
  const auth = req.headers["authorization"] || "";
  if (!auth.startsWith("Bearer ")) return null;
  const claims = decodeJwt(auth.slice(7));
  if (!claims?.sub) return null;
  return db.users.find((u) => u.id === claims.sub) ?? null;
}

// ---------------------------------------------------------------------------
// PostgREST-ish query engine
// ---------------------------------------------------------------------------
const RESERVED_PARAMS = new Set(["select", "order", "limit", "offset", "on_conflict"]);

function parseValue(raw) {
  if (raw === undefined) return undefined;
  if (raw.startsWith("(") && raw.endsWith(")")) return raw; // in.(...) handled separately
  if (raw === "null") return null;
  return raw.replace(/^"|"$/g, "");
}

function matchFilters(row, params) {
  for (const [col, raw] of params.entries()) {
    if (RESERVED_PARAMS.has(col)) continue;
    const v = String(raw);
    const dot = v.indexOf(".");
    const op = dot === -1 ? "eq" : v.slice(0, dot);
    const val = dot === -1 ? v : v.slice(dot + 1);
    const cell = row[col];
    switch (op) {
      case "eq":
        if (String(cell) !== parseValue(val)) return false;
        break;
      case "neq":
        if (String(cell) === parseValue(val)) return false;
        break;
      case "is":
        if (val === "null" && cell != null) return false;
        if (val !== "null" && String(cell) !== val) return false;
        break;
      case "in": {
        const items = val
          .replace(/^\(|\)$/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^"|"$/g, ""));
        if (!items.includes(String(cell))) return false;
        break;
      }
      case "gt": if (!(cell > parseValue(val))) return false; break;
      case "gte": if (!(cell >= parseValue(val))) return false; break;
      case "lt": if (!(cell < parseValue(val))) return false; break;
      case "lte": if (!(cell <= parseValue(val))) return false; break;
      case "like":
      case "ilike": {
        const pattern = val.replace(/%/g, ".*").replace(/_/g, ".");
        const flags = op === "ilike" ? "i" : "";
        if (!new RegExp(`^${pattern}$`, flags).test(String(cell ?? ""))) return false;
        break;
      }
      default:
        break; // operator tidak dikenal: abaikan
    }
  }
  return true;
}

function applyOrder(rows, orderParam) {
  if (!orderParam) return rows;
  const parts = String(orderParam).split(",").map((p) => {
    const [col, dir] = p.trim().split(".");
    return { col, desc: dir === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { col, desc } of parts) {
      const av = a[col];
      const bv = b[col];
      if (av === bv) continue;
      if (av === null || av === undefined) return desc ? -1 : 1;
      if (bv === null || bv === undefined) return desc ? 1 : -1;
      const cmp = av < bv ? -1 : 1;
      return desc ? -cmp : cmp;
    }
    return 0;
  });
}

function project(rows, selectParam) {
  if (!selectParam || selectParam.trim() === "*") return rows;
  const cols = String(selectParam).split(",").map((c) => c.trim());
  return rows.map((r) => {
    const o = {};
    for (const c of cols) o[c] = r[c];
    return o;
  });
}

function parsePrefer(req) {
  const prefer = req.headers["prefer"] || "";
  const out = {};
  for (const part of String(prefer).split(",")) {
    const m = part.trim().match(/^([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function handleRestTable(req, res, table, url) {
  if (!TABLES.includes(table)) {
    return send(res, 404, { message: `Relation '${table}' does not exist`, code: "42P01" });
  }
  const rows = db.tables[table] || (db.tables[table] = []);
  const params = url.searchParams;
  const prefer = parsePrefer(req);
  const wantsObject = String(req.headers["accept"] || "").includes("application/vnd.pgrst.object");

  if (req.method === "HEAD" || req.method === "GET") {
    let result = rows.filter((r) => matchFilters(r, params));
    const total = result.length;
    result = applyOrder(result, params.get("order"));
    const offset = Number(params.get("offset") || 0);
    const limit = params.get("limit") !== null ? Number(params.get("limit")) : undefined;
    if (offset) result = result.slice(offset);
    if (limit !== undefined && !Number.isNaN(limit)) result = result.slice(0, limit);
    result = project(result, params.get("select"));

    const cr = result.length ? `0-${result.length - 1}/${total}` : `*/${total}`;
    if (req.method === "HEAD") {
      return send(res, 200, "", { "Content-Range": cr });
    }
    if (wantsObject) {
      if (result.length !== 1) {
        return send(res, 406, {
          message: "JSON object requested, multiple (or no) rows returned",
          details: `Results contain ${result.length} rows`,
          code: "PGRST116",
        });
      }
      return send(res, 200, result[0], { "Content-Range": cr });
    }
    return send(res, 200, result, { "Content-Range": cr });
  }

  if (req.method === "POST") {
    const body = await readBody(req);
    const incoming = Array.isArray(body) ? body : [body];
    const isUpsert = prefer.resolution === "merge-duplicates";
    const conflictCols = (params.get("on_conflict") || "id").split(",").map((s) => s.trim());
    const written = [];

    for (const item of incoming) {
      const row = { ...item };
      let existing = null;
      if (isUpsert) {
        existing = rows.find((r) => conflictCols.every((c) => String(r[c]) === String(row[c])));
      }
      if (existing) {
        Object.assign(existing, row, { updated_at: now() });
        written.push(existing);
      } else {
        const full = {
          id: uuid(),
          created_at: now(),
          updated_at: now(),
          ...row,
        };
        rows.push(full);
        written.push(full);
      }
    }
    saveDb();

    if (prefer.return === "minimal") {
      res.writeHead(201, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      return res.end();
    }
    let out = project(written, params.get("select"));
    if (wantsObject) {
      if (out.length !== 1) {
        return send(res, 406, { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" });
      }
      return send(res, 201, out[0]);
    }
    return send(res, 201, out);
  }

  if (req.method === "PATCH") {
    const body = await readBody(req);
    const matched = rows.filter((r) => matchFilters(r, params));
    for (const r of matched) Object.assign(r, body, { updated_at: now() });
    saveDb();
    const out = project(matched, params.get("select"));
    if (prefer.return === "minimal") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      return res.end();
    }
    return send(res, wantsObject && out.length === 1 ? 200 : 200, out);
  }

  if (req.method === "DELETE") {
    const keep = [];
    const removed = [];
    for (const r of rows) (matchFilters(r, params) ? removed : keep).push(r);
    db.tables[table] = keep;
    saveDb();
    if (prefer.return === "minimal") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      return res.end();
    }
    return send(res, 200, project(removed, params.get("select")));
  }

  return send(res, 405, { message: `Method ${req.method} not supported` });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const p = url.pathname;

  if (req.method === "OPTIONS") return send(res, 204, "");
  if (p === "/healthz") return send(res, 200, { ok: true, service: "arena-mock-supabase" });

  try {
    // ----------------------------- AUTH -------------------------------------
    if (p === "/auth/v1/settings" && req.method === "GET") {
      return send(res, 200, {
        external: { email: true },
        mailer_autoconfirm: true,
        mailer_secure_email_change_enabled: false,
        mfa_enabled: false,
        saml_enabled: false,
      });
    }

    if (p === "/auth/v1/token" && req.method === "POST") {
      const grant = url.searchParams.get("grant_type");
      const body = (await readBody(req)) || {};
      if (grant === "password") {
        const user = db.users.find(
          (u) => u.email.toLowerCase() === String(body.email || "").toLowerCase(),
        );
        if (!user || user.password !== body.password) {
          return send(res, 400, {
            error: "invalid_grant",
            error_description: "Invalid login credentials",
            msg: "Invalid login credentials",
          });
        }
        return send(res, 200, sessionFor(user));
      }
      if (grant === "refresh_token") {
        const userId = db.refreshTokens[body.refresh_token];
        const user = userId && db.users.find((u) => u.id === userId);
        if (!user) {
          return send(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token", msg: "Invalid Refresh Token" });
        }
        delete db.refreshTokens[body.refresh_token];
        return send(res, 200, sessionFor(user));
      }
      return send(res, 400, { error: "unsupported_grant_type", msg: `Unsupported grant type: ${grant}` });
    }

    if (p === "/auth/v1/signup" && req.method === "POST") {
      const body = (await readBody(req)) || {};
      if (db.users.some((u) => u.email.toLowerCase() === String(body.email || "").toLowerCase())) {
        return send(res, 422, { code: 422, message: "User already registered" });
      }
      const user = {
        id: uuid(),
        email: body.email,
        password: body.password || crypto.randomBytes(16).toString("base64url"),
        full_name: body.data?.full_name || body.user_metadata?.full_name || body.email,
        email_confirmed_at: now(),
        created_at: now(),
        updated_at: now(),
        last_sign_in_at: null,
      };
      db.users.push(user);
      ensureProfileAndRole(user);
      saveDb();
      return send(res, 200, sessionFor(user));
    }

    if (p === "/auth/v1/user" && req.method === "GET") {
      const user = userFromRequest(req);
      if (!user) return send(res, 401, { code: 401, message: "invalid JWT", msg: "invalid JWT" });
      return send(res, 200, publicUser(user));
    }

    if (p === "/auth/v1/logout" && req.method === "POST") {
      res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" });
      return res.end();
    }

    if (p === "/auth/v1/admin/users" && req.method === "POST") {
      if (req.headers["apikey"] !== SERVICE_KEY) return send(res, 401, { message: "invalid service role key" });
      const body = (await readBody(req)) || {};
      if (db.users.some((u) => u.email.toLowerCase() === String(body.email || "").toLowerCase())) {
        return send(res, 422, { code: 422, message: "User already registered" });
      }
      const user = {
        id: uuid(),
        email: body.email,
        password: body.password || crypto.randomBytes(16).toString("base64url"),
        full_name: body.user_metadata?.full_name || body.email,
        email_confirmed_at: body.email_confirm ? now() : null,
        created_at: now(),
        updated_at: now(),
        last_sign_in_at: null,
      };
      db.users.push(user);
      ensureProfileAndRole(user);
      saveDb();
      return send(res, 200, publicUser(user));
    }

    const adminUserMatch = p.match(/^\/auth\/v1\/admin\/users\/([^/]+)$/);
    if (adminUserMatch) {
      if (req.headers["apikey"] !== SERVICE_KEY) return send(res, 401, { message: "invalid service role key" });
      const user = db.users.find((u) => u.id === adminUserMatch[1]);
      if (!user) return send(res, 404, { message: "User not found" });
      if (req.method === "PUT") {
        const body = (await readBody(req)) || {};
        if (body.email) user.email = body.email;
        if (body.password) user.password = body.password;
        if (body.user_metadata) user.full_name = body.user_metadata.full_name ?? user.full_name;
        if (body.email_confirm) user.email_confirmed_at = user.email_confirmed_at || now();
        user.updated_at = now();
        saveDb();
        return send(res, 200, publicUser(user));
      }
      if (req.method === "DELETE") {
        db.users = db.users.filter((u) => u.id !== user.id);
        saveDb();
        return send(res, 200, {});
      }
    }

    // ---------------------------- REST / RPC --------------------------------
    if (p === "/rest/v1/rpc/has_role" && req.method === "POST") {
      const body = (await readBody(req)) || {};
      const exists = (db.tables.user_roles || []).some(
        (r) => r.user_id === body._user_id && r.role === body._role,
      );
      return send(res, 200, exists);
    }

    if (p === "/rest/v1/" || p === "/rest/v1") return send(res, 200, {});

    const tableMatch = p.match(/^\/rest\/v1\/([a-z0-9_]+)$/);
    if (tableMatch) return await handleRestTable(req, res, tableMatch[1], url);

    return send(res, 404, { message: `Not found: ${req.method} ${p}` });
  } catch (e) {
    console.error("[arena-mock] error:", e);
    return send(res, 500, { message: e.message });
  }
});

loadDb();
server.listen(PORT, HOST, () => {
  console.log(`[arena-mock] Supabase mock siap di http://${HOST}:${PORT}`);
});
