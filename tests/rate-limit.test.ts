import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  checkRateLimit,
  loginRateLimitKey,
  LOGIN_RATE_LIMIT,
  __resetRateLimitsForTests,
} from "@/lib/auth/rate-limit";

describe("checkRateLimit", () => {
  beforeEach(() => {
    __resetRateLimitsForTests();
  });

  it("allows requests up to the limit", () => {
    const key = "test:allow";
    for (let i = 0; i < 5; i++) {
      const result = checkRateLimit(key, 5, 60_000);
      expect(result.allowed).toBe(true);
    }
  });

  it("blocks the request once the limit is exceeded", () => {
    const key = "test:block";
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 60_000);
    }
    const sixth = checkRateLimit(key, 5, 60_000);
    expect(sixth.allowed).toBe(false);
    if (!sixth.allowed) {
      expect(sixth.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it("tracks separate buckets per key", () => {
    const a = "test:a";
    const b = "test:b";
    for (let i = 0; i < 5; i++) checkRateLimit(a, 5, 60_000);

    expect(checkRateLimit(a, 5, 60_000).allowed).toBe(false);
    expect(checkRateLimit(b, 5, 60_000).allowed).toBe(true);
  });

  it("allows requests again once the window has elapsed", () => {
    vi.useFakeTimers();
    try {
      const key = "test:window";
      for (let i = 0; i < 5; i++) checkRateLimit(key, 5, 1_000);
      expect(checkRateLimit(key, 5, 1_000).allowed).toBe(false);

      vi.advanceTimersByTime(1_001);

      expect(checkRateLimit(key, 5, 1_000).allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("decrements the remaining count as attempts are used", () => {
    const key = "test:remaining";
    const first = checkRateLimit(key, 3, 60_000);
    const second = checkRateLimit(key, 3, 60_000);
    expect(first.allowed && first.remaining).toBe(2);
    expect(second.allowed && second.remaining).toBe(1);
  });
});

describe("loginRateLimitKey", () => {
  it("normalizes email case and whitespace so the same account maps to one bucket", () => {
    const a = loginRateLimitKey("10.0.0.1", "User@Example.com");
    const b = loginRateLimitKey("10.0.0.1", "  user@example.com  ");
    expect(a).toBe(b);
  });

  it("differs by IP even for the same email", () => {
    const a = loginRateLimitKey("10.0.0.1", "user@example.com");
    const b = loginRateLimitKey("10.0.0.2", "user@example.com");
    expect(a).not.toBe(b);
  });
});

describe("LOGIN_RATE_LIMIT defaults", () => {
  it("is 8 attempts per 10 minutes", () => {
    expect(LOGIN_RATE_LIMIT.limit).toBe(8);
    expect(LOGIN_RATE_LIMIT.windowMs).toBe(10 * 60 * 1000);
  });
});
