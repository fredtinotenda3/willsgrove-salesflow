import "server-only";

/**
 * In-memory sliding-window rate limiter.
 *
 * This is valid ONLY because Milestone 0 targets a single persistent
 * Node.js process (confirmed deployment decision: one server on
 * Willsgrove's network, not a horizontally-scaled/serverless target).
 * In-memory state is not shared across instances, so if this app is ever
 * deployed behind more than one Node process, this must move to a shared
 * store (Postgres table or Redis) -- flagged here deliberately so that
 * decision isn't silently invalidated by a future infra change.
 *
 * The map is also never persisted, so a process restart clears all
 * counters -- acceptable for login throttling, not a substitute for an
 * account-lockout policy if Willsgrove ever wants one.
 */

type Bucket = {
  hits: number[]; // epoch ms timestamps within the current window
};

const buckets = new Map<string, Bucket>();

// Opportunistic cleanup so the map doesn't grow unbounded over a long
// process lifetime. Runs at most once per minute, on whichever request
// happens to trigger it.
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number, windowMs: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export type RateLimitResult =
  | { allowed: true; remaining: number }
  | { allowed: false; retryAfterMs: number };

/**
 * Records one attempt for `key` and reports whether it's allowed under a
 * `limit` attempts per `windowMs` sliding window.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);

  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { hits: [] };
    buckets.set(key, bucket);
  }

  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);

  if (bucket.hits.length >= limit) {
    const oldest = bucket.hits[0];
    return { allowed: false, retryAfterMs: Math.max(0, windowMs - (now - oldest)) };
  }

  bucket.hits.push(now);
  return { allowed: true, remaining: limit - bucket.hits.length };
}

/** Login-specific defaults: 8 attempts per 10 minutes per (IP + email) pair. */
export const LOGIN_RATE_LIMIT = { limit: 8, windowMs: 10 * 60 * 1000 };

export function loginRateLimitKey(ipAddress: string, email: string): string {
  return `login:${ipAddress}:${email.trim().toLowerCase()}`;
}

/** Exposed for tests only, to reset state between cases. */
export function __resetRateLimitsForTests(): void {
  buckets.clear();
  lastSweep = 0;
}
