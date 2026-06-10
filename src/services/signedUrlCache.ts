/**
 * In-memory cache of short-lived OSS signed URLs.
 *
 * The URL returned by `/api/records/:id/image-url` is valid for ~10
 * minutes. The browser keeps it in JS memory only (NOT localStorage)
 * so a different browser / session cannot reuse it. The cache is
 * keyed by record id; entries auto-expire one minute before the
 * server-stated expiry so we never serve a stale URL.
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

export const signedUrlCache = {
  get(recordId: string): string | null {
    const entry = cache.get(recordId);
    if (!entry) return null;
    if (entry.expiresAt - Date.now() < REFRESH_BUFFER_MS) {
      cache.delete(recordId);
      return null;
    }
    return entry.url;
  },
  set(recordId: string, url: string, expiresInSeconds: number): void {
    cache.set(recordId, {
      url,
      expiresAt: Date.now() + expiresInSeconds * 1000,
    });
  },
  invalidate(recordId: string): void {
    cache.delete(recordId);
  },
  clear(): void {
    cache.clear();
  },
  /** Test helper. */
  size(): number {
    return cache.size;
  },
};
