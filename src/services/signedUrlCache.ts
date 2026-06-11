/**
 * In-memory cache of short-lived OSS signed URLs.
 *
 * The URL returned by `/api/records/:id/image-url` is valid for ~10
 * minutes. The browser keeps it in JS memory only (NOT localStorage)
 * so a different browser / session cannot reuse it. The cache is
 * keyed by record id and image type; entries auto-expire one minute
 * before the server-stated expiry so we never serve a stale URL.
 *
 * `useAuth.logout()` calls `signedUrlCache.clear()` so the next
 * account starts with an empty cache.
 */

interface Entry {
  url: string;
  expiresAt: number; // ms epoch
}

const cache = new Map<string, Entry>();

const REFRESH_BUFFER_MS = 60_000; // refresh 1 minute early

function makeKey(recordId: string, type: "thumbnail" | "original"): string {
  return `${recordId}:${type}`;
}

export const signedUrlCache = {
  get(recordId: string, type: "thumbnail" | "original" = "thumbnail"): string | null {
    const entry = cache.get(makeKey(recordId, type));
    if (!entry) return null;
    if (entry.expiresAt - Date.now() < REFRESH_BUFFER_MS) {
      cache.delete(makeKey(recordId, type));
      return null;
    }
    return entry.url;
  },
  set(recordId: string, url: string, expiresInSeconds: number, type: "thumbnail" | "original" = "thumbnail"): void {
    cache.set(makeKey(recordId, type), {
      url,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });
  },
  invalidate(recordId: string): void {
    cache.delete(makeKey(recordId, "thumbnail"));
    cache.delete(makeKey(recordId, "original"));
  },
  clear(): void {
    cache.clear();
  },
  /** Test helper. */
  size(): number {
    return cache.size;
  },
};
