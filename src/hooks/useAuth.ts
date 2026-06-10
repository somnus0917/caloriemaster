import { useCallback, useEffect, useState } from "react";
import { fetchMe, login as apiLogin, logout as apiLogout, register as apiRegister, type AuthUser } from "../services/auth.js";

export type AuthStatus = "loading" | "authenticated" | "unauthenticated";

export interface UseAuthReturn {
  status: AuthStatus;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useAuth(): UseAuthReturn {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  const refresh = useCallback(async () => {
    setStatus("loading");
    try {
      const me = await fetchMe();
      if (me) {
        setUser(me);
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus("unauthenticated");
      }
    } catch {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (email: string, password: string) => {
    const u = await apiLogin({ email, password });
    setUser(u);
    setStatus("authenticated");
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const u = await apiRegister({ email, password });
    setUser(u);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } finally {
      setUser(null);
      setStatus("unauthenticated");
    }
  }, []);

  return { status, user, login, register, logout, refresh };
}
