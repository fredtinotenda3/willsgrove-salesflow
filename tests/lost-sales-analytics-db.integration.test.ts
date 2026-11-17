import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Additional Implementation Requirements (spec section 3: "Lost Sales
 * Analytics Overhaul"). DB-backed acceptance tests for
 * lib/lost-sales/analytics-queries.ts's getLostSalesAnalytics -- the
 * single combined query backing the /lost-sales/analytics page, against
 * a REAL database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as every other
 * *-db.integration test in this project -- see
 * tests/lost-sales-db.integration.test.ts's own module comment.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user, a
 * DEMO-CUST-* customer, and at least two real, active, imported SAP
 * products must already exist).
 *
 * Scope, stated honestly: getLostSalesAnalytics's pure helpers
 * (bucketKeyForDate, computeShortageRate, percentileOfSorted,
 * buildHistogram, parseLostSalesAnalyticsPeriod) already have full,
 * dedicated unit coverage in tests/lost-sales-analytics-validation.test.ts
 * and are not re-derived here. This file covers the INTEGRATION this
 * module adds on top of them: that real UnfulfilledDemand rows are
 * correctly summed into KPIs/composition, that the default scope
 * genuinely excludes SUPERSEDED rows (the Additional Implementation
 * Requirements' own "correction/no-duplicate" rule, tying directly into
 * lib/lost-sales/create-unfulfilled-demand.ts's supersession logic,
 * covered on the creation side by tests/lost-sales-db.integration.test.ts),
 * and that MIN_DEMAND_COUNT_FOR_RATE_RANKING genuinely suppresses a
 * low-volume entry from the rate-based rankings. Trend bucketing,
 * top-N sorting, and the loss-reason/decision-type breakdowns are thin
 * wiring over already-proven pieces (bucketKeyForDate and the
 * demandCount sums immediately above) and are not independently
 * re-verified here.
 *
 * Every row this test creates is marked isDemo: true. KPI/composition
 * assertions use a strict BEFORE/AFTER delta within a single test (never
 * a snapshot total), since this customer/product combination is shared
 * with fixtures other *-db.integration test files also create -- the
 * same isolation pattern tests/reporting-db.integration.test.ts and
 * tests/fulfilment-db.integration.test.ts already rely on. The
 * threshold test instead uses a guaranteed-unique, unlinked product
 * description (so its own aggregation bucket cannot collide with any
 * other test's fixtures), rather than a delta, since it compares two
 * DIFFERENT bucket keys' presence/absence rather than one bucket's
 * growth.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Additional Implementation Requirements: lost-sales analytics", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let productAId: string;

  const createdOrderIds: string[] = [];
  // Chart intelligence enhancement: a couple of tests below need a
  // Product row with a KNOWN, controlled unitOfMeasure (to prove mixed-
  // UOM detection deterministically) rather than relying on whatever
  // unitOfMeasure happens to exist on seeded/imported data in a shared
  // database -- these are created fresh per test run and cleaned up here.
  const createdProductIds: string[] = [];
  const uniqueSuffix = `analytics-inttest-${Date.now()}`;

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({
      where: { sapCustomerCode: { startsWith: "DEMO-CUST" } },
      select: { id: true },
    });
    const products = await prisma.product.findMany({
      where: { isDemo: false, status: "ACTIVE" },
      orderBy: { sapItemCode: "asc" },
      take: 1,
      select: { id: true, sapItemCode: true },
    });

    if (!admin || !customer || products.length < 1) {
      console.log(
        "Skipping lost-sales analytics DB integration test: need an admin user, a DEMO-CUST-* customer, " +
          "and at least one active product. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;
    productAId = products[0]!.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.unfulfilledDemand.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.pickingSession.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
      // Safe only AFTER the order-chain rows above are gone (OrderLine/
      // UnfulfilledDemand.productId are both onDelete: SetNull against
      // Product, but the rows themselves no longer exist by this point
      // either way) -- these test-only Product rows are never referenced
      // by anything outside this file's own fixtures.
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  const baseFilters = (overrides: Partial<Record<string, unknown>> = {}) => ({
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
    currency: null,
    lostSalesReason: null,
    unfulfilledDemandStatus: null,
    customerDecisionType: null,
    includeDemo: true,
    productCategory: null,
    productSearch: null,
    sapItemCode: null,
    decisionCategory: null,
    priority: null,
    recommendationStatus: null,
    ...overrides,
  });

  /** One order, one line linked to productAId, picked with a deliberate, known shortage, and authorized once. */
  async function createOrderWithKnownShortage(requestedQuantity: string, unavailableQuantity: string, description = `Analytics item ${uniqueSuffix}-${Date.now()}`) {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

    const found = (Number(requestedQuantity) - Number(unavailableQuantity)).toFixed(4);
    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [{ lineNumber: 1, originalProductDescription: description, requestedQuantity, requestedUnitCode: "EA", productId: productAId, isDemo: true }],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    createdOrderIds.push(order.id);
    const lineId = order.lines[0]!.id;

    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    await recordPickedLine(started.session.id, lineId, found, unavailableQuantity, unavailableQuantity !== "0.0000" ? "Short on stock" : undefined, adminId);
    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    return { orderId: order.id, lineId };
  }

  it("sums a fresh, undecided demand into KPI totals and the composition 'undecided' bucket -- never into outstanding/cancelled/confirmedLost until a decision is actually recorded", async () => {
    if (skipAll) return;
    const { getLostSalesAnalytics } = await import("@/lib/lost-sales/analytics-queries");

    const filters = baseFilters({ productId: productAId });
    const before = await getLostSalesAnalytics(filters as never, "month", { page: 1, pageSize: 1 });

    await createOrderWithKnownShortage("10.0000", "5.0000");

    const after = await getLostSalesAnalytics(filters as never, "month", { page: 1, pageSize: 1 });

    const delta = (key: keyof typeof after.kpis) => Number(after.kpis[key]) - Number(before.kpis[key]);
    expect(delta("totalRequestedQuantity")).toBeCloseTo(10, 4);
    expect(delta("totalUnavailableQuantity")).toBeCloseTo(5, 4);

    const compositionDelta = (key: keyof typeof after.composition) =>
      Number(after.composition[key]) - Number(before.composition[key]);
    // Freshly authorized, no customer decision recorded yet -- the whole
    // shortage sits in "undecided," not outstanding/cancelled/confirmedLost.
    expect(compositionDelta("undecidedQuantity")).toBeCloseTo(5, 4);
    expect(compositionDelta("outstandingQuantity")).toBeCloseTo(0, 4);
    expect(compositionDelta("cancelledNotConfirmedLostQuantity")).toBeCloseTo(0, 4);
    expect(compositionDelta("confirmedLostQuantity")).toBeCloseTo(0, 4);
    expect(compositionDelta("totalUnavailableQuantity")).toBeCloseTo(5, 4);
  });

  it("Additional Implementation Requirements (correction/no-duplicate): the default scope excludes a SUPERSEDED demand's quantity entirely, counting only its replacement", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");
    const { getLostSalesAnalytics } = await import("@/lib/lost-sales/analytics-queries");

    const filters = baseFilters({ productId: productAId });
    const before = await getLostSalesAnalytics(filters as never, "month", { page: 1, pageSize: 1 });

    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [{ lineNumber: 1, originalProductDescription: `Supersession analytics item ${uniqueSuffix}`, requestedQuantity: "10.0000", requestedUnitCode: "EA", productId: productAId, isDemo: true }],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    createdOrderIds.push(order.id);
    const lineId = order.lines[0]!.id;

    // First pick: 4 unavailable of 10.
    const firstSession = await startPickingSession(order.id, adminId);
    if (!firstSession.ok) throw new Error(firstSession.message);
    await recordPickedLine(firstSession.session.id, lineId, "6.0000", "4.0000", "Short on stock", adminId);
    const firstCompleted = await completePickingSession(firstSession.session.id, adminId);
    if (!firstCompleted.ok) throw new Error(firstCompleted.message);
    const firstAuthorized = await authorizePickingSession(firstSession.session.id, adminId);
    if (!firstAuthorized.ok) throw new Error(firstAuthorized.message);

    // Re-pick correction: only 1 still unavailable of 10 -- supersedes the first demand.
    const secondSession = await startPickingSession(order.id, adminId);
    if (!secondSession.ok) throw new Error(secondSession.message);
    await recordPickedLine(secondSession.session.id, lineId, "9.0000", "1.0000", "Still short on re-count", adminId);
    const secondCompleted = await completePickingSession(secondSession.session.id, adminId);
    if (!secondCompleted.ok) throw new Error(secondCompleted.message);
    const secondAuthorized = await authorizePickingSession(secondSession.session.id, adminId);
    if (!secondAuthorized.ok) throw new Error(secondAuthorized.message);

    const after = await getLostSalesAnalytics(filters as never, "month", { page: 1, pageSize: 1 });

    // If the superseded row's 4.0000 were still counted alongside the
    // replacement's 1.0000, this delta would be 5 -- it must be exactly 1.
    const unavailableDelta = Number(after.kpis.totalUnavailableQuantity) - Number(before.kpis.totalUnavailableQuantity);
    expect(unavailableDelta).toBeCloseTo(1, 4);
    const requestedDelta = Number(after.kpis.totalRequestedQuantity) - Number(before.kpis.totalRequestedQuantity);
    // requestedQuantity is counted once per LIVE demand row, not per
    // picking session -- only the replacement (10) counts, not 10+10.
    expect(requestedDelta).toBeCloseTo(10, 4);

    // Explicitly re-including SUPERSEDED via the status filter still finds the original.
    const supersededView = await getLostSalesAnalytics(
      baseFilters({ productId: productAId, unfulfilledDemandStatus: "SUPERSEDED" }) as never,
      "month",
      { page: 1, pageSize: 1 }
    );
    expect(Number(supersededView.kpis.totalUnavailableQuantity)).toBeGreaterThanOrEqual(4);
  });

  it("MIN_DEMAND_COUNT_FOR_RATE_RANKING: a product with only 1 demand is excluded from shortageRateByProduct even at a 100% rate, while one with 3+ demands is ranked", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");
    const { getLostSalesAnalytics } = await import("@/lib/lost-sales/analytics-queries");

    // Below threshold: one unlinked line, one demand, 100% unavailable.
    // Unlinked (no productId) so its bucket key is
    // `unresolved:${productDescriptionSnapshot}` -- unique to this exact
    // description text, so it cannot collide with any other test's
    // fixtures in the same shared database.
    const belowDescription = `Below-threshold analytics product ${uniqueSuffix}`;
    const belowOrder = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: { create: [{ lineNumber: 1, originalProductDescription: belowDescription, requestedQuantity: "5.0000", requestedUnitCode: "EA", isDemo: true }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    createdOrderIds.push(belowOrder.id);
    const belowSession = await startPickingSession(belowOrder.id, adminId);
    if (!belowSession.ok) throw new Error(belowSession.message);
    await recordPickedLine(belowSession.session.id, belowOrder.lines[0]!.id, "0.0000", "5.0000", "None in stock", adminId);
    const belowCompleted = await completePickingSession(belowSession.session.id, adminId);
    if (!belowCompleted.ok) throw new Error(belowCompleted.message);
    const belowAuthorized = await authorizePickingSession(belowSession.session.id, adminId);
    if (!belowAuthorized.ok) throw new Error(belowAuthorized.message);

    // At/above threshold: one order, 3 unlinked lines sharing the SAME
    // description text (same bucket key), each independently short --
    // demandCount 3 for this bucket, meeting MIN_DEMAND_COUNT_FOR_RATE_RANKING.
    const atThresholdDescription = `At-threshold analytics product ${uniqueSuffix}`;
    const atThresholdOrder = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [1, 2, 3].map((lineNumber) => ({
            lineNumber,
            originalProductDescription: atThresholdDescription,
            requestedQuantity: "4.0000",
            requestedUnitCode: "EA",
            isDemo: true,
          })),
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    createdOrderIds.push(atThresholdOrder.id);
    const atThresholdSession = await startPickingSession(atThresholdOrder.id, adminId);
    if (!atThresholdSession.ok) throw new Error(atThresholdSession.message);
    for (const line of atThresholdOrder.lines) {
      await recordPickedLine(atThresholdSession.session.id, line.id, "2.0000", "2.0000", "Half in stock", adminId);
    }
    const atThresholdCompleted = await completePickingSession(atThresholdSession.session.id, adminId);
    if (!atThresholdCompleted.ok) throw new Error(atThresholdCompleted.message);
    const atThresholdAuthorized = await authorizePickingSession(atThresholdSession.session.id, adminId);
    if (!atThresholdAuthorized.ok) throw new Error(atThresholdAuthorized.message);

    // shortageRateByProduct is capped at the top 10 entries by rate
    // (TOP_N) -- a theoretical flakiness risk if 10+ unrelated products
    // from other fixtures in this shared database ever reach both the
    // count>=3 threshold AND a higher rate than this test's 50%, which
    // none of this suite's other fixtures do today (most create a single
    // demand per distinct product/description, already below the count
    // threshold and excluded regardless of rate). Documented here rather
    // than silently assumed.
    const result = await getLostSalesAnalytics(baseFilters({ customerId }) as never, "month", { page: 1, pageSize: 1 });

    expect(result.shortageRateByProduct.some((entry) => entry.productDescriptionSnapshot === belowDescription)).toBe(false);

    const atThresholdEntry = result.shortageRateByProduct.find((entry) => entry.productDescriptionSnapshot === atThresholdDescription);
    expect(atThresholdEntry).toBeDefined();
    if (atThresholdEntry) {
      expect(atThresholdEntry.demandCount).toBe(3);
      expect(atThresholdEntry.shortageRatePercent).toBeCloseTo(50, 1);
      // Chart intelligence enhancement: shortageRateByProduct now returns
      // the SAME rich LostSalesProductBreakdown shape every other
      // product chart on this page uses (affectedOrderCount/
      // affectedCustomerCount/estimatedValue/confirmedLostValue), not a
      // narrower rate-only row -- confirms the refactor that lets this
      // ranking reuse the identical rich tooltip as every other chart.
      expect(atThresholdEntry.affectedOrderCount).toBe(1);
      expect(atThresholdEntry.affectedCustomerCount).toBe(1);
      expect(atThresholdEntry.requestedQuantity).toBeDefined();
      expect(atThresholdEntry.confirmedLostValue).toBeDefined();
    }
  });

  it("Chart intelligence enhancement: a trend bucket's per-product breakdown attributes requested/found/unavailable to EACH contributing product separately, never collapsed into one combined row", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");
    const { getLostSalesAnalytics } = await import("@/lib/lost-sales/analytics-queries");

    // Two distinct, unlinked "virtual products" (unique description text,
    // no productId -- same technique the threshold test above uses) on
    // ONE order, so both land in the SAME trend bucket (this calendar
    // month) with clearly different, deliberately large quantities --
    // large so this fixture's own two rows are very unlikely to be
    // crowded out of the bucket's MAX_PRODUCTS_PER_BUCKET_TOOLTIP=8 cap
    // by other fixtures sharing this test database and the current
    // month, the same documented, accepted risk the threshold test above
    // already carries for its own TOP_N cap.
    const productXDescription = `Breakdown test product X ${uniqueSuffix}`;
    const productYDescription = `Breakdown test product Y ${uniqueSuffix}`;
    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [
            { lineNumber: 1, originalProductDescription: productXDescription, requestedQuantity: "900.0000", requestedUnitCode: "EA", isDemo: true },
            { lineNumber: 2, originalProductDescription: productYDescription, requestedQuantity: "500.0000", requestedUnitCode: "EA", isDemo: true },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, originalProductDescription: true } } },
    });
    createdOrderIds.push(order.id);
    const lineX = order.lines.find((l: { id: string; originalProductDescription: string | null }) => l.originalProductDescription === productXDescription);
    const lineY = order.lines.find((l: { id: string; originalProductDescription: string | null }) => l.originalProductDescription === productYDescription);
    if (!lineX || !lineY) throw new Error("fixture lines not created as expected");

    const session = await startPickingSession(order.id, adminId);
    if (!session.ok) throw new Error(session.message);
    await recordPickedLine(session.session.id, lineX.id, "540.0000", "360.0000", "Short on stock", adminId);
    await recordPickedLine(session.session.id, lineY.id, "410.0000", "90.0000", "Short on stock", adminId);
    const completed = await completePickingSession(session.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(session.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    const result = await getLostSalesAnalytics(baseFilters({ customerId }) as never, "month", { page: 1, pageSize: 1 });

    const now = new Date();
    const currentBucketKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const bucket = result.trend.find((t) => t.bucket === currentBucketKey);
    expect(bucket).toBeDefined();
    if (!bucket) return;

    const productX = bucket.products.find((p) => p.productDescriptionSnapshot === productXDescription);
    const productY = bucket.products.find((p) => p.productDescriptionSnapshot === productYDescription);
    expect(productX).toBeDefined();
    expect(productY).toBeDefined();
    if (productX) {
      expect(Number(productX.requestedQuantity)).toBeCloseTo(900, 4);
      expect(Number(productX.foundQuantity)).toBeCloseTo(540, 4);
      expect(Number(productX.unavailableQuantity)).toBeCloseTo(360, 4);
      expect(productX.affectedOrderCount).toBe(1);
      expect(productX.affectedCustomerCount).toBe(1);
    }
    if (productY) {
      expect(Number(productY.requestedQuantity)).toBeCloseTo(500, 4);
      expect(Number(productY.foundQuantity)).toBeCloseTo(410, 4);
      expect(Number(productY.unavailableQuantity)).toBeCloseTo(90, 4);
    }
    // The two products' own contributions stay distinguishable -- never
    // summed into one 360+90=450 row that would discard which product
    // actually drove the bucket's shortage.
    if (productX && productY) {
      expect(Number(productX.unavailableQuantity)).not.toBeCloseTo(Number(productY.unavailableQuantity), 4);
    }

    // The same two rows also surface, correctly attributed, in the
    // whole-scope product breakdown used by the top-unavailable-products
    // and requested/found/unavailable bar charts.
    const topX = result.topUnavailableProducts.find((p) => p.productDescriptionSnapshot === productXDescription);
    const topY = result.topUnavailableProducts.find((p) => p.productDescriptionSnapshot === productYDescription);
    if (topX) expect(Number(topX.unavailableQuantity)).toBeCloseTo(360, 4);
    if (topY) expect(Number(topY.unavailableQuantity)).toBeCloseTo(90, 4);
  });

  it("Chart intelligence enhancement: the automatic estimated-lost-value and a later customer-confirmed lost-sale value are two SEPARATE figures, never summed into one blended number", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { recordCustomerDecision } = await import("@/lib/lost-sales/record-decision");
    const { confirmLostSale } = await import("@/lib/lost-sales/confirm-lost-sale");
    const { getLostSalesAnalytics } = await import("@/lib/lost-sales/analytics-queries");

    const filters = baseFilters({ productId: productAId });
    const beforeCreation = await getLostSalesAnalytics(filters as never, "month", { page: 1, pageSize: 1 });

    const { orderId } = await createOrderWithKnownShortage("10.0000", "6.0000", `Estimated-vs-confirmed test ${uniqueSuffix}`);
    const demand = await prisma.unfulfilledDemand.findFirstOrThrow({ where: { orderId } });
    const afterCreation = await getLostSalesAnalytics(filters as never, "month", { page: 1, pageSize: 1 });

    // Moves the shortfall into cancelledQuantity first -- confirmLostSale
    // consumes from there (see that function's own module comment), same
    // two-step sequence tests/lost-sales-db.integration.test.ts's own
    // "scenario 15" already exercises.
    const decision = await recordCustomerDecision(
      { unfulfilledDemandId: demand.id, decisionType: "PARTIAL_CANCELLATION", source: "CUSTOMER_EMAIL", quantity: "6.0000" },
      adminId
    );
    expect(decision.ok).toBe(true);
    const confirmed = await confirmLostSale(
      { unfulfilledDemandId: demand.id, quantity: "6.0000", reason: "PRODUCT_UNAVAILABLE", decisionSource: "CUSTOMER_EMAIL" },
      adminId
    );
    expect(confirmed.ok).toBe(true);

    const afterConfirm = await getLostSalesAnalytics(filters as never, "month", { page: 1, pageSize: 1 });

    // The automatic estimate is set once, at demand-CREATION time, from
    // UnfulfilledDemand.estimatedValue -- confirming the lost sale must
    // never change it (it isn't recomputed, overwritten, or touched by
    // confirmLostSale at all), proving the two figures genuinely come
    // from two independent sources rather than one being derived from
    // the other.
    expect(Number(afterConfirm.kpis.totalEstimatedLostValue)).toBeCloseTo(Number(afterCreation.kpis.totalEstimatedLostValue), 4);

    // The confirmed-value delta matches EXACTLY what confirmLostSale
    // itself returned for this record (LostSaleRecord.estimatedValue) --
    // whether that happens to be a resolvable price or null (both are
    // valid outcomes depending on this fixture product's price data) --
    // never a re-derived figure and never added into the estimate above.
    if (confirmed.ok) {
      const confirmedDelta = Number(afterConfirm.kpis.totalConfirmedLostValue) - Number(beforeCreation.kpis.totalConfirmedLostValue);
      const expectedConfirmedValue = confirmed.record.estimatedValue === null ? 0 : Number(confirmed.record.estimatedValue);
      expect(confirmedDelta).toBeCloseTo(expectedConfirmedValue, 4);
    }
  });

  it("Chart intelligence enhancement: two products with different units of measure in the same scope are flagged as mixed and never silently combined into one misleading total", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");
    const { getLostSalesAnalytics } = await import("@/lib/lost-sales/analytics-queries");

    // Two fresh Product rows with a KNOWN, controlled unitOfMeasure each
    // -- deterministic regardless of whatever UOM data happens to exist
    // on seeded/SAP-imported products in this shared database.
    const kgProduct = await prisma.product.create({
      data: { sapItemCode: `TEST-UOM-KG-${uniqueSuffix}`, itemName: `UOM test product (kg) ${uniqueSuffix}`, unitOfMeasure: "KG", status: "ACTIVE", isDemo: true },
      select: { id: true },
    });
    const eaProduct = await prisma.product.create({
      data: { sapItemCode: `TEST-UOM-EA-${uniqueSuffix}`, itemName: `UOM test product (ea) ${uniqueSuffix}`, unitOfMeasure: "EA", status: "ACTIVE", isDemo: true },
      select: { id: true },
    });
    createdProductIds.push(kgProduct.id, eaProduct.id);

    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [
            { lineNumber: 1, originalProductDescription: "UOM mix test, kg line", productId: kgProduct.id, requestedQuantity: "15.0000", requestedUnitCode: "KG", isDemo: true },
            { lineNumber: 2, originalProductDescription: "UOM mix test, ea line", productId: eaProduct.id, requestedQuantity: "9.0000", requestedUnitCode: "EA", isDemo: true },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, productId: true } } },
    });
    createdOrderIds.push(order.id);
    const kgLine = order.lines.find((l: { id: string; productId: string | null }) => l.productId === kgProduct.id);
    const eaLine = order.lines.find((l: { id: string; productId: string | null }) => l.productId === eaProduct.id);
    if (!kgLine || !eaLine) throw new Error("fixture lines not created as expected");

    const session = await startPickingSession(order.id, adminId);
    if (!session.ok) throw new Error(session.message);
    await recordPickedLine(session.session.id, kgLine.id, "10.0000", "5.0000", "Short on stock", adminId);
    await recordPickedLine(session.session.id, eaLine.id, "6.0000", "3.0000", "Short on stock", adminId);
    const completed = await completePickingSession(session.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(session.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    // Filtered to ONE of the two products: exactly one unit, no ambiguity.
    const kgOnly = await getLostSalesAnalytics(baseFilters({ productId: kgProduct.id }) as never, "month", { page: 1, pageSize: 1 });
    expect(kgOnly.kpis.mixedUnitsOfMeasure).toBe(false);
    expect(kgOnly.kpis.quantityUnitCode).toBe("KG");

    // The combined (customer-scoped) view spans both units -- flagged as
    // mixed rather than silently reporting one unit, or adding 5 kg and
    // 3 individual pieces into one meaningless "8 units" total (spec
    // section 9's own "different UOMs are not combined into misleading
    // totals"). This holds regardless of whatever else this shared
    // customerId has in scope, since these two rows alone already
    // guarantee two distinct non-null units are present.
    const combined = await getLostSalesAnalytics(baseFilters({ customerId }) as never, "month", { page: 1, pageSize: 1 });
    expect(combined.kpis.mixedUnitsOfMeasure).toBe(true);
    expect(combined.kpis.quantityUnitCode).toBeNull();

    const kgBreakdown = combined.topUnavailableProducts.find((p) => p.productId === kgProduct.id);
    const eaBreakdown = combined.topUnavailableProducts.find((p) => p.productId === eaProduct.id);
    if (kgBreakdown) expect(kgBreakdown.unitOfMeasure).toBe("KG");
    if (eaBreakdown) expect(eaBreakdown.unitOfMeasure).toBe("EA");
  });
});
