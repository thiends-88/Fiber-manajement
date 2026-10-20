import assert from "node:assert/strict";
import { api, ApiError, clearSession, getToken, login, logout, setMemToken } from "../src/lib/api.js";
const storage = new Map();
const events = [];
globalThis.localStorage = { getItem: k => storage.get(k) ?? null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) };
globalThis.window = { dispatchEvent: e => events.push(e.type) };
globalThis.CustomEvent = class { constructor(type) { this.type = type; } };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`  OK    ${name}`); }
console.log("\n=== AUDIT KLIEN API / RACE SESI ===");
await check("401 dari sesi lama tidak menghapus token login baru", async () => {
  setMemToken("lama"); let finish;
  globalThis.fetch = () => new Promise(r => { finish = r; });
  const pending = api("/api/odcs");
  setMemToken("baru"); localStorage.setItem("fiberops_arena_token", "baru");
  finish(json({ error: "Sesi lama habis" }, 401));
  await assert.rejects(pending, e => e.status === 401); assert.equal(getToken(), "baru"); assert.deepEqual(events, []);
});
await check("401 /me membersihkan cache profil dan mengeluarkan hanya sesi aktif", async () => {
  localStorage.setItem("fiberops_arena_user", '{"role":"admin"}');
  globalThis.fetch = async () => json({ error: "Sesi habis" }, 401);
  await assert.rejects(api("/api/me"), e => e.status === 401);
  assert.equal(getToken(), null); assert.equal(localStorage.getItem("fiberops_arena_user"), null); assert.equal(events.pop(), "arena:unauthorized");
});
await check("logout terlambat tidak menghapus sesi baru", async () => {
  setMemToken("lama"); let finish;
  globalThis.fetch = () => new Promise(r => { finish = r; });
  const pending = logout(); setMemToken("baru"); finish(json({ ok: true })); await pending; assert.equal(getToken(), "baru");
});
await check("login gagal tidak menghapus sesi yang sedang berlaku", async () => {
  globalThis.fetch = async () => json({ error: "Password salah" }, 401);
  await assert.rejects(login("a", "b"), e => e.status === 401); assert.equal(getToken(), "baru");
});
await check("HTML/JSON rusak tidak dianggap sukses dengan data null", async () => {
  globalThis.fetch = async () => new Response("<html>proxy error</html>");
  await assert.rejects(api("/api/odcs"), e => e instanceof ApiError && /JSON/.test(e.message));
});
await check("request macet memiliki batas waktu dan pesan yang bisa ditindaklanjuti", async () => {
  globalThis.fetch = (_, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(new DOMException("Timeout", "AbortError"))));
  await assert.rejects(api("/api/odcs", { timeoutMs: 10 }), e => e.status === 408 && /koneksi/.test(e.message));
});
await check("token hanya di header, tidak bocor pada URL yang memiliki filter", async () => {
  setMemToken("a +/&?");
  globalThis.fetch = async (url, opts) => {
    assert.equal(new URL(url, "https://preview.test").searchParams.get("token"), null);
    assert.equal(new URL(url, "https://preview.test").searchParams.get("odc_id"), "2");
    assert.equal(opts.headers.Authorization, "Bearer a +/&?"); assert.equal(opts.headers["X-Fiberops-Token"], "a +/&?"); assert.equal(opts.credentials, "same-origin"); return json([]);
  };
  assert.deepEqual(await api("/api/links?odc_id=2"), []);
});
await check("storage diblokir tidak mematahkan login dan logout lewat memori", async () => {
  clearSession(); globalThis.localStorage = { getItem() { throw Error("blocked"); }, setItem() { throw Error("blocked"); }, removeItem() { throw Error("blocked"); } };
  globalThis.fetch = async url => json(url.startsWith("/api/login") ? { token: "memori", user: { id: 1, role: "user" } } : { ok: true });
  await login("a", "b"); assert.equal(getToken(), "memori"); await logout(); assert.equal(getToken(), null);
});
console.log(`\nAUDIT KLIEN: ${passed} pemeriksaan lulus\n`);
