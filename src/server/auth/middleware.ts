/**
 * Fastify preHandler that resolves the session cookie to a user and
 * attaches it to `request.user`. Throws 401 when no valid session is
 * present.
 *
 * The cookie name and signing mode are configured globally by the
 * @fastify/cookie plugin in src/server/index.ts.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { resolveSession, type SafeUser, toSafeUser } from "./service.js";
import { ApiError, ErrorCode, sendError } from "../errors.js";
import { loadConfig } from "../config.js";

export interface AuthedRequest {
  user: SafeUser;
  rawUser: { id: string; email: string };
}

declare module "fastify" {
  interface FastifyRequest {
    authedUser?: SafeUser;
  }
}

export function getSessionTokenFromCookie(
  request: FastifyRequest,
  cookieName: string,
): string | null {
  const token = request.cookies[cookieName];
  if (typeof token !== "string" || token.length === 0) return null;
  return token;
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const config = loadConfig();
  const token = getSessionTokenFromCookie(request, config.SESSION_COOKIE_NAME);
  if (!token) {
    sendError(reply, 401, ErrorCode.UNAUTHENTICATED, "请先登录");
    return;
  }
  const resolved = await resolveSession(token);
  if (!resolved) {
    // Stale or invalid cookie — clear it so the next request is clean.
    reply.clearCookie(config.SESSION_COOKIE_NAME, { path: "/" });
    sendError(reply, 401, ErrorCode.SESSION_EXPIRED, "登录已过期，请重新登录");
    return;
  }
  request.authedUser = toSafeUser(resolved.user);
}

/** Soft variant: populates `authedUser` if available, never throws. */
export async function attachUserIfPresent(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const config = loadConfig();
  const token = getSessionTokenFromCookie(request, config.SESSION_COOKIE_NAME);
  if (!token) return;
  const resolved = await resolveSession(token);
  if (resolved) {
    request.authedUser = toSafeUser(resolved.user);
  }
}

export function requireAuthedUser(request: FastifyRequest): SafeUser {
  if (!request.authedUser) {
    throw new ApiError(401, ErrorCode.UNAUTHENTICATED, "请先登录");
  }
  return request.authedUser;
}
