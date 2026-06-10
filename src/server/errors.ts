/**
 * Unified error envelope and helpers.
 *
 * Every API response (success or error) goes through JSON. Errors
 * follow the contract:
 *   { "error": { "code": "STABLE_CODE", "message": "human readable" } }
 *
 * The HTTP status is the primary signal; the code is the secondary
 * machine-readable signal; the message is the human-readable hint.
 *
 * NEVER include upstream headers, stack traces, database error
 * details, password hashes, or session tokens in `message`.
 */
import type { FastifyReply } from "fastify";

export const ErrorCode = {
  INVALID_REQUEST: "INVALID_REQUEST",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  EMAIL_ALREADY_EXISTS: "EMAIL_ALREADY_EXISTS",
  PASSWORD_TOO_WEAK: "PASSWORD_TOO_WEAK",
  SESSION_EXPIRED: "SESSION_EXPIRED",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  ROUTE_NOT_FOUND: "ROUTE_NOT_FOUND",
  CSRF_ORIGIN_REJECTED: "CSRF_ORIGIN_REJECTED",
  RATE_LIMITED: "RATE_LIMITED",
  DAILY_QUOTA_EXCEEDED: "DAILY_QUOTA_EXCEEDED",
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  UNSUPPORTED_MEDIA: "UNSUPPORTED_MEDIA",
  QWEN_NOT_CONFIGURED: "QWEN_NOT_CONFIGURED",
  BOOHEE_NOT_CONFIGURED: "BOOHEE_NOT_CONFIGURED",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  NO_FOOD_DETECTED: "NO_FOOD_DETECTED",
  RECORD_NOT_FOUND: "RECORD_NOT_FOUND",
  DATABASE_ERROR: "DATABASE_ERROR",
  IMAGE_INVALID: "IMAGE_INVALID",
  IMAGE_TOO_LARGE: "IMAGE_TOO_LARGE",
  IMAGE_PROCESSING_FAILED: "IMAGE_PROCESSING_FAILED",
  IMAGE_UPLOAD_FAILED: "IMAGE_UPLOAD_FAILED",
  IMAGE_NOT_FOUND: "IMAGE_NOT_FOUND",
  IMAGE_URL_SIGN_FAILED: "IMAGE_URL_SIGN_FAILED",
  OSS_NOT_CONFIGURED: "OSS_NOT_CONFIGURED",
  STORAGE_ERROR: "STORAGE_ERROR",
} as const;

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCodeValue;
  constructor(status: number, code: ErrorCodeValue, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export function sendError(
  reply: FastifyReply,
  status: number,
  code: ErrorCodeValue,
  message: string,
): FastifyReply {
  return reply.code(status).send({ error: { code, message } });
}

export function handleApiError(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof ApiError) {
    return sendError(reply, err.status, err.code, err.message);
  }
  // Unhandled — log full detail server-side, return generic to client.
  reply.log.error({ err }, "Unhandled API error");
  return sendError(reply, 500, "DATABASE_ERROR", "服务暂时不可用，请稍后再试");
}
