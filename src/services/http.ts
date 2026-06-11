/**
 * HTTP client for the CalorieMaster API.
 *
 * Responsibilities:
 *   - Always send credentials (so the session cookie is included)
 *   - Default Content-Type: application/json
 *   - Parse the unified { error: { code, message } } envelope and
 *     throw an `ApiError` carrying the status + code
 *
 * The browser MUST NOT store any token / password / key. The session
 * lives only in an HttpOnly cookie set by the server.
 */

export interface ApiErrorPayload {
  error?: { code?: string; message?: string };
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: "请求格式错误",
  UNSUPPORTED_MEDIA: "图片格式不支持，请使用 jpeg / png / webp",
  PAYLOAD_TOO_LARGE: "图片过大，请重新选择或压缩图片",
  UNAUTHENTICATED: "请先登录",
  SESSION_EXPIRED: "登录已过期，请重新登录",
  INVALID_CREDENTIALS: "邮箱或密码错误",
  EMAIL_ALREADY_EXISTS: "该邮箱已被注册",
  PASSWORD_TOO_WEAK: "密码至少 8 位",
  FORBIDDEN: "无权访问",
  CSRF_ORIGIN_REJECTED: "请求来源不被允许",
  RATE_LIMITED: "请求过于频繁，请稍后再试",
  DAILY_QUOTA_EXCEEDED: "今日识别次数已达上限",
  QWEN_NOT_CONFIGURED: "服务端未配置 Qwen Key",
  BOOHEE_NOT_CONFIGURED: "服务端未配置 薄荷 Key",
  UPSTREAM_TIMEOUT: "服务超时，请稍后再试",
  UPSTREAM_ERROR: "AI 服务暂时不可用，请稍后再试",
  METHOD_NOT_ALLOWED: "请求方法不被允许",
  ROUTE_NOT_FOUND: "接口不存在",
  RECORD_NOT_FOUND: "记录不存在",
  NO_FOOD_DETECTED: "没有识别到食物，请重新拍摄",
  DATABASE_ERROR: "服务暂时不可用，请稍后再试",
};

const STATUS_FALLBACK: Record<number, string> = {
  400: "请求格式错误",
  401: "请先登录",
  404: "接口不存在",
  413: "图片过大，请重新选择或压缩图片",
  415: "图片格式不支持",
  429: "请求过于频繁，请稍后再试",
  502: "AI 服务暂时不可用，请稍后再试",
  503: "服务端未配置 API Key",
  504: "服务超时，请稍后再试",
};

export function describeApiError(status: number, payload?: ApiErrorPayload): string {
  const code = payload?.error?.code;
  if (code && ERROR_CODE_MESSAGES[code]) return ERROR_CODE_MESSAGES[code];
  if (typeof payload?.error?.message === "string" && payload.error.message) {
    return payload.error.message;
  }
  if (STATUS_FALLBACK[status]) return STATUS_FALLBACK[status];
  return `请求失败 (${status})`;
}

export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  /** Override timeout; default 30s (matches the upstream). */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export async function apiRequest<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
  const { body, timeoutMs = DEFAULT_TIMEOUT_MS, headers, ...rest } = options;
  const init: RequestInit = {
    ...rest,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(headers as Record<string, string> | undefined),
    },
  };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;

  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (err) {
    clearTimeout(timer);
    // Log full detail so we can see WHY the request failed: CORS,
    // DNS, offline, AbortError, etc.
    console.error("[apiRequest] fetch failed", {
      url,
      err: err instanceof Error ? { name: err.name, message: err.message } : err,
    });
    if (err instanceof Error && err.name === "AbortError") {
      throw new ApiError(`请求超时（${Math.round(timeoutMs / 1000)}s）`, 0, "UPSTREAM_TIMEOUT");
    }
    throw new ApiError(
      err instanceof Error && err.message
        ? `网络错误：${err.message}`
        : "网络错误，请检查连接后重试",
      0,
    );
  }
  clearTimeout(timer);

  let payload: unknown = null;
  const text = await response.text();
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!response.ok) {
    const errPayload = (payload as ApiErrorPayload | null) ?? undefined;
    const message = describeApiError(response.status, errPayload);
    throw new ApiError(message, response.status, errPayload?.error?.code);
  }
  return payload as T;
}
