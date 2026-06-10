/**
 * Auth API client.
 */
import { apiRequest } from "./http.js";

export interface AuthUser {
  id: string;
  email: string;
  username: string | null;
  createdAt: string;
}

export async function fetchMe(): Promise<AuthUser | null> {
  try {
    const { user } = await apiRequest<{ user: AuthUser }>("/api/auth/me");
    return user;
  } catch (err) {
    if (err instanceof Error && (err as { status?: number }).status === 401) {
      return null;
    }
    throw err;
  }
}

export async function register(input: { email: string; password: string; username?: string }): Promise<AuthUser> {
  const { user } = await apiRequest<{ user: AuthUser }>("/api/auth/register", {
    method: "POST",
    body: input,
  });
  return user;
}

export async function login(input: { email: string; password: string }): Promise<AuthUser> {
  const { user } = await apiRequest<{ user: AuthUser }>("/api/auth/login", {
    method: "POST",
    body: input,
  });
  return user;
}

export async function logout(): Promise<void> {
  await apiRequest<{ ok: true }>("/api/auth/logout", { method: "POST" });
}
