/**
 * Session token helpers.
 *
 * The raw token is generated with crypto.randomBytes and sent to the
 * browser in a HttpOnly cookie. Only the SHA-256 hash of the token is
 * persisted in the database, so a database leak does not let the
 * attacker impersonate users.
 *
 * We do NOT use any "SESSION_SECRET" — the token is high-entropy and
 * the database stores only its hash, so there is no server-side
 * secret to steal.
 */
import { createHash, randomBytes } from "node:crypto";

const TOKEN_BYTES = 32; // 256 bits

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
