import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api, getSessionVersion, setMemToken, storeUser, login as apiLogin, logout as apiLogout } from "./api.js";
const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  // Profil tersimpan hanya cache tampilan, bukan bukti login atau hak akses.
  const [user, setUser] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);
  const generation = useRef(0);
  const recover = useCallback(async () => {
    const request = ++generation.current, session = getSessionVersion();
    setStatus("loading"); setError(null);
    try {
      const data = await api("/api/me");
      if (request !== generation.current || session !== getSessionVersion()) return;
      if (!data?.user?.id || !["admin", "operator", "user"].includes(data.user.role)) throw new Error("Profil sesi dari server tidak valid");
      storeUser(data.user); setUser(data.user); setStatus("ready");
    } catch (e) {
      if (request !== generation.current) return;
      setUser(null);
      if (e.status === 401) setStatus("ready");
      else { setError(e.message); setStatus("error"); }
    }
  }, []);
  useEffect(() => {
    const onUnauthorized = () => { generation.current++; setUser(null); setError(null); setStatus("ready"); };
    const onStorage = (event) => {
      if (event.key == null || ["fiberops_arena_token", "fiberops_arena_user"].includes(event.key)) {
        setMemToken(null); recover();
      }
    };
    window.addEventListener("arena:unauthorized", onUnauthorized);
    window.addEventListener("storage", onStorage);
    recover();
    return () => {
      generation.current++;
      window.removeEventListener("arena:unauthorized", onUnauthorized);
      window.removeEventListener("storage", onStorage);
    };
  }, [recover]);
  async function signIn(email, password) {
    const request = ++generation.current;
    const u = await apiLogin(email, password);
    if (request !== generation.current) throw new Error("Sesi telah berubah. Silakan ulangi login.");
    setUser(u); setError(null); setStatus("ready"); return u;
  }
  async function signOut() {
    const request = ++generation.current;
    await apiLogout();
    if (request === generation.current) { setUser(null); setError(null); setStatus("ready"); }
  }
  return <AuthCtx.Provider value={{ user, status, error, retry: recover, signIn, signOut }}>{children}</AuthCtx.Provider>;
}
export function useAuth() { return useContext(AuthCtx); }
export function AuthStatus() {
  const { status, error, retry } = useAuth();
  return <div className="flex min-h-screen items-center justify-center p-6" role={status === "error" ? "alert" : "status"}>
    <div className="card max-w-md p-5 text-sm">
      {status === "error" ? <><p className="font-semibold">Sesi belum dapat diperiksa</p><p className="my-3 text-mut">{error}</p><button className="btn btn-primary" onClick={retry}>Coba lagi</button></> : "Memeriksa sesi…"}
    </div>
  </div>;
}
