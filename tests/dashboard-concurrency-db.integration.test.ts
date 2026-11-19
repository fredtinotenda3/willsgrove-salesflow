import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { ReportFilters } from "@/lib/reporting/types";

/**
 * Workflow/Navigation/Performance round, Part 5 / Part 8's own test
 * list for this part: "Prisma singleton behavior, dashboard query
 * orchestration, lost-sales report summary, concurrent dashboard
 * loading, correct aggregates after consolidation, demo-exclusion
 * preserved, no duplicate counting."
 *
 * The pure, mechanism-level half of that list (the Semaphore's actual
 * concurrency-limiting behavior, FIFO ordering, failure handling, and
 * resolveQueryConcurrency's env-var parsing) is covered by
 * tests/query-concurrency-gate.test.ts, which needs no database and
 * always runs. This file covers the DB-backed half: that the real
 * dashboard orchestration (Home -> getDecisionDashboard ->
 * getOperationalDashboard -> getLostSalesReportSummary, the exact chain
 * in the originally reported "Timed out fetching a new connection"
 * error) still produces correct, demo-excluded results now that every
 * one of its ~60-100+ concurrent Prisma calls per load passes through
 * lib/prisma.ts's query-concurrency gate -- and that firing several such
 * loads AT ONCE (simulating several users hitting the homepage
 * simultaneously, the actual failure scenario) no longer exhausts the
 * pool.
 *
 * OFF BY DEFAULT, for the exact same sandbox reason as every other
 * -db.integration.test.ts file in this project (see e.g.
 * tests/lost-sales-db.integration.test.ts's own module comment):
 * @prisma/client here is a non-functional stub. Every lib touched below
 * is imported with a dynamic `await import(...)` inside the (skippable)
 * test bodies, never a static top-of-file import.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user must exist).
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

function emptyFilters(overrides: Partial<ReportFilters> = {}): ReportFilters {
  return {
    dateFrom: null,
    dateTo: null,
    customerId: null,
    productId: null,
    salespersonId: null,
    orderStatus: null,
    quotationStatus: null,
    fulfilmentStatus: null,
    claimStatus: null,
    communicationStatus: null,
    includeDemo: false,
    currency: null,
    lostSalesReason: null,
    productCategory: null,
    productSearch: null,
    sapItemCode: null,
    decisionCategory: null,
    priority: null,
    recommendationStatus: null,
    unfulfilledDemandStatus: null,
    lostSaleSource: null,
    ...overrides,
  };
}

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Part 5: dashboard query orchestration through the query-concurrency gate", () => {
  let skipAll = false;
  let adminId: string;
  let adminRole: string;
  let customerId: string;
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true, role: true } });
    const customer = await prisma.customer.findFirst({
      where: { sapCustomerCode: { startsWith: "DEMO-CUST" } },
      select: { id: true },
    });

    if (!admin || !customer) {
      console.log(
        "Skipping Part 5 dashboard-concurrency DB integration test: need an admin user and a DEMO-CUST-* " +
          "customer. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1.",
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    adminRole = admin.role;
    customerId = customer.id;
  });

  afterAll(async () => {
    if (skipAll || createdOrderIds.length === 0) return;
    const { prisma } = await import("@/lib/prisma");
    await prisma.customerOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
  });

  it("getDecisionDashboard (Home's own top-level call) completes successfully end to end, with every nested Prisma call passing through the concurrency gate", async () => {
    if (skipAll) return;
    const { getDecisionDashboard } = await import("@/lib/reporting/decision-dashboard");

    const dashboard = await getDecisionDashboard(adminId, adminRole, emptyFilters());

    // Not a deep assertion on report content (that's this suite's other,
    // already-existing report-specific tests' job) -- this asserts the
    // orchestration itself, through the real gate, actually resolves
    // rather than hanging or throwing a pool-timeout error.
    expect(dashboard).toBeDefined();
    expect(dashboard.snapshot).toBeDefined();

    // Real Business Data Onboarding round, Phase 9 (RBAC verification):
    // the Phase 7 "Source C" KPI tile is wired into the real end-to-end
    // orchestration (not just unit-constructed) and carries
    // visibility: "management" -- the exact field app/page.tsx's
    // `visibleKpis` filter (kpi.visibility === "all" || isManagement)
    // reads to decide whether a SALESPERSON ever sees it. This is the
    // actual RBAC boundary for this tile; app/page.tsx itself is a
    // server component with no render-test harness in this project, so
    // asserting on the data it filters on is this project's existing,
    // established way of covering that boundary (see this file's other
    // tests for the same "assert on the real orchestrated output"
    // approach).
    const returnedGoodsTile = dashboard.kpis.find((kpi) => kpi.id === "returnedGoodsLostSalesValue");
    expect(returnedGoodsTile).toBeDefined();
    expect(returnedGoodsTile?.visibility).toBe("management");
    expect(returnedGoodsTile?.area).toBe("lost_sales");

    // Same boundary, same reasoning, for the two sibling management-only
    // lost-sales/claims KPIs it sits beside -- a regression here (e.g. a
    // future edit that defaults visibility to "all") would silently
    // leak financial exposure figures to every role.
    const claimsExposureTile = dashboard.kpis.find((kpi) => kpi.area === "lost_sales" && kpi.id !== "returnedGoodsLostSalesValue" && kpi.id !== "estimatedLostSalesValue");
    const supplyShortageTile = dashboard.kpis.find((kpi) => kpi.id === "estimatedLostSalesValue");
    if (claimsExposureTile) expect(claimsExposureTile.visibility).toBe("management");
    expect(supplyShortageTile?.visibility).toBe("management");
  });

  it("firing several full dashboard loads concurrently -- simulating several users opening the homepage at once -- never throws a connection-pool-timeout error", async () => {
    if (skipAll) return;
    const { getDecisionDashboard } = await import("@/lib/reporting/decision-dashboard");

    // Each getDecisionDashboard call alone fans out to ~60-100+ Prisma
    // calls (see lib/prisma.ts's module comment); five of them at once
    // is comfortably past the originally reported 9-connection pool
    // limit if nothing were gating concurrency -- exactly the bug this
    // part fixes.
    const loads = await Promise.all(
      Array.from({ length: 5 }, () => getDecisionDashboard(adminId, adminRole, emptyFilters())),
    );

    expect(loads).toHaveLength(5);
    for (const dashboard of loads) {
      expect(dashboard).toBeDefined();
    }
  });

  it("demo-exclusion is preserved: a newly created isDemo order is excluded from getOperationalDashboard's snapshot counts when includeDemo is false, and included when it is true", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { getOperationalDashboard } = await import("@/lib/reporting/operational-dashboard");

    const before = await getOperationalDashboard(adminId, adminRole, emptyFilters({ includeDemo: false }));

    const demoOrder = await prisma.customerOrder.create({
      data: {
        reference: `DEMO-GATE-TEST-${Date.now()}`,
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        isDemo: true,
      },
      select: { id: true },
    });
    createdOrderIds.push(demoOrder.id);

    const afterExcluded = await getOperationalDashboard(adminId, adminRole, emptyFilters({ includeDemo: false }));
    expect(afterExcluded.snapshot.ordersReceived).toBe(before.snapshot.ordersReceived);

    const afterIncluded = await getOperationalDashboard(adminId, adminRole, emptyFilters({ includeDemo: true }));
    expect(afterIncluded.snapshot.ordersReceived).toBeGreaterThan(before.snapshot.ordersReceived);
  });

  it("no duplicate counting: calling getLostSalesReportSummary twice in parallel (through the same shared gate) returns identical totals both times", async () => {
    if (skipAll) return;
    const { getLostSalesReportSummary } = await import("@/lib/lost-sales/queries");

    const [first, second] = await Promise.all([
      getLostSalesReportSummary({ includeDemo: true }),
      getLostSalesReportSummary({ includeDemo: true }),
    ]);

    // The gate only limits HOW MANY of each call's internal queries run
    // at once -- it must never let two independent callers' queries
    // cross-contaminate each other's results.
    expect(first).toEqual(second);
  });
});
