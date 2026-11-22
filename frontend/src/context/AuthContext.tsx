import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, loadSession, saveSession, setUnauthorizedHandler, type Session } from "../api/client";
import type { TokenResponse, User } from "../api/types";

interface AuthValue {
  user: User | null;
  sessionExpired: boolean;
  login: (email: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  applyToken: (response: TokenResponse) => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthValue | null>(null);

function toSession(response: TokenResponse): Session {
  return {
    token: response.access_token,
    expiresAt: Date.now() + response.expires_in * 1000,
    user: response.user,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [sessionExpired, setSessionExpired] = useState(false);

  const store = useCallback((next: Session | null) => {
    saveSession(next);
    setSession(next);
  }, []);

  const expire = useCallback(() => {
    store(null);
    setSessionExpired(true);
  }, [store]);

  useEffect(() => {
    setUnauthorizedHandler(expire);
  }, [expire]);

  // Log out when the token runs out, rather than waiting for a request to fail.
  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(expire, Math.max(0, session.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [session, expire]);

  // Pick up role or name changes made by an admin since this session was saved.
  const hasSession = session !== null;
  useEffect(() => {
    if (!hasSession) return;
    api
      .get<User>("/auth/me")
      .then(({ data }) => {
        setSession((current) => {
          if (!current) return current;
          const next = { ...current, user: data };
          saveSession(next);
          return next;
        });
      })
      .catch(() => {
        // A 401 is handled by the interceptor. Other failures keep the saved user.
      });
  }, [hasSession]);

  const value = useMemo<AuthValue>(
    () => ({
      user: session?.user ?? null,
      sessionExpired,
      login: async (email, password) => {
        const { data } = await api.post<TokenResponse>("/auth/login", { email, password });
        store(toSession(data));
        setSessionExpired(false);
        return data.user;
      },
      logout: async () => {
        try {
          await api.post("/auth/logout");
        } finally {
          store(null);
          setSessionExpired(false);
        }
      },
      applyToken: (response) => store(toSession(response)),
      setUser: (user) => {
        setSession((current) => {
          if (!current) return current;
          const next = { ...current, user };
          saveSession(next);
          return next;
        });
      },
    }),
    [session, sessionExpired, store],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

const HOME: Record<User["role"], string> = {
  student: "/my-progress",
  educator: "/this-week",
  admin: "/dashboard",
};

export const homeFor = (user: User): string => HOME[user.role];
