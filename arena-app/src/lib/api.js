// Klien API sederhana — semua request relatif terhadap origin yang sama,
// diteruskan oleh Vite proxy ke server SQLite lokal (server.mjs).
const TOKEN_KEY = "fiberops_arena_token";
const USER_KEY = "fiberops_arena_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function getStoredUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}
export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* body kosong */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/api/login")) {
      clearSession();
      if (!location.pathname.startsWith("/login")) location.href = "/login";
    }
    throw new ApiError(data?.error || `Terjadi kesalahan (${res.status})`, res.status);
  }
  return data;
}

export async function login(email, password) {
  const data = await api("/api/login", { method: "POST", body: { email, password } });
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(USER_KEY, JSON.stringify(data.user));
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
