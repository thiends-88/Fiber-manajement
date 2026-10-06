import { createContext, useContext, useEffect, useState } from "react";
import { api, getStoredUser, login as apiLogin, logout as apiLogout } from "./api.js";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());

  // Boot recovery: bila localStorage kosong/terblokir (mis. iframe preview),
  // coba pulihkan sesi dari cookie/token lewat /api/me.
  useEffect(() => {
    if (user) return;
    let cancelled = false;
    api("/api/me")
      .then((d) => {
        if (!cancelled && d?.user) setUser(d.user);
      })
      .catch(() => {
        /* belum login — abaikan */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bila ada request yang 401, keluar dengan lembut (tanpa reload penuh).
  useEffect(() => {
    const onUnauthorized = () => setUser(null);
    window.addEventListener("arena:unauthorized", onUnauthorized);
    return () => window.removeEventListener("arena:unauthorized", onUnauthorized);
  }, []);

  async function signIn(email, password) {
    const u = await apiLogin(email, password);
    setUser(u);
    return u;
  }

  async function signOut() {
    await apiLogout();
    setUser(null);
  }

  return <AuthCtx.Provider value={{ user, signIn, signOut }}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  return useContext(AuthCtx);
}
