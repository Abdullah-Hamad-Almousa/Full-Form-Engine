import { api } from "./api";

export type UserRole = "WORKER" | "MANAGER" | "ADMIN";

export type AuthenticatedUser = {
  id: string;
  name: string;
  username: string;
  email: string | null;
  role: UserRole;
};

type UserEnvelope = {
  data: { user: AuthenticatedUser };
};

export async function getCurrentUser(
  signal?: AbortSignal
): Promise<AuthenticatedUser> {
  const response = await api<UserEnvelope>("/api/auth/me", { signal });
  return response.data.user;
}

export async function loginUser(
  username: string,
  password: string
): Promise<AuthenticatedUser> {
  const response = await api<UserEnvelope>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
  return response.data.user;
}

export async function logoutUser(): Promise<void> {
  await api<void>("/api/auth/logout", { method: "POST" });
}
