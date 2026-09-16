import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from "react";

import { ApiError } from "../services/api";
import {
  getCurrentUser,
  loginUser,
  logoutUser,
  type AuthenticatedUser
} from "../services/auth";

type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "error";

type SessionResult = {
  status: Exclude<AuthStatus, "loading">;
  user: AuthenticatedUser | null;
};

type AuthContextValue = {
  status: AuthStatus;
  user: AuthenticatedUser | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  retrySession: () => void;
  invalidateSession: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

async function resolveSession(signal?: AbortSignal): Promise<SessionResult | null> {
  try {
    return {
      status: "authenticated",
      user: await getCurrentUser(signal)
    };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return null;
    }
    return {
      status:
        error instanceof ApiError && error.status === 401
          ? "unauthenticated"
          : "error",
      user: null
    };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<AuthenticatedUser | null>(null);

  const applySessionResult = useCallback((result: SessionResult | null) => {
    if (!result) {
      return;
    }
    setUser(result.user);
    setStatus(result.status);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void resolveSession(controller.signal).then(applySessionResult);
    return () => controller.abort();
  }, [applySessionResult]);

  const login = useCallback(async (username: string, password: string) => {
    const authenticatedUser = await loginUser(username, password);
    setUser(authenticatedUser);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    await logoutUser();
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const invalidateSession = useCallback(() => {
    setUser(null);
    setStatus("unauthenticated");
  }, []);

  const retrySession = useCallback(() => {
    setStatus("loading");
    void resolveSession().then(applySessionResult);
  }, [applySessionResult]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login,
      logout,
      retrySession,
      invalidateSession
    }),
    [status, user, login, logout, retrySession, invalidateSession]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
