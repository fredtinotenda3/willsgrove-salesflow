import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 4 (Lost-Sales Management). DB-backed acceptance tests for
 * the full lost-sales lifecycle -- automatic UnfulfilledDemand creation
 * on authorization, customer-decision recording (every bucket),
 * substitute acceptance, outstanding-to-lost conversion, duplicate/
 * over-allocation prevention, original-PO immutability, audit history,
 * and reporting -- against a REAL database through a REAL generated
 * @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as
 * tests/picking-db.integration.test.ts and
 * tests/handover-db.integration.test.ts: @prisma/client in this sandbox
 * is a stub that THROWS when merely constructed (see
 * docs/milestones/PROGRESS.md's "Sandbox-only blocker"). Every lib
 * touched here is imported with a dynamic `await import(...)` INSIDE the
 * (skippable) test bodies below, never a static top-of-file import.
 * This file ALSO cannot run until `npx prisma generate` has actually
 * been run against the schema this milestone adds (UnfulfilledDemand/
 * CustomerDecisionEvent/LostSaleRecord) -- see this round's honesty note
 * in docs/milestones/PROGRESS.md about why that could not be verified
 * from inside this sandbox.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user, a
 * DEMO-CUST-* customer, and at least two real, active, imported SAP
 * products must already exist).
 *
 * Note on role gating (spec test scenario 17): exactly like
 * authorizePickingSession, confirmLostSale() itself is role-agnostic by
 * design -- SALES_MANAGER/ADMINISTRATOR-only enforcement lives entirely
 * in app/api/lost-sales/[id]/confirm-lost/route.ts's
 * requireUserOrResponse(["SALES_MANAGER","ADMINISTRATOR"]) call. This
 * test calls the lib function directly, so it intentionally does not
 * (and cannot, from here) exercise that 403 -- the same pre-existing,
 * documented, accepted scope boundary as every other role-gated action
 * in this project (no route handler anywhere in this codebase has its
 * own dedicated unit test).
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 4: lost-sales management", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let productAId: string;
  let productASapCode: string;
  let productBId: string;

  const createdOrderIds: string[] = [];
  const uniqueSuffix = `inttest-${Date.now()}`;

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
      take: 2,
      select: { id: true, sapItemCode: true },
    });

    if (!admin || !customer || products.length < 2) {
      console.log(
        "Skipping Milestone 4 lost-sales DB integration test: need an admin user, a DEMO-CUST-* customer, " +
          "and at least two active products. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;
    productAId = products[0]!.id;
    productASapCode = products[0]!.sapItemCode;
    productBId = products[1]!.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      // Deletion order respects every onDelete: Restrict FK this
      // milestone added -- LostSaleRecord/CustomerDecisionEvent before
      // UnfulfilledDemand, UnfulfilledDemand before PickingSession.
      await prisma.lostSaleRecord.deleteMany({ where: { unfulfilledDemand: { orderId: { in: createdOrderIds } } } });
      await prisma.customerDecisionEvent.deleteMany({
        where: { unfulfilledDemand: { orderId: { in: createdOrderIds } } },
      });
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

  it("scenarios 1/2/3/20: authorization creates exactly one UnfulfilledDemand per unavailable line, none for the fully-available line", async () => {
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
    // Scenario 4: never automatically classified as lost.
    expect(line2Demand.status).toBe("PENDING_DECISION");
    expect(line2Demand.confirmedLostQuantity.toString()).toBe("0.0000");

    const line3Demand = demands.find((d) => d.orderLineId === line3Id)!;
    expect(line3Demand.unavailableQuantity.toString()).toBe("10.0000");
    expect(line3Demand.productId).toBeNull();
    expect(line3Demand.productDescriptionSnapshot).toBe(`Customer wording for line 3 ${uniqueSuffix}`);
    expect(line3Demand.status).toBe("PENDING_DECISION");

    // Scenario 16: audit history preserved for the creation itself.
    const auditEvents = await prisma.auditEvent.findMany({
      where: { action: "UNFULFILLED_DEMAND_CREATED", entityId: { in: [line2Demand.id, line3Demand.id] } },
    });
    expect(auditEvents).toHaveLength(2);
  });

  it("scenario 15: recording decisions and confirming a lost sale never touches the original Customer PO", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { recordCustomerDecision } = await import("@/lib/lost-sales/record-decision");
    const { confirmLostSale } = await import("@/lib/lost-sales/confirm-lost-sale");

    const { orderId, line2Id } = await createThreeLineOrderAndAuthorize();
    const before = await prisma.orderLine.findUniqueOrThrow({ where: { id: line2Id } });

    const demand = await prisma.unfulfilledDemand.findFirstOrThrow({ where: { orderLineId: line2Id } });

    await recordCustomerDecision(
      { unfulfilledDemandId: demand.id, decisionType: "PARTIAL_CANCELLATION", source: "CUSTOMER_EMAIL", quantity: "8.0000" },
      adminId
    );
    await confirmLostSale(
      { unfulfilledDemandId: demand.id, quantity: "8.0000", reason: "PRODUCT_UNAVAILABLE", decisionSource: "CUSTOMER_EMAIL" },
      adminId
    );

    const after = await prisma.orderLine.findUniqueOrThrow({ where: { id: line2Id } });
    expect(after.requestedQuantity.toString()).toBe(before.requestedQuantity.toString());
    expect(after.originalProductDescription).toBe(before.originalProductDescription);
    expect(after.sapItemCodeSnapshot).toBe(before.sapItemCodeSnapshot);
    expect(after.approvedUnitPrice?.toString()).toBe(before.approvedUnitPrice?.toString());

    const order = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("READY_TO_INVOICE");
  });

  it("scenarios 5/9/13/14: accept-and-cancel-remainder consumes the whole remainder; a further decision is refused", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { recordCustomerDecision } = await import("@/lib/lost-sales/record-decision");

    const { line3Id } = await createThreeLineOrderAndAuthorize();
    const demand = await prisma.unfulfilledDemand.findFirstOrThrow({ where: { orderLineId: line3Id } });
    expect(demand.unavailableQuantity.toString()).toBe("10.0000");

    const result = await recordCustomerDecision(
      { unfulfilledDemandId: demand.id, decisionType: "ACCEPT_PARTIAL_CANCEL_REMAINDER", source: "CUSTOMER_PHONE_CALL" },
      adminId
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.event.quantity).toBe("10.0000");
      expect(result.demand.status).toBe("FULLY_CANCELLED");
    }

    // Scenario 14: a further decision now has nothing left to consume.
    const overAllocated = await recordCustomerDecision(
      { unfulfilledDemandId: demand.id, decisionType: "PARTIAL_CANCELLATION", source: "CUSTOMER_EMAIL", quantity: "1.0000" },
      adminId
    );
    expect(overAllocated.ok).toBe(false);
    if (!overAllocated.ok) expect(overAllocated.status).toBe(400);
  });

  it("scenarios 6/9/10/11: a mix of waiting, partial cancellation, and a substitute on the same line", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { recordCustomerDecision } = await import("@/lib/lost-sales/record-decision");

    const { line2Id } = await createThreeLineOrderAndAuthorize();
    const demand = await prisma.unfulfilledDemand.findFirstOrThrow({ where: { orderLineId: line2Id } });
    expect(demand.unavailableQuantity.toString()).toBe("8.0000");

    // 3 of 8: wait for remaining quantity -> outstanding.
    const wait = await recordCustomerDecision(
      {
        unfulfilledDemandId: demand.id,
        decisionType: "AWAIT_REMAINING_QUANTITY",
        source: "CUSTOMER_PHONE_CALL",
        quantity: "3.0000",
        expectedFollowUpDate: "2026-12-01",
      },
      adminId
    );
    expect(wait.ok).toBe(true);
    if (wait.ok) expect(wait.demand.status).toBe("PENDING_DECISION"); // 5 still undecided

    // 2 of the remaining 5: partial cancellation.
    const partial = await recordCustomerDecision(
      { unfulfilledDemandId: demand.id, decisionType: "PARTIAL_CANCELLATION", source: "CUSTOMER_EMAIL", quantity: "2.0000" },
      adminId
    );
    expect(partial.ok).toBe(true);
    if (partial.ok) expect(partial.demand.status).toBe("PENDING_DECISION"); // 3 still undecided

    // The remaining 3: substitute accepted.
    const substitute = await recordCustomerDecision(
      {
        unfulfilledDemandId: demand.id,
        decisionType: "SUBSTITUTE_ACCEPTED",
        source: "CUSTOMER_IN_PERSON",
        quantity: "3.0000",
        substituteProductId: productBId,
      },
      adminId
    );
    expect(substitute.ok).toBe(true);
    // Fully decided now (0 undecided), but outstanding (3) > 0 takes priority.
    if (substitute.ok) expect(substitute.demand.status).toBe("AWAITING_SUPPLY");

    const finalDemand = await prisma.unfulfilledDemand.findUniqueOrThrow({ where: { id: demand.id } });
    expect(finalDemand.outstandingQuantity.toString()).toBe("3.0000");
    expect(finalDemand.cancelledQuantity.toString()).toBe("2.0000");
    expect(finalDemand.substitutedQuantity.toString()).toBe("3.0000");
    expect(finalDemand.expectedFollowUpDate).not.toBeNull();

    const events = await prisma.customerDecisionEvent.findMany({ where: { unfulfilledDemandId: demand.id } });
    const substituteEvent = events.find((e) => e.decisionType === "SUBSTITUTE_ACCEPTED")!;
    expect(substituteEvent.substituteProductId).toBe(productBId);
    expect(substituteEvent.substituteSapItemCodeSnapshot).not.toBeNull();
  });

  it("refuses a SUBSTITUTE_ACCEPTED decision against a non-existent product", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { recordCustomerDecision } = await import("@/lib/lost-sales/record-decision");

    const { line3Id } = await createThreeLineOrderAndAuthorize();
    const demand = await prisma.unfulfilledDemand.findFirstOrThrow({ where: { orderLineId: line3Id } });

    const result = await recordCustomerDecision(
      {
        unfulfilledDemandId: demand.id,
        decisionType: "SUBSTITUTE_ACCEPTED",
        source: "CUSTOMER_EMAIL",
        quantity: "1.0000",
        substituteProductId: "does-not-exist",
      },
      adminId
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("scenario 12: converts a shortfall from outstanding into cancelled when confirming a lost sale", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { recordCustomerDecision } = await import("@/lib/lost-sales/record-decision");
    const { confirmLostSale } = await import("@/lib/lost-sales/confirm-lost-sale");

    const { line3Id } = await createThreeLineOrderAndAuthorize();
    const demand = await prisma.unfulfilledDemand.findFirstOrThrow({ where: { orderLineId: line3Id } });
    expect(demand.unavailableQuantity.toString()).toBe("10.0000");

    // 3 cancelled, 7 outstanding -- fully decided.
    await recordCustomerDecision(
      { unfulfilledDemandId: demand.id, decisionType: "PARTIAL_CANCELLATION", source: "CUSTOMER_EMAIL", quantity: "3.0000" },
      adminId
    );
    await recordCustomerDecision(
      { unfulfilledDemandId: demand.id, decisionType: "AWAIT_REMAINING_QUANTITY", source: "CUSTOMER_EMAIL", quantity: "7.0000" },
      adminId
    );

    // Confirm 5 as lost: 3 from cancelled, 2 drawn from outstanding.
    const confirmed = await confirmLostSale(
      { unfulfilledDemandId: demand.id, quantity: "5.0000", reason: "CUSTOMER_SOURCED_ELSEWHERE", decisionSource: "CUSTOMER_EMAIL" },
      adminId
    );
    expect(confirmed.ok).toBe(true);

    const after = await prisma.unfulfilledDemand.findUniqueOrThrow({ where: { id: demand.id } });
    expect(after.cancelledQuantity.toString()).toBe("5.0000");
    expect(after.confirmedLostQuantity.toString()).toBe("5.0000");
    expect(after.outstandingQuantity.toString()).toBe("5.0000");
    expect(after.status).toBe("AWAITING_SUPPLY"); // 5 still outstanding

    // Refuses a lost-sale quantity exceeding what's available from both sources.
    const refused = await confirmLostSale(
      { unfulfilledDemandId: demand.id, quantity: "20.0000", reason: "OTHER", reasonDetail: "test", decisionSource: "CUSTOMER_EMAIL" },
      adminId
    );
    expect(refused.ok).toBe(false);

    // OTHER with no detail is refused before the quantity check even runs.
    const missingDetail = await confirmLostSale(
      { unfulfilledDemandId: demand.id, quantity: "1.0000", reason: "OTHER", decisionSource: "CUSTOMER_EMAIL" },
      adminId
    );
    expect(missingDetail.ok).toBe(false);

    // Scenario 16: audit history preserved for the decision + confirmation.
    const auditActions = await prisma.auditEvent.findMany({
      where: { entityId: demand.id, action: { in: ["CUSTOMER_DECISION_RECORDED", "LOST_SALE_CONFIRMED"] } },
    });
    expect(auditActions.length).toBeGreaterThanOrEqual(3); // 2 decisions + 1 confirmation
  });

  it("estimates a lost sale's value from the order line's own approved price, never invents one", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { recordCustomerDecision } = await import("@/lib/lost-sales/record-decision");
    const { confirmLostSale } = await import("@/lib/lost-sales/confirm-lost-sale");

    // line2 was created with approvedUnitPrice "15.5000".
    const { line2Id } = await createThreeLineOrderAndAuthorize();
    const demand = await prisma.unfulfilledDemand.findFirstOrThrow({ where: { orderLineId: line2Id } });

    await recordCustomerDecision(
      { unfulfilledDemandId: demand.id, decisionType: "ACCEPT_PARTIAL_CANCEL_REMAINDER", source: "CUSTOMER_EMAIL" },
      adminId
    );
    const confirmed = await confirmLostSale(
      { unfulfilledDemandId: demand.id, quantity: "8.0000", reason: "PRODUCT_UNAVAILABLE", decisionSource: "CUSTOMER_EMAIL" },
      adminId
    );
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) {
      expect(confirmed.record.estimatedUnitPrice).toBe("15.5000");
      expect(confirmed.record.estimatedValue).toBe("124.0000"); // 15.5 * 8
      expect(confirmed.record.estimatedValueSource).toBe("ORDER_LINE_APPROVED_PRICE");
    }
  });

  it("scenario 18: reporting figures reflect what was actually recorded, with distinct unavailable/outstanding/lost totals", async () => {
    if (skipAll) return;
    const { listUnfulfilledDemands, getLostSalesReportSummary } = await import("@/lib/lost-sales/queries");
    const { recordCustomerDecision } = await import("@/lib/lost-sales/record-decision");
    const { confirmLostSale } = await import("@/lib/lost-sales/confirm-lost-sale");

    await createThreeLineOrderAndAuthorize();
    const { demands } = await listUnfulfilledDemands({ page: 1, pageSize: 50, customerId, includeDemo: true });
    expect(demands.length).toBeGreaterThanOrEqual(2);

    const line2Demand = demands.find((d) => d.unavailableQuantity === "8.0000")!;
    await recordCustomerDecision(
      { unfulfilledDemandId: line2Demand.id, decisionType: "PARTIAL_CANCELLATION", source: "CUSTOMER_EMAIL", quantity: "8.0000" },
      adminId
    );
    await confirmLostSale(
      { unfulfilledDemandId: line2Demand.id, quantity: "8.0000", reason: "PRODUCT_UNAVAILABLE", decisionSource: "CUSTOMER_EMAIL" },
      adminId
    );

    const summary = await getLostSalesReportSummary({ includeDemo: true });
    expect(Number(summary.totalConfirmedLostQuantity)).toBeGreaterThanOrEqual(8);
    expect(Number(summary.totalUnavailableQuantity)).toBeGreaterThanOrEqual(18); // at least this test's 8 + 10
    const productEntry = summary.topConfirmedLostProducts.find((p) => p.sapItemCodeSnapshot === productASapCode);
    expect(productEntry).toBeDefined();
    if (productEntry) expect(Number(productEntry.totalQuantity)).toBeGreaterThanOrEqual(8);
    const reasonEntry = summary.lossReasonBreakdown.find((r) => r.reason === "PRODUCT_UNAVAILABLE");
    expect(reasonEntry).toBeDefined();
  });
});
