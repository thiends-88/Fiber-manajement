// Klien API sederhana — semua request relatif terhadap origin yang sama,
// diteruskan oleh Vite proxy ke server SQLite lokal (server.mjs).
//
// Autentikasi 3 kanal (lingkungan preview bisa memblokir cookie & storage):
//   1. Parameter URL "?token=..."  — paling tahan banting, selalu diteruskan proxy
//   2. Cookie HttpOnly "fiberops_token" — bila cookie diizinkan browser
//   3. Header Authorization — bila header tidak dihapus proxy
// Token terutama disimpan di MEMORI halaman (module variable), dengan
// localStorage sebagai cadangan best-effort. Semua akses storage aman.
const TOKEN_KEY = "fiberops_arena_token";
const USER_KEY = "fiberops_arena_user";

let memToken = null;

export function setMemToken(t) {
  memToken = t;
}

function getTokenFromStorage() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function getToken() {
  return memToken || getTokenFromStorage();
}

export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export function clearSession() {
  memToken = null;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  } catch {
    /* storage diblokir — abaikan */
  }
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const token = getToken();
  let url = path;
  const headers = { "Content-Type": "application/json" };
  if (token) {
    url += (path.includes("?") ? "&" : "?") + "token=" + encodeURIComponent(token);
    headers["Authorization"] = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* body kosong */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/login") && path !== "/api/me") {
      clearSession();
      // Redirect lembut lewat event SPA — tanpa reload penuh, supaya token
      // di memori tidak hilang dan tidak terjadi loop.
      try {
        window.dispatchEvent(new CustomEvent("arena:unauthorized"));
      } catch {
        /* abaikan */
      }
    }
    throw new ApiError(data?.error || `Terjadi kesalahan (${res.status})`, res.status);
  }
  return data;
}

export async function login(email, password) {
  const data = await api("/api/login", { method: "POST", body: { email, password } });
  memToken = data.token; // kanal utama: memori + param URL
  try {
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
  } catch {
    /* storage diblokir — sesi tetap jalan lewat memori */
  }
  return data.user;
}

export async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch {
    /* abaikan */
  }
  clearSession();
}
