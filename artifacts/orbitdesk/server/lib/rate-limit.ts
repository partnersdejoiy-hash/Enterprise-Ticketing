/**
 * OrbitDesk API-wide rate limiting (Phase A: Security Hardening).
 *
 * In-memory sliding-window limiter, keyed per (IP + authenticated user).
 * Complements the existing DB-backed per-endpoint limits in lib/security.ts
 * (login, password changes) with cheap global guards:
 *
 *   - General API:        100 req/min per client
 *   - AI endpoints:        20 req/min per client  (expensive provider calls)
 *   - Auth endpoints:      10 req/min per client  (brute-force surface)
 *
 * Exceeding the limit returns 429 with a Retry-After header.
 *
 * NOTE: in-memory state is per-process. On Vercel serverless each function
 * instance keeps its own buckets — this is a best-effort guard, not a
 * distributed throttle. Tight per-endpoint DB limits remain for critical
 * paths (login, password reset).
 */

import type { Request, Response, NextFunction } from "express";

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

// Sweep stale buckets every 60s so the map can't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    const cutoff = now - 120_000;
    const fresh = bucket.hits.filter((t) => t > cutoff);
    if (fresh.length === 0) buckets.delete(key);
    else bucket.hits = fresh;
  }
}, 60_000).unref?.();

export interface RateLimitOptions {
  /** Window in milliseconds. */
  windowMs: number;
  /** Max requests per window per client key. */
  max: number;
  /** Optional route prefix for the 429 message. */
  name?: string;
}

/**
 * Client key: authenticated user id when available (survives NAT/shared
 * IPs), otherwise the request IP. NOTE: when mounted in app.ts before
 * authMiddleware, only the IP is available — the key degrades gracefully.
 */
function clientKey(req: Request): string {
  const userId = (req as unknown as { user?: { id?: number } }).user?.id;
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.ip ||
    "unknown";
  return userId != null ? `u:${userId}` : `ip:${ip}`;
}

/** Create an Express middleware enforcing a sliding-window limit. */
export function rateLimitMiddleware(opts: RateLimitOptions) {
  const { windowMs, max, name = "API" } = opts;
  return (req: Request, res: Response, next: NextFunction) => {
    // Sliding window: per-client timestamps, pruned to the window on each hit.
    const key = `${name}:${clientKey(req)}`;
    let bucket = buckets.get(key);
    const now = Date.now();
    if (!bucket) {
      bucket = { hits: [] };
      buckets.set(key, bucket);
    }
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

    if (bucket.hits.length >= max) {
      const oldest = bucket.hits[0] ?? now;
      const retryAfter = Math.max(
        1,
        Math.ceil((windowMs - (now - oldest)) / 1000),
      );
      res.setHeader("Retry-After", String(retryAfter));
      res
        .status(429)
        .json({
          error: "Too many requests",
          message: `${name} rate limit exceeded. Retry in ${retryAfter}s.`,
          retryAfter,
        });
      return;
    }
    bucket.hits.push(now);
    // Informational headers (best-effort, non-standard names).
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader(
      "X-RateLimit-Remaining",
      String(Math.max(0, max - bucket.hits.length)),
    );
    next();
  };
}

/** Preconfigured limiters for app.ts. */
export const generalApiLimiter = () =>
  rateLimitMiddleware({ windowMs: 60_000, max: 100, name: "API" });

export const aiApiLimiter = () =>
  rateLimitMiddleware({ windowMs: 60_000, max: 20, name: "AI" });

export const authApiLimiter = () =>
  rateLimitMiddleware({ windowMs: 60_000, max: 10, name: "Auth" });
