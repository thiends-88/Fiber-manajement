import { createContext, useContext, useState } from "react";
import { getStoredUser, login as apiLogin, logout as apiLogout } from "./api.js";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());

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
