// URL relatif agar API juga bekerja di preview/proxy. Token memori merupakan
// kanal utama; cookie dan localStorage menjadi cadangan best-effort.
const TOKEN_KEY = "fiberops_arena_token";
const USER_KEY = "fiberops_arena_user";
let memToken = null;
let sessionVersion = 0;

export function setMemToken(token) { memToken = token; sessionVersion++; }
export function getSessionVersion() { return sessionVersion; }
function getTokenFromStorage() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}
export function getToken() { return memToken || getTokenFromStorage(); }
export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; }
}
export function storeUser(user) {
  try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* storage dapat diblokir */ }
}
export function clearSession(expectedVersion) {
  // Respons dari sesi lama tidak boleh mengeluarkan sesi yang baru login.
  if (expectedVersion !== undefined && expectedVersion !== sessionVersion) return false;
  memToken = null; sessionVersion++;
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* best-effort */ }
  return true;
}
export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = "ApiError"; this.status = status; }
}

export async function api(path, { method = "GET", body, timeoutMs = 30000 } = {}) {
  const token = getToken(), version = sessionVersion;
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
    // Beberapa preview/proxy menyaring Authorization/cookie. Tetap header, bukan URL.
    headers["X-Fiberops-Token"] = token;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res, data = null, validJson = false;
  try {
    res = await fetch(path, { method, headers, credentials: "same-origin", signal: controller.signal, body: body === undefined ? undefined : JSON.stringify(body) });
    try { data = await res.json(); validJson = true; } catch (error) { if (controller.signal.aborted) throw error; }
  } catch (error) {
    if (controller.signal.aborted) throw new ApiError("Server terlalu lama merespons. Periksa koneksi lalu coba lagi.", 408);
    throw error;
  } finally { clearTimeout(timer); }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/login") && version === sessionVersion && token === getToken()) {
      clearSession(version);
      try { window.dispatchEvent(new CustomEvent("arena:unauthorized")); } catch { /* tanpa DOM */ }
    }
    throw new ApiError(data?.error || `Terjadi kesalahan (${res.status})`, res.status);
  }
  if ((!validJson || data == null) && res.status !== 204) {
    throw new ApiError("Respons server bukan data JSON yang valid. Muat ulang atau coba lagi.", res.status);
  }
  return data;
}

export async function login(email, password) {
  const version = sessionVersion;
  const data = await api("/api/login", { method: "POST", body: { email, password } });
  if (!data?.token || !data?.user) throw new ApiError("Respons login tidak valid", 502);
  if (version !== sessionVersion) throw new ApiError("Sesi telah berubah. Silakan ulangi login.", 409);
  setMemToken(data.token);
  try { localStorage.setItem(TOKEN_KEY, data.token); } catch { /* sesi tetap bekerja lewat memori */ }
  storeUser(data.user);
  return data.user;
}
export async function logout() {
  const version = sessionVersion;
  try { await api("/api/logout", { method: "POST" }); } catch { /* tetap keluar jika jaringan terputus */ }
  clearSession(version);
}
