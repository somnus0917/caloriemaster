export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10000;

export class FetchError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "FetchError";
    this.status = status;
  }
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
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function mapHttpError(status: number, body?: { error?: { message?: string } }): FetchError {
  let detail = String(status);
  if (body?.error?.message) detail += `: ${body.error.message}`;
  return new FetchError(detail, status);
}
