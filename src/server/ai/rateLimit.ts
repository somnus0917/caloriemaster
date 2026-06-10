/**
 * In-process rate limiter.
 *
 * For a single-instance deployment this is sufficient. Multi-instance
 * deployments would need a shared store (PostgreSQL or Redis); see
 * README for the trade-off.
 */
import { ErrorCode } from "../errors.js";

interface Window {
  count: number;
  resetAt: number;
}

class SlidingWindowLimiter {
  private readonly map = new Map<string, Window>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /**
   * Returns { ok: true } if the action is allowed, or
   * { ok: false, retryAfter } if not.
   */
  hit(key: string): { ok: true } | { ok: false; retryAfter: number } {
    const now = Date.now();
    const w = this.map.get(key);
    if (!w || now >= w.resetAt) {
      this.map.set(key, { count: 1, resetAt: now + this.windowMs });
      return { ok: true };
    }
    if (w.count >= this.limit) {
      return { ok: false, retryAfter: Math.ceil((w.resetAt - now) / 1000) };
    }
    w.count += 1;
    return { ok: true };
  }

  /** Periodically evict expired entries to keep the map bounded. */
  sweep(): void {
    const now = Date.now();
    for (const [k, w] of this.map) {
      if (now >= w.resetAt) this.map.delete(k);
    }
  }
}

export interface RateLimiters {
  perUserPerMinute: SlidingWindowLimiter;
  perIpPerMinute: SlidingWindowLimiter;
  perIpAuth: SlidingWindowLimiter;
}

export function createRateLimiters(config: {
  AI_RATE_LIMIT_PER_MINUTE: number;
  AI_IP_RATE_LIMIT_PER_MINUTE: number;
  AUTH_RATE_LIMIT_PER_MINUTE: number;
}): RateLimiters {
  return {
    perUserPerMinute: new SlidingWindowLimiter(config.AI_RATE_LIMIT_PER_MINUTE, 60_000),
    perIpPerMinute: new SlidingWindowLimiter(config.AI_IP_RATE_LIMIT_PER_MINUTE, 60_000),
    perIpAuth: new SlidingWindowLimiter(config.AUTH_RATE_LIMIT_PER_MINUTE, 60_000),
  };
}

export { ErrorCode };
