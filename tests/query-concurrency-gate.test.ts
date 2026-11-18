import { describe, it, expect } from "vitest";
import { Semaphore, resolveQueryConcurrency, DEFAULT_QUERY_CONCURRENCY } from "@/lib/query-concurrency-gate";

/**
 * Workflow/Navigation/Performance round, Part 5 (database connection-pool
 * timeout fix) / Part 8 ("Prisma singleton behavior... concurrent
 * dashboard loading"). Unit tests for the actual mechanism behind
 * lib/prisma.ts's query-concurrency gate -- pure, no @prisma/client
 * import, so (like every other pure module in this codebase, e.g.
 * lib/reporting/decision-dashboard-period.ts tested by
 * tests/decision-dashboard.test.ts) these run unconditionally under
 * `npm test`, with no real database and no RUN_DB_INTEGRATION_TESTS gate.
 *
 * What this intentionally does NOT test: the dashboard's actual query
 * orchestration, aggregate correctness, demo-exclusion, or duplicate-
 * counting -- those properties live in the ~10 existing reporting
 * modules this fix never changed the logic of (only how many of their
 * calls may run concurrently), and are already covered by this
 * codebase's own DB-integration suite (e.g.
 * tests/reporting-db.integration.test.ts, tests/lost-sales-analytics-
 * db.integration.test.ts) -- see IMPLEMENTATION-REPORT.md's testing
 * section for exactly which pre-existing tests cover which property.
 * Those remain correct specifically because this fix never touched a
 * single query's filters, selects, or aggregation -- only the
 * concurrency they all share.
 */

describe("resolveQueryConcurrency", () => {
  it("defaults to DEFAULT_QUERY_CONCURRENCY when DATABASE_QUERY_CONCURRENCY is unset", () => {
    expect(resolveQueryConcurrency({})).toBe(DEFAULT_QUERY_CONCURRENCY);
  });

  it("defaults when the value is empty, non-numeric, zero, or negative", () => {
    expect(resolveQueryConcurrency({ DATABASE_QUERY_CONCURRENCY: "" })).toBe(DEFAULT_QUERY_CONCURRENCY);
    expect(resolveQueryConcurrency({ DATABASE_QUERY_CONCURRENCY: "not-a-number" })).toBe(DEFAULT_QUERY_CONCURRENCY);
    expect(resolveQueryConcurrency({ DATABASE_QUERY_CONCURRENCY: "0" })).toBe(DEFAULT_QUERY_CONCURRENCY);
    expect(resolveQueryConcurrency({ DATABASE_QUERY_CONCURRENCY: "-3" })).toBe(DEFAULT_QUERY_CONCURRENCY);
  });

  it("uses a valid operator-supplied value as-is", () => {
    expect(resolveQueryConcurrency({ DATABASE_QUERY_CONCURRENCY: "12" })).toBe(12);
    expect(resolveQueryConcurrency({ DATABASE_QUERY_CONCURRENCY: "1" })).toBe(1);
  });

  it("clamps an overlarge value to 50, never trusting it unbounded", () => {
    expect(resolveQueryConcurrency({ DATABASE_QUERY_CONCURRENCY: "500" })).toBe(50);
    expect(resolveQueryConcurrency({ DATABASE_QUERY_CONCURRENCY: "9999999" })).toBe(50);
  });
});

describe("Semaphore", () => {
  it("runs a task immediately when a slot is free", async () => {
    const gate = new Semaphore(2);
    const result = await gate.run(async () => "done");
    expect(result).toBe("done");
  });

  it("never lets more than `concurrency` tasks execute at the same time", async () => {
    const gate = new Semaphore(3);
    let inFlight = 0;
    let maxInFlight = 0;

    const makeTask = () => async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      // Yield control so overlapping calls genuinely interleave rather
      // than running start-to-finish before the next one is scheduled.
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return inFlight;
    };

    // 10 tasks, only 3 concurrency slots -- this is exactly the shape of
    // the real bug (many more Prisma calls fired at once than the
    // connection pool can serve).
    await Promise.all(Array.from({ length: 10 }, () => gate.run(makeTask())));

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(maxInFlight).toBeGreaterThan(0);
    expect(inFlight).toBe(0); // every task released its slot
  });

  it("queues excess tasks FIFO and releases them one-for-one as slots free up (controlled concurrency, not blind serialization)", async () => {
    const gate = new Semaphore(1);
    const order: number[] = [];

    const task = (id: number) =>
      gate.run(async () => {
        order.push(id);
        await new Promise((resolve) => setTimeout(resolve, 1));
        return id;
      });

    // Fire all three before any of them can possibly finish -- with
    // concurrency 1, task 2 must wait for task 1's slot, and task 3 for
    // task 2's, never running out of order.
    const results = await Promise.all([task(1), task(2), task(3)]);

    expect(order).toEqual([1, 2, 3]);
    expect(results).toEqual([1, 2, 3]);
  });

  it("releases the slot even when the task throws, so one failure can never deadlock the gate", async () => {
    const gate = new Semaphore(1);

    await expect(
      gate.run(async () => {
        throw new Error("simulated query failure");
      }),
    ).rejects.toThrow("simulated query failure");

    // If the slot weren't released on throw, this would hang forever
    // (and the test would time out) instead of resolving.
    const result = await gate.run(async () => "recovered");
    expect(result).toBe("recovered");
  });

  it("lets a full batch of concurrent tasks all eventually complete, exactly like one dashboard load's fan-out of Prisma calls", async () => {
    // Mirrors the real failure shape documented in lib/prisma.ts's module
    // comment: ~60-100+ concurrent calls against a small pool. Here: 80
    // tasks through a gate sized like the real DEFAULT_QUERY_CONCURRENCY,
    // asserting every single one still completes (nothing is dropped or
    // left stuck) and the concurrency ceiling is respected throughout.
    const gate = new Semaphore(DEFAULT_QUERY_CONCURRENCY);
    let inFlight = 0;
    let maxInFlight = 0;

    const tasks = Array.from({ length: 80 }, (_, i) =>
      gate.run(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight -= 1;
        return i;
      }),
    );

    const results = await Promise.all(tasks);

    expect(results).toHaveLength(80);
    expect(new Set(results).size).toBe(80); // every task ran exactly once
    expect(maxInFlight).toBeLessThanOrEqual(DEFAULT_QUERY_CONCURRENCY);
  });
});
