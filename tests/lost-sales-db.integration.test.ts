import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 4 (Lost-Sales Management), rewritten for the Real Business
 * Data Onboarding round's removal of the Customer Decision workflow
 * (spec PART A). DB-backed acceptance tests for the full automatic
 * lost-sales lifecycle -- UnfulfilledDemand creation on authorization,
 * IMMEDIATE AND AUTOMATIC cancellation + lost-sale confirmation (no
 * human decision step), re-pick/correction supersession ("update, not
 * duplicate"), original-PO immutability, audit history, and reporting --
 * against a REAL database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as
 * tests/picking-db.integration.test.ts and
 * tests/handover-db.integration.test.ts: @prisma/client in this sandbox
 * is a stub that THROWS when merely constructed (see
 * docs/milestones/PROGRESS.md's "Sandbox-only blocker"). Every lib
 * touched here is imported with a dynamic `await import(...)` INSIDE the
 * (skippable) test bodies below, never a static top-of-file import.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user, a
 * DEMO-CUST-* customer, and at least two real, active, imported SAP
 * products must already exist).
 *
 * Real Business Data Onboarding round: there is no longer a
 * recordCustomerDecision/confirmLostSale lib function, and no NEW
 * UnfulfilledDemand can ever reach PENDING_DECISION/AWAITING_SUPPLY/
 * PARTIALLY_CANCELLED/FULLY_CANCELLED/RESOLVED any more -- see
 * lib/lost-sales/validation.ts's module comment and
 * lib/lost-sales/create-unfulfilled-demand.ts's module comment for the
 * full design (the CustomerDecisionEvent model and those five status
 * values are kept at the schema level, unused by any surviving code
 * path, purely for historical-data safety -- see prisma/schema.prisma).
 * Every test below that used to drive the old decision/
 * confirm lifecycle has been rewritten to check the new automatic
 * behaviour directly; tests that existed ONLY to exercise decision-bucket
 * arithmetic that no longer exists (accept-and-cancel-remainder,
 * wait/partial/substitute mixes, outstanding-to-cancelled conversion on
 * confirm, substitute-product validation) have been removed outright
 * rather than left testing dead code.
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 4: lost-sales management (automatic, spec PART A)", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let productAId: string;
  let productASapCode: string;

  const createdOrderIds: string[] = [];
  const uniqueSuffix = `inttest-${Date.now()}`;

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({
      where: { sapCustomerCode: { startsWith: "DEMO-CUST" } },
      select: { id: true },
    });
    // Real Business Data Onboarding round (spec PART A): only ONE product
    // is needed now -- the second product this file used to keep around
    // (take: 2) existed solely to exercise SUBSTITUTE_ACCEPTED's
    // substituteProductId, a decision outcome that no longer exists.
    const products = await prisma.product.findMany({
      where: { isDemo: false, status: "ACTIVE" },
      orderBy: { sapItemCode: "asc" },
      take: 1,
      select: { id: true, sapItemCode: true },
    });

    if (!admin || !customer || products.length < 1) {
      console.log(
        "Skipping Milestone 4 lost-sales DB integration test: need an admin user, a DEMO-CUST-* customer, " +
          "and at least one active product. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;
    productAId = products[0]!.id;
    productASapCode = products[0]!.sapItemCode;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      // Deletion order respects every onDelete: Restrict FK this
      // milestone added -- LostSaleRecord before UnfulfilledDemand,
      // UnfulfilledDemand before PickingSession. There is no longer a
      // CustomerDecisionEvent table to clear first.
      await prisma.lostSaleRecord.deleteMany({ where: { unfulfilledDemand: { orderId: { in: createdOrderIds } } } });
      await prisma.unfulfilledDemand.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      // PickingLine rows cascade-delete with their PickingSession.
      await prisma.pickingSession.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      // AuditEvent.entityId is a plain string column with no DB-level FK
      // (see AuditEvent's schema definition), so it never blocks deleting
      // the rows above or below it, and -- being append-only by design,
      // the same convention documented on every other audit trail in this
      // codebase -- this test deliberately leaves its own audit rows in
      // place rather than pruning them. A blanket delete by entityType
      // would risk removing unrelated audit history from outside this
      // test run, which is strictly worse than a few harmless orphaned
      // rows referencing already-deleted demo records.
      await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /**
   * One order with 3 lines: fully available, partially available, and
   * completely unavailable -- exercises spec test scenarios 1, 2, 3, and
   * 20 (multiple unavailable products in one order) in a single fixture.
   * Line 2 is pre-linked to a live Product (productAId) so creation's
   * three-way resolution is exercised against a real catalogue match;
   * line 3 is left unlinked so it falls back to the customer's own
   * wording, exactly like resolve-fields.ts's own unit tests.
   */
  async function createThreeLineOrderAndAuthorize() {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

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
            {
              lineNumber: 1,
              originalProductDescription: `Fully available item ${uniqueSuffix}`,
              requestedQuantity: "20.0000",
              requestedUnitCode: "EA",
              isDemo: true,
            },
            {
              lineNumber: 2,
              originalProductDescription: `Customer wording for line 2 ${uniqueSuffix}`,
              requestedQuantity: "20.0000",
              requestedUnitCode: "EA",
              productId: productAId,
              approvedUnitPrice: "15.5000",
              isDemo: true,
            },
            {
              lineNumber: 3,
              originalProductDescription: `Customer wording for line 3 ${uniqueSuffix}`,
              requestedQuantity: "10.0000",
              requestedUnitCode: "EA",
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, lineNumber: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdOrderIds.push(order.id);
    const [line1, line2, line3] = order.lines;

    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);

    // Line 1: fully available.
    await recordPickedLine(started.session.id, line1!.id, "20.0000", "0.0000", undefined, adminId);
    // Line 2: partially available -- 12 found, 8 unavailable.
    await recordPickedLine(started.session.id, line2!.id, "12.0000", "8.0000", undefined, adminId);
    // Line 3: completely unavailable -- 0 found, 10 unavailable.
    await recordPickedLine(started.session.id, line3!.id, "0.0000", "10.0000", undefined, adminId);

    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    return { orderId: order.id, line1Id: line1!.id, line2Id: line2!.id, line3Id: line3!.id };
  }

  it("scenarios 1/2/3/20: authorization creates exactly one UnfulfilledDemand per unavailable line (none for the fully-available line), each IMMEDIATELY and AUTOMATICALLY cancelled and confirmed lost -- no customer-decision step", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");

    const { orderId, line1Id, line2Id, line3Id } = await createThreeLineOrderAndAuthorize();

    const demands = await prisma.unfulfilledDemand.findMany({
      where: { orderId },
      orderBy: { orderLineId: "asc" },
    });
    expect(demands).toHaveLength(2);
    expect(demands.some((d) => d.orderLineId === line1Id)).toBe(false);

    const line2Demand = demands.find((d) => d.orderLineId === line2Id)!;
    expect(line2Demand.requestedQuantity.toString()).toBe("20.0000");
    expect(line2Demand.foundQuantity.toString()).toBe("12.0000");
    expect(line2Demand.unavailableQuantity.toString()).toBe("8.0000");
    expect(line2Demand.productId).toBe(productAId);
    expect(line2Demand.sapItemCodeSnapshot).toBe(productASapCode);
    // Real Business Data Onboarding round (spec PART A): automatically
    // and fully cancelled AND confirmed lost the instant it was recorded
    // -- never PENDING_DECISION (that value is only ever reachable by a
    // row created before this round; a NEW demand can never land there).
    expect(line2Demand.status).toBe("CONFIRMED_LOST");
    expect(line2Demand.cancelledQuantity.toString()).toBe("8.0000");
    expect(line2Demand.confirmedLostQuantity.toString()).toBe("8.0000");
    expect(line2Demand.outstandingQuantity.toString()).toBe("0.0000");
    expect(line2Demand.substitutedQuantity.toString()).toBe("0.0000");

    const line3Demand = demands.find((d) => d.orderLineId === line3Id)!;
    expect(line3Demand.unavailableQuantity.toString()).toBe("10.0000");
    expect(line3Demand.productId).toBeNull();
    expect(line3Demand.productDescriptionSnapshot).toBe(`Customer wording for line 3 ${uniqueSuffix}`);
    expect(line3Demand.status).toBe("CONFIRMED_LOST");
    expect(line3Demand.cancelledQuantity.toString()).toBe("10.0000");
    expect(line3Demand.confirmedLostQuantity.toString()).toBe("10.0000");

    // Each automatically-created demand has its own automatically-created
    // LostSaleRecord -- reason is picked mechanically from whether
    // anything was found at all: line2 found SOME (12 > 0) so its reason
    // is INSUFFICIENT_QUANTITY; line3 found NONE so its reason is
    // PRODUCT_UNAVAILABLE. Both carry decisionSource
    // AUTOMATIC_SYSTEM_RECORDED -- no human ever decided anything.
    const line2Record = await prisma.lostSaleRecord.findFirstOrThrow({ where: { unfulfilledDemandId: line2Demand.id } });
    expect(line2Record.reason).toBe("INSUFFICIENT_QUANTITY");
    expect(line2Record.decisionSource).toBe("AUTOMATIC_SYSTEM_RECORDED");
    expect(line2Record.quantity.toString()).toBe("8.0000");
    expect(line2Record.estimatedUnitPrice?.toString()).toBe("15.5000");
    expect(line2Record.estimatedValue?.toString()).toBe("124.0000"); // 15.5 * 8
    expect(line2Record.estimatedValueSource).toBe("ORDER_LINE_APPROVED_PRICE");

    const line3Record = await prisma.lostSaleRecord.findFirstOrThrow({ where: { unfulfilledDemandId: line3Demand.id } });
    expect(line3Record.reason).toBe("PRODUCT_UNAVAILABLE");
    expect(line3Record.decisionSource).toBe("AUTOMATIC_SYSTEM_RECORDED");
    expect(line3Record.quantity.toString()).toBe("10.0000");

    // Scenario 16: audit history preserved for the creation AND the
    // automatic confirmation.
    const creationEvents = await prisma.auditEvent.findMany({
      where: { action: "UNFULFILLED_DEMAND_CREATED", entityId: { in: [line2Demand.id, line3Demand.id] } },
    });
    expect(creationEvents).toHaveLength(2);
    const confirmEvents = await prisma.auditEvent.findMany({
      where: { action: "LOST_SALE_CONFIRMED", entityId: { in: [line2Demand.id, line3Demand.id] } },
    });
    expect(confirmEvents).toHaveLength(2);
  });

  /**
   * One order, one line, picked and authorized once (establishing an
   * initial shortage), then re-picked a second time (lib/picking/
   * start-picking.ts explicitly allows this once the prior session is
   * AUTHORIZED -- a deliberate re-pick/correction, not a reopen). The
   * caller supplies the SECOND session's found/unavailable split, so the
   * same fixture drives both the "corrected to a smaller shortage" and
   * "corrected to fully available" scenarios below.
   */
  async function createOrderPickedTwice(firstFound: string, firstUnavailable: string, secondFound: string, secondUnavailable: string) {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

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
            {
              lineNumber: 1,
              originalProductDescription: `Re-pick correction item ${uniqueSuffix}`,
              requestedQuantity: "10.0000",
              requestedUnitCode: "EA",
              productId: productAId,
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    createdOrderIds.push(order.id);
    const lineId = order.lines[0]!.id;

    const firstSession = await startPickingSession(order.id, adminId);
    if (!firstSession.ok) throw new Error(firstSession.message);
    await recordPickedLine(firstSession.session.id, lineId, firstFound, firstUnavailable, "Short on stock", adminId);
    const firstCompleted = await completePickingSession(firstSession.session.id, adminId);
    if (!firstCompleted.ok) throw new Error(firstCompleted.message);
    const firstAuthorized = await authorizePickingSession(firstSession.session.id, adminId);
    if (!firstAuthorized.ok) throw new Error(firstAuthorized.message);

    // The first (and, at this point, only) UnfulfilledDemand for this
    // order line -- created by the first authorization just above.
    const originalDemand = await prisma.unfulfilledDemand.findFirstOrThrow({ where: { orderLineId: lineId } });

    const secondSession = await startPickingSession(order.id, adminId);
    if (!secondSession.ok) throw new Error(secondSession.message);
    await recordPickedLine(secondSession.session.id, lineId, secondFound, secondUnavailable, secondUnavailable !== "0.0000" ? "Still short on re-count" : undefined, adminId);
    const secondCompleted = await completePickingSession(secondSession.session.id, adminId);
    if (!secondCompleted.ok) throw new Error(secondCompleted.message);
    const secondAuthorized = await authorizePickingSession(secondSession.session.id, adminId);
    if (!secondAuthorized.ok) throw new Error(secondAuthorized.message);

    return { orderId: order.id, lineId, originalDemandId: originalDemand.id };
  }

  it("Additional Implementation Requirements (lost-sales automation), still true under spec PART A: a re-pick correction with a reduced-but-still-real shortage supersedes the original demand with its OWN freshly-confirmed-lost replacement, never a duplicate", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");

    // First pick: 4 unavailable out of 10. Second pick (correction): only
    // 1 still unavailable out of 10 -- more stock turned up, but not all of it.
    const { lineId, originalDemandId } = await createOrderPickedTwice("6.0000", "4.0000", "9.0000", "1.0000");

    const original = await prisma.unfulfilledDemand.findUniqueOrThrow({ where: { id: originalDemandId } });
    expect(original.status).toBe("SUPERSEDED");
    expect(original.supersededByDemandId).not.toBeNull();
    // The superseded row's own quantity bucket is untouched by the
    // correction -- it still reflects exactly what was recorded at the
    // time, never silently rewritten to match the new session. It was
    // itself automatically cancelled/confirmed-lost for 4.0000 before
    // being superseded -- that history is preserved, not erased.
    expect(original.unavailableQuantity.toString()).toBe("4.0000");
    expect(original.confirmedLostQuantity.toString()).toBe("4.0000");

    const replacement = await prisma.unfulfilledDemand.findUniqueOrThrow({ where: { id: original.supersededByDemandId! } });
    expect(replacement.orderLineId).toBe(lineId);
    expect(replacement.unavailableQuantity.toString()).toBe("1.0000");
    // The replacement is itself immediately and automatically confirmed
    // lost for its OWN (smaller) quantity -- never PENDING_DECISION.
    expect(replacement.status).toBe("CONFIRMED_LOST");
    expect(replacement.confirmedLostQuantity.toString()).toBe("1.0000");

    // No-duplicate guarantee: exactly one NON-superseded UnfulfilledDemand
    // exists for this order line -- an aggregate that sums every
    // non-superseded row never double-counts the same shortage twice.
    const liveDemandsForLine = await prisma.unfulfilledDemand.findMany({
      where: { orderLineId: lineId, status: { not: "SUPERSEDED" } },
    });
    expect(liveDemandsForLine).toHaveLength(1);
    expect(liveDemandsForLine[0]!.id).toBe(replacement.id);

    // "Update, not duplicate" extends to LostSaleRecord too: the original
    // demand's own record (4.0000) is untouched history, and the
    // replacement has exactly one record of its own (1.0000) -- never two
    // records double-counting the same corrected shortage.
    const originalRecords = await prisma.lostSaleRecord.findMany({ where: { unfulfilledDemandId: original.id } });
    expect(originalRecords).toHaveLength(1);
    expect(originalRecords[0]!.quantity.toString()).toBe("4.0000");
    const replacementRecords = await prisma.lostSaleRecord.findMany({ where: { unfulfilledDemandId: replacement.id } });
    expect(replacementRecords).toHaveLength(1);
    expect(replacementRecords[0]!.quantity.toString()).toBe("1.0000");

    // Correction is itself audited, distinctly from the original creation.
    const supersessionEvents = await prisma.auditEvent.findMany({
      where: { action: "UNFULFILLED_DEMAND_SUPERSEDED", entityId: originalDemandId },
    });
    expect(supersessionEvents).toHaveLength(1);
  });

  it("Additional Implementation Requirements (lost-sales automation), still true under spec PART A: a re-pick correction that finds the line fully available supersedes the original demand with NO replacement (zero outstanding, zero duplicate)", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");

    // First pick: fully unavailable (0 found of 10). Second pick
    // (correction): fully available this time (10 found of 10) -- the
    // spec's own worked example ("corrected to 100: reverse the
    // outstanding estimated lost sales to zero").
    const { lineId, originalDemandId } = await createOrderPickedTwice("0.0000", "10.0000", "10.0000", "0.0000");

    const original = await prisma.unfulfilledDemand.findUniqueOrThrow({ where: { id: originalDemandId } });
    expect(original.status).toBe("SUPERSEDED");
    // No replacement row exists for a line that is no longer short at all.
    expect(original.supersededByDemandId).toBeNull();

    // Zero live (non-superseded) UnfulfilledDemand rows for this line --
    // the correction fully resolved it, and nothing was left behind to
    // double-count in a reporting aggregate.
    const liveDemandsForLine = await prisma.unfulfilledDemand.findMany({
      where: { orderLineId: lineId, status: { not: "SUPERSEDED" } },
    });
    expect(liveDemandsForLine).toHaveLength(0);

    const supersessionEvents = await prisma.auditEvent.findMany({
      where: { action: "UNFULFILLED_DEMAND_SUPERSEDED", entityId: originalDemandId },
    });
    expect(supersessionEvents).toHaveLength(1);
    const afterData = supersessionEvents[0]!.afterData as { supersededByDemandId: string | null };
    expect(afterData.supersededByDemandId).toBeNull();
  });

  it("scenario 15: the automatic shortage/lost-sales recording never touches the original Customer PO", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");

    const { orderId, line2Id } = await createThreeLineOrderAndAuthorize();
    const after = await prisma.orderLine.findUniqueOrThrow({ where: { id: line2Id } });

    // Real Business Data Onboarding round (spec PART A): no decision/
    // confirm step to run -- createThreeLineOrderAndAuthorize's own
    // authorizePickingSession call already recorded the automatic
    // cancellation and lost-sale confirmation. The original PO fields are
    // asserted directly against the values the fixture itself supplied,
    // since there is no separate "before" snapshot to compare against --
    // authorization and automatic lost-sales recording happen in the
    // same transaction.
    expect(after.requestedQuantity.toString()).toBe("20.0000");
    expect(after.originalProductDescription).toBe(`Customer wording for line 2 ${uniqueSuffix}`);
    expect(after.approvedUnitPrice?.toString()).toBe("15.5000");

    const order = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("READY_TO_INVOICE");
  });

  it("scenario 18: reporting figures reflect what was automatically recorded, with distinct unavailable/confirmed-lost totals", async () => {
    if (skipAll) return;
    const { listUnfulfilledDemands, getLostSalesReportSummary } = await import("@/lib/lost-sales/queries");

    await createThreeLineOrderAndAuthorize();
    const { demands } = await listUnfulfilledDemands({ page: 1, pageSize: 50, customerId, includeDemo: true });
    expect(demands.length).toBeGreaterThanOrEqual(2);

    const line2Demand = demands.find((d) => d.unavailableQuantity === "8.0000")!;
    expect(line2Demand.status).toBe("CONFIRMED_LOST");

    const summary = await getLostSalesReportSummary({ includeDemo: true });
    expect(Number(summary.totalConfirmedLostQuantity)).toBeGreaterThanOrEqual(18); // this test's 8 + 10, automatically
    expect(Number(summary.totalUnavailableQuantity)).toBeGreaterThanOrEqual(18); // at least this test's 8 + 10
    const productEntry = summary.topConfirmedLostProducts.find((p) => p.sapItemCodeSnapshot === productASapCode);
    expect(productEntry).toBeDefined();
    if (productEntry) expect(Number(productEntry.totalQuantity)).toBeGreaterThanOrEqual(8);
    const reasonEntry = summary.lossReasonBreakdown.find((r) => r.reason === "PRODUCT_UNAVAILABLE");
    expect(reasonEntry).toBeDefined();
  });

  /**
   * Final Operational Enhancements (spec Part 7, Source B): "Estimated
   * Supply Lost Sales = Unavailable Quantity x Applicable Selling Price,"
   * summed across every LostSaleRecord that has a resolvable price --
   * never inventing one for a record that has none (see
   * lib/lost-sales/estimate-value.ts's own comment, exercised above by
   * "scenarios 1/2/3/20"'s own estimatedValue assertions). Real Business
   * Data Onboarding round: this figure is now populated automatically on
   * authorization, not on a separate manual confirmation.
   */
  it("Source B: getSupplyShortageLostSalesValue sums estimatedValue across automatically-created LostSaleRecords, excluding (and counting separately) those with no resolvable price", async () => {
    if (skipAll) return;
    const { getSupplyShortageLostSalesValue } = await import("@/lib/lost-sales/queries");
    const { prisma } = await import("@/lib/prisma");

    const before = await getSupplyShortageLostSalesValue({ includeDemo: true });

    // line2 was created with approvedUnitPrice "15.5000"; its 8.0000
    // unavailable units are automatically confirmed lost on
    // authorization, giving a known, exact estimatedValue of 124.0000
    // (15.5 * 8) -- see "scenarios 1/2/3/20" above for the same math.
    await createThreeLineOrderAndAuthorize();

    const after = await getSupplyShortageLostSalesValue({ includeDemo: true });
    // The sum grew by exactly 124.0000 -- not re-derived from scratch,
    // not blended with any other figure (e.g. invoice-claims exposure).
    expect(Number(after.estimatedValue) - Number(before.estimatedValue)).toBeCloseTo(124, 4);
    expect(after.recordsWithEstimate).toBeGreaterThan(before.recordsWithEstimate);
    // recordsWithEstimate + recordsWithoutEstimate always accounts for
    // every LostSaleRecord that exists -- never silently understating the
    // true total by pretending every record was priced. includeDemo:true
    // sums over ALL records regardless of isDemo, so compare against the
    // unfiltered total.
    const totalRecordsIncludingDemo = await prisma.lostSaleRecord.count();
    expect(after.recordsWithEstimate + after.recordsWithoutEstimate).toBe(totalRecordsIncludingDemo);
  });
});
