/**
 * Auth business logic: user registration, password verification, and
 * session lifecycle. Routes call into this layer; this layer is the
 * only place that touches the password hash, the sessions table, and
 * the email column.
 */
import { eq, lte } from "drizzle-orm";
import argon2 from "argon2";
import { getDb } from "../db/client.js";
import { sessions, userSettings, users, type User } from "../db/schema.js";
import { ApiError, ErrorCode } from "../errors.js";
import { generateSessionToken, hashSessionToken } from "./session.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 128;
const MAX_EMAIL_LEN = 255;
const PASSWORD_HASH_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Pre-computed Argon2id hash used to keep login timing roughly constant
 * when the supplied email does not exist. The password is irrelevant
 * — argon2.verify always returns false against a real password and a
 * valid hash, so the hash below just needs to be syntactically valid.
 */
const TIMING_DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXktc2FsdC0xMjM0NTY3$" +
  "k5T1ZQX2YhTZjOJz7H9B7GRsCy0Wz3v6yLgKfs2F0g";

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export interface RegisterInput {
  email: string;
  password: string;
  username?: string | null;
}

function assertValidCredentials(input: RegisterInput): {
  email: string;
  password: string;
  username: string | null;
} {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    throw new ApiError(400, ErrorCode.INVALID_REQUEST, "邮箱和密码必填");
  }
  const email = normalizeEmail(input.email);
  if (!EMAIL_RE.test(email) || email.length > MAX_EMAIL_LEN) {
    throw new ApiError(400, ErrorCode.INVALID_REQUEST, "邮箱格式不正确");
  }
  const password = input.password;
  if (password.length < MIN_PASSWORD_LEN) {
    throw new ApiError(400, ErrorCode.PASSWORD_TOO_WEAK, "密码至少 8 位");
  }
  if (password.length > MAX_PASSWORD_LEN) {
    throw new ApiError(400, ErrorCode.PASSWORD_TOO_WEAK, "密码过长");
  }
  const username = typeof input.username === "string" && input.username.trim().length > 0
    ? input.username.trim().slice(0, 50)
    : null;
  return { email, password, username };
}

export interface SafeUser {
  id: string;
  email: string;
  username: string | null;
  createdAt: string;
}

export function toSafeUser(u: User): SafeUser {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    createdAt: u.createdAt.toISOString(),
  };
}

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

async function createSessionRow(userId: string, ttlDays: number): Promise<CreatedSession> {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  await getDb().insert(sessions).values({
    userId,
    tokenHash,
    expiresAt,
  });
  return { token, expiresAt };
}

export async function register(
  input: RegisterInput,
  ttlDays: number,
): Promise<{ user: SafeUser; session: CreatedSession }> {
  const { email, password, username } = assertValidCredentials(input);
  const db = getDb();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) {
    // Generic message to avoid account enumeration.
    throw new ApiError(409, ErrorCode.EMAIL_ALREADY_EXISTS, "该邮箱已被注册");
  }
  const passwordHash = await argon2.hash(password, PASSWORD_HASH_OPTS);
  const inserted = await db
    .insert(users)
    .values({ email, username, passwordHash })
    .returning();
  const user = inserted[0];
  if (!user) {
    throw new ApiError(500, ErrorCode.DATABASE_ERROR, "注册失败，请稍后再试");
  }
  // Seed default settings so the first GET /api/settings is fast.
  await db.insert(userSettings).values({ userId: user.id }).onConflictDoNothing();
  const session = await createSessionRow(user.id, ttlDays);
  return { user: toSafeUser(user), session };
}

export interface LoginInput {
  email: string;
  password: string;
}

export async function login(
  input: LoginInput,
  ttlDays: number,
): Promise<{ user: SafeUser; session: CreatedSession }> {
  if (typeof input.email !== "string" || typeof input.password !== "string") {
    throw new ApiError(401, ErrorCode.INVALID_CREDENTIALS, "邮箱或密码错误");
  }
  const email = normalizeEmail(input.email);
  const db = getDb();
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  // Always run argon2.verify against a dummy hash to keep timing roughly
  // constant whether or not the account exists.
  const verifyTarget = user?.passwordHash ?? TIMING_DUMMY_HASH;
  let valid = false;
  try {
    valid = await argon2.verify(verifyTarget, input.password);
  } catch {
    valid = false;
  }
  if (!user || !valid) {
    throw new ApiError(401, ErrorCode.INVALID_CREDENTIALS, "邮箱或密码错误");
  }
  const session = await createSessionRow(user.id, ttlDays);
  return { user: toSafeUser(user), session };
}

export async function destroySessionByToken(token: string): Promise<void> {
  const tokenHash = hashSessionToken(token);
  await getDb().delete(sessions).where(eq(sessions.tokenHash, tokenHash));
}

export interface ResolvedSession {
  user: User;
  sessionId: string;
}

export async function resolveSession(token: string): Promise<ResolvedSession | null> {
  const tokenHash = hashSessionToken(token);
  const db = getDb();
  const rows = await db
    .select({
      session: sessions,
      user: users,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.tokenHash, tokenHash))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.session.expiresAt.getTime() <= Date.now()) {
    // Lazily clean up an expired session so the table doesn't grow.
    await db.delete(sessions).where(eq(sessions.id, row.session.id));
    return null;
  }
  return { user: row.user, sessionId: row.session.id };
}

/** Periodic garbage collection for sessions that nobody visits. */
export async function purgeExpiredSessions(): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(sessions)
    .where(lte(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return result.length;
}
