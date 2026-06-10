/**
 * /api/auth/* routes.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadConfig } from "../config.js";
import { handleApiError, sendError, ErrorCode } from "../errors.js";
import {
  destroySessionByToken,
  login,
  register,
  type SafeUser,
  toSafeUser,
} from "./service.js";
import { requireAuth, requireAuthedUser } from "./middleware.js";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { eq } from "drizzle-orm";

const CredentialsSchema = z.object({
  email: z.string().min(1).max(255),
  password: z.string().min(1).max(128),
  username: z.string().max(50).optional(),
});

function setSessionCookie(reply: import("fastify").FastifyReply, token: string, ttlDays: number) {
  const config = loadConfig();
  reply.setCookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.NODE_ENV === "production",
    path: "/",
    maxAge: ttlDays * 24 * 60 * 60,
  });
}

function clearSessionCookie(reply: import("fastify").FastifyReply) {
  const config = loadConfig();
  reply.clearCookie(config.SESSION_COOKIE_NAME, { path: "/" });
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/register", async (request, reply) => {
    const parsed = CredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, ErrorCode.INVALID_REQUEST, "请求参数不合法");
    }
    const config = loadConfig();
    try {
      const { user, session } = await register(parsed.data, config.SESSION_TTL_DAYS);
      setSessionCookie(reply, session.token, config.SESSION_TTL_DAYS);
      return reply.code(201).send({ user });
    } catch (err) {
      return handleApiError(reply, err);
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = CredentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 400, ErrorCode.INVALID_REQUEST, "请求参数不合法");
    }
    const config = loadConfig();
    try {
      const { user, session } = await login(parsed.data, config.SESSION_TTL_DAYS);
      setSessionCookie(reply, session.token, config.SESSION_TTL_DAYS);
      return reply.send({ user });
    } catch (err) {
      return handleApiError(reply, err);
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const config = loadConfig();
    const token = request.cookies[config.SESSION_COOKIE_NAME];
    if (typeof token === "string" && token.length > 0) {
      try {
        await destroySessionByToken(token);
      } catch (err) {
        // We still clear the cookie below — the user wants to be logged out.
        request.log.warn({ err }, "Failed to delete session row");
      }
    }
    clearSessionCookie(reply);
    return reply.send({ ok: true });
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request, reply) => {
    const user = requireAuthedUser(request);
    return reply.send({ user });
  });

  // Used by the test harness to look up a user row by email without
  // exposing the password hash. Never wired in production.
  app.get("/api/auth/_debug_user", async (request, reply) => {
    const config = loadConfig();
    if (config.NODE_ENV === "production") {
      return sendError(reply, 404, ErrorCode.ROUTE_NOT_FOUND, "接口不存在");
    }
    const email = (request.query as { email?: string }).email?.toLowerCase();
    if (!email) return sendError(reply, 400, ErrorCode.INVALID_REQUEST, "需要 email");
    const rows = await getDb()
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (rows.length === 0) return reply.send({ user: null });
    const u = rows[0];
    const safe: SafeUser = toSafeUser(u);
    return reply.send({ user: safe, passwordHashLength: u.passwordHash.length });
  });
}
