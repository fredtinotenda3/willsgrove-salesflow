import { describe, it, expect, afterAll } from "vitest";

/**
 * Milestone 0 fix (round 5): a real, opt-in integration test for the
 * orderDate/requestedDeliveryDate bug this round fixes -- runs
 * createOrder() against a REAL database through a REAL generated
 * @prisma/client, with the exact payload SHAPE from your round-5 bug
 * report (a manual-entry order with a date-only orderDate and
 * requestedDeliveryDate), so this specific class of bug -- a value that
 * type-checks cleanly but fails against a real database's DateTime
 * parser -- gets caught by `npm test` itself, not just by a manual
 * click-through.
 *
 * OFF BY DEFAULT, for one concrete reason: it needs a real database
 * connection and a real generated @prisma/client, neither of which this
 * sandbox has ever had (see docs/milestones/PROGRESS.md's "Sandbox-only
 * blocker" -- the @prisma/client here is a stub that THROWS when merely
 * constructed, present since round 1). Every import of lib/prisma.ts or
 * anything that imports it (lib/orders.ts included) is therefore done
 * with a dynamic `await import(...)` INSIDE the (skippable) test body
 * below, never as a static top-of-file import -- a static import would
 * construct the stub and crash `npm test` here even when this suite is
 * skipped, since Vitest still evaluates a test file's top-level imports
 * before deciding what to skip.
 *
 * On your machine, where `prisma generate` has actually run against a
 * real schema, set RUN_DB_INTEGRATION_TESTS=1 to include it (DATABASE_URL
 * is already required for every other command you run):
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` at least once first, so an admin
 * user and at least one customer already exist for this test to attach
 * its order to -- it looks them up rather than creating its own, and
 * skips itself with a console message (not a failure) if neither exists.
 *
 * This writes one real row, marked isDemo: true like any other seeded
 * demo data (so `npm run db:remove-demo` would clean it up like
 * anything else), and this test deletes it itself in `afterAll` as a
 * courtesy. If the process is killed before that runs, the row is still
 * just ordinary demo data, not a permanent fixture -- nothing here ever
 * touches a real, non-demo order.
 *
 * If you'd rather not set an env var for this: CHANGES.md's round-5
 * section has a short manual check that exercises the exact same path
 * through the browser instead.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("createOrder against a real database (round 5 regression)", () => {
  let createdOrderId: string | null = null;

  afterAll(async () => {
    if (!createdOrderId) {
      return;
    }
    const { prisma } = await import("@/lib/prisma");
    try {
      // Children first -- same FK-ordering rule as
      // scripts/remove-demo-data.ts, for the same reason.
      await prisma.orderLine.deleteMany({ where: { orderId: createdOrderId } });
      await prisma.customerOrder.delete({ where: { id: createdOrderId } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("accepts a date-only orderDate and requestedDeliveryDate -- the exact payload shape that returned HTTP 500 in the round-5 bug report", async () => {
    const { prisma } = await import("@/lib/prisma");
    const { createOrder } = await import("@/lib/orders");

    const admin = await prisma.user.findFirst({
      where: { role: "ADMINISTRATOR" },
      select: { id: true },
    });
    const customer = await prisma.customer.findFirst({ select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping createOrder DB integration test: no admin user and/or customer found. " +
          "Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      return;
    }

    const result = await createOrder(
      {
        customerId: customer.id,
        source: "MANUAL",
        orderDate: "2026-11-09",
        requestedDeliveryDate: "2026-11-12",
        lines: [
          {
            originalProductDescription: "Round 5 regression test line",
            requestedQuantity: "1",
            requestedUnitCode: "EA",
          },
        ],
      },
      admin.id,
      { isDemo: true }
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      // Unreachable given the assertion above; narrows the type for
      // the rest of this test and gives a clearer failure if it ever
      // somehow isn't.
      throw new Error(`createOrder failed: ${result.message}`);
    }

    createdOrderId = result.id;

    const stored = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: result.id },
      select: { orderDate: true, requestedDeliveryDate: true },
    });

    // The actual regression: both dates must round-trip to the exact
    // calendar day submitted, in UTC -- not rejected by Prisma's
    // DateTime parser (the 500 error in the bug report), and not shifted
    // by a day.
    expect(stored.orderDate).not.toBeNull();
    expect(stored.requestedDeliveryDate).not.toBeNull();
    expect(stored.orderDate?.toISOString().slice(0, 10)).toBe("2026-11-09");
    expect(stored.requestedDeliveryDate?.toISOString().slice(0, 10)).toBe("2026-11-12");
  });
});
