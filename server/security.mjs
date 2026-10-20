import { isIP } from "node:net";
import crypto from "node:crypto";

export const PASSWORD_HASH_PREFIX = "scrypt";
export const FACTORY_PASSWORD = "Arena123!"; // Hanya untuk fixture/demo, dilarang untuk login produksi.
export const MAX_PASSWORD_LENGTH = 4096;
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${PASSWORD_HASH_PREFIX}$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function secretMatches(actual, expected) {
  const a = Buffer.from(actual, "hex"), b = Buffer.from(expected, "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
export function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length === 3 && parts[0] === PASSWORD_HASH_PREFIX) {
    const [, salt, expected] = parts;
    return /^[a-f0-9]{32}$/.test(salt) && /^[a-f0-9]{128}$/.test(expected)
      && secretMatches(crypto.scryptSync(password, salt, 64).toString("hex"), expected);
  }
  // Tetap mendukung hash lama, lalu server memigrasikannya setelah login valid.
  return /^[a-f0-9]{64}$/.test(stored)
    && secretMatches(crypto.createHash("sha256").update(password).digest("hex"), stored);
}
export function validStoredPasswordHash(value) {
  return typeof value === "string" && /^(?:[a-f0-9]{64}|scrypt\$[a-f0-9]{32}\$[a-f0-9]{128})$/.test(value);
}
export function validNewPassword(value, min = 8) {
  return typeof value === "string" && value.length >= min && value.length <= MAX_PASSWORD_LENGTH;
}

export function canonicalPublicOrigin(raw = "") {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (!["http:","https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw Error();
    return url.origin;
  } catch { throw Error("ARENA_PUBLIC_ORIGIN harus origin HTTP/HTTPS tanpa path, query, atau kredensial"); }
}
export function requestUrl(req) {
  const host = req.headers.host || "localhost";
  if (typeof host !== "string" || /[\s/@?#\\]/.test(host)) throw Error("Host tidak valid");
  const base = new URL(`http://${host}`);
  const url = new URL(req.url, base);
  if (!["http:", "https:"].includes(url.protocol) || url.host !== base.host) throw Error("URL tidak valid");
  return url;
}
export function sameOriginWrite(req, publicOrigin = "") {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const raw = req.headers.origin;
  if (raw === undefined) return true; // CLI/API non-browser tetap boleh memakai bearer.
  try {
    const origin = new URL(raw);
    if (!["http:", "https:"].includes(origin.protocol) || origin.origin !== raw) return false;
    return publicOrigin ? origin.origin === publicOrigin : origin.host === requestUrl(req).host;
  } catch { return false; }
}
export function sessionCookie(token = "", secure = false) {
  return `fiberops_token=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? 604800 : 0}${secure ? "; Secure" : ""}`;
}
export function redactedUrl(raw) {
  try {
    const url = new URL(raw, "http://redaction.invalid");
    for (const key of [...url.searchParams.keys()]) if (key.toLowerCase() === "token") url.searchParams.set(key, "***");
    return `${url.pathname}${url.search}`;
  } catch { return "[URL tidak valid]"; }
}
export const PRIVATE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

// Opt-in khusus proxy yang menghapus/menimpa X-Real-IP dan menjaga backend privat.
const canonicalIp = ip => typeof ip === "string" && ip.startsWith("::ffff:") && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip;
export function trustedProxySet(raw = "") {
  const ips = raw.split(",").map(s => s.trim()).filter(Boolean);
  if (ips.length > 64 || ips.some(ip => !isIP(ip))) throw Error("ARENA_TRUSTED_PROXY_IPS harus daftar alamat IP proxy yang eksplisit (tanpa CIDR/wildcard)");
  return new Set(ips.map(canonicalIp));
}
export function loginClientIp(req, trustedProxies = new Set()) {
  const peer = canonicalIp(req.socket.remoteAddress || "unknown"), reported = req.headers["x-real-ip"];
  return trustedProxies.has(peer) && typeof reported === "string" && isIP(reported) ? canonicalIp(reported) : peer;
}

// Sengaja tidak mempercayai X-Forwarded-For dari klien. Berlaku juga saat diakses
// langsung tanpa reverse proxy; tanpa konfigurasi trusted proxy gateway/NAT berbagi kuota.
export function createLoginLimiter({ limit = 30, windowMs = 600000, maxEntries = 5000, clock = Date.now } = {}) {
  const entries = new Map();
  return (ip) => {
    const now = clock();
    for (const [key, entry] of entries) if (entry.reset <= now) entries.delete(key);
    let entry = entries.get(ip);
    if (!entry) {
      if (entries.size >= maxEntries) return Math.max(1, Math.ceil((Math.min(...[...entries.values()].map(e => e.reset)) - now) / 1000));
      entry = { count: 0, reset: now + windowMs }; entries.set(ip, entry);
    }
    if (entry.count >= limit) return Math.max(1, Math.ceil((entry.reset - now) / 1000));
    entry.count++; return 0;
  };
}
