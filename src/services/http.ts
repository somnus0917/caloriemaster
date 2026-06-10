export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30000;

export class FetchError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = "FetchError";
    this.status = status;
    this.code = code;
  }
}

export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
}

const ERROR_CODE_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: "请求格式错误",
  UNSUPPORTED_MEDIA: "图片格式不支持，请使用 jpeg / png / webp",
  PAYLOAD_TOO_LARGE: "图片过大，请重新选择或压缩图片",
  QWEN_NOT_CONFIGURED: "服务端未配置 Qwen Key，请联系管理员",
  BOOHEE_NOT_CONFIGURED: "服务端未配置 薄荷 Key",
  UPSTREAM_TIMEOUT: "服务超时，请稍后再试",
  UPSTREAM_ERROR: "AI 服务暂时不可用，请稍后再试",
  METHOD_NOT_ALLOWED: "请求方法不被允许",
  ROUTE_NOT_FOUND: "接口不存在",
};

const STATUS_FALLBACK: Record<number, string> = {
  400: "请求格式错误",
  401: "API Key 无效或无权限",
  403: "API Key 无权限",
  404: "接口不存在",
  413: "图片过大，请重新选择或压缩图片",
  415: "图片格式不支持",
  429: "请求过于频繁，请稍后再试",
  502: "AI 服务暂时不可用，请稍后再试",
  503: "服务端未配置 API Key",
  504: "服务超时，请稍后再试",
};

/**
 * Map an HTTP status + optional server error payload to a user-readable
 * message. Server-supplied error codes take priority; we deliberately
 * do NOT keep searching for substrings in the message body.
 */
export function describeApiError(
  status: number,
  payload?: ApiErrorPayload,
): string {
  const code = payload?.error?.code;
  if (code && ERROR_CODE_MESSAGES[code]) {
    return ERROR_CODE_MESSAGES[code];
  }
  if (typeof payload?.error?.message === "string" && payload.error.message) {
    return payload.error.message;
  }
  if (STATUS_FALLBACK[status]) return STATUS_FALLBACK[status];
  return `请求失败 (${status})`;
}

export async function fetchWithTimeout(
  url: string,
  options: FetchOptions = {},
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...init } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new FetchError(
        `请求超时（${Math.round(timeoutMs / 1000)}s），请检查网络`,
        undefined,
        "UPSTREAM_TIMEOUT",
      );
    }
    throw new FetchError("网络错误，请检查连接后重试");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Read an error body and turn it into a `FetchError`. Used by service
 * modules after a non-2xx response.
 */
export async function readApiError(response: Response): Promise<FetchError> {
  let payload: ApiErrorPayload | undefined;
  try {
    payload = (await response.json()) as ApiErrorPayload;
  } catch {
    payload = undefined;
  }
  const message = describeApiError(response.status, payload);
  return new FetchError(message, response.status, payload?.error?.code);
}
