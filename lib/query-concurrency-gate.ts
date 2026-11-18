/**
 * Workflow/Navigation/Performance round, Part 5. The pure, DB-free half
 * of the connection-pool-exhaustion fix -- see lib/prisma.ts's own module
 * comment for the full root-cause investigation and rationale. Split
 * into its own module, with no @prisma/client import, specifically so it
 * can be unit-tested directly (Part 8's own test requirement: "Prisma
 * singleton behavior... concurrent dashboard loading") -- the same
 * pure/impure split this codebase already uses throughout, e.g.
 * lib/lost-sales/analytics-validation.ts (pure) vs.
 * lib/lost-sales/analytics-queries.ts (Prisma-backed, "no unit test
 * possible without a real database/generated client" per
 * tests/decision-dashboard.test.ts's own module comment).
 */

export const DEFAULT_QUERY_CONCURRENCY = 6;

/**
 * Reads DATABASE_QUERY_CONCURRENCY from the given environment-like
 * record (defaults to process.env when called with no argument, but
 * accepting one explicitly is what makes this testable without mutating
 * the real process.env). Falls back to DEFAULT_QUERY_CONCURRENCY for
 * anything missing, non-numeric, zero, or negative, and clamps an
 * overlarge value to 50 -- this setting exists to keep concurrent
 * queries BELOW the connection pool's size, so a value that would itself
 * exceed any plausible pool size is clamped rather than trusted outright.
 */
export function resolveQueryConcurrency(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DATABASE_QUERY_CONCURRENCY;
  if (!raw) return DEFAULT_QUERY_CONCURRENCY;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_QUERY_CONCURRENCY;
  return Math.min(parsed, 50);
}

/**
 * A minimal, dependency-free FIFO semaphore. Deliberately hand-written
 * rather than pulling in a concurrency-limiting package (e.g. p-limit)
 * -- this is ~20 lines, needs no new dependency, and nothing here needs
 * that package's extra features (priority, abort signals, etc.).
 *
 * This is the actual mechanism behind lib/prisma.ts's Prisma Client
 * Extension: every model operation calls `run()`, so at most
 * `concurrency` of them ever execute at once, with the rest queued FIFO
 * and released one-for-one as earlier ones finish -- "controlled
 * concurrency," never a blind one-at-a-time serialization.
 */
export class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = concurrency;
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  private release(): void {
    const next = this.queue.shift();
    if (next) {
      // Handed directly to the next waiter -- `available` never goes
      // positive in between, so no two waiters can both see a free slot.
      next();
    } else {
      this.available += 1;
    }
  }
}
