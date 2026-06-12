/**
 * Minimal in-memory rate limiter (fixed window).
 * Suitable for single-instance deploys (Railway, Fly, VPS, Docker).
 *
 * For distributed / high-scale use, replace with @upstash/ratelimit + Redis/Upstash.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

function now() {
  return Date.now();
}

/**
 * Returns whether the action is allowed.
 * key: usually `${ip}:${route}` or just ip
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfter?: number } {
  const t = now();
  let b = buckets.get(key);

  if (!b || t > b.resetAt) {
    b = { count: 0, resetAt: t + windowMs };
    buckets.set(key, b);
  }

  b.count += 1;

  if (b.count > limit) {
    const retryAfter = Math.max(0, Math.ceil((b.resetAt - t) / 1000));
    return { allowed: false, retryAfter };
  }

  return { allowed: true };
}

/** For tests */
export function __resetRateLimitBuckets() {
  buckets.clear();
}