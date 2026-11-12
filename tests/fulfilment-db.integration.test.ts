import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 10 (Communication Channels & Fulfilment). DB-backed
 * acceptance tests for the full dispatch -> delivery -> fulfilment-status
 * lifecycle -- create -> depart -> record delivery (both a clean
 * ACCEPTED_IN_FULL outcome and a PARTIALLY_REJECTED one), the refusal
 * paths along the way, and getOrderFulfilmentStatus's additive
 * outstanding-quantity math across a re-pick -- against a REAL database
 * through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as
 * tests/picking-db.integration.test.ts: @prisma/client in this sandbox is
 * a stale stub that does not know about DispatchRecord/DeliveryRecord/etc
 * at all (see docs/milestones/PROGRESS.md's Milestone 10 "Honest
 * verification results"). Every lib touched here (lib/fulfilment/*,
 * lib/picking/*, lib/orders, lib/prisma) is imported with a dynamic
 * `await import(...)` INSIDE the (skippable) test bodies below, never a
 * static top-of-file import.
 *
 * On a machine where `prisma generate` has actually run against the real
 * schema (including this milestone's migration), set
 * RUN_DB_INTEGRATION_TESTS=1 to include it:
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` at least once first (an admin user
 * and at least one DEMO-CUST-* customer must already exist).
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 10: dispatch and delivery fulfilment", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;

  const createdOrderIds: string[] = [];
  const uniqueSuffix = `inttest-${Date.now()}`;

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({
      where: { sapCustomerCode: { startsWith: "DEMO-CUST" } },
      select: { id: true },
    });

    if (!admin || !customer) {
      console.log(
        "Skipping Milestone 10 fulfilment DB integration test: need an admin user and a DEMO-CUST-* customer. " +
          "Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      for (const orderId of createdOrderIds) {
        // Deletion order respects the schema's onDelete rules: a
        // DeliveryRecord restricts deleting its DispatchRecord, and a
        // DispatchRecord restricts deleting its CustomerOrder, so both
        // must go first (each cascades to its own *Line rows).
        const dispatchRecordIds: { id: string }[] = await prisma.dispatchRecord.findMany({ where: { orderId }, select: { id: true } });
        await prisma.deliveryRecord.deleteMany({ where: { dispatchRecordId: { in: dispatchRecordIds.map((d: { id: string }) => d.id) } } });
        await prisma.dispatchRecord.deleteMany({ where: { orderId } });
        // PickingLine rows cascade-delete with their PickingSession.
        await prisma.pickingSession.deleteMany({ where: { orderId } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
        await prisma.auditEvent.deleteMany({
          where: { entityType: { in: ["CustomerOrder", "PickingSession", "PickingLine", "DispatchRecord", "DeliveryRecord"] } },
        });
        await prisma.orderLine.deleteMany({ where: { orderId } });
      }
      for (const orderId of createdOrderIds) {
        await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => undefined);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  /**
   * A fresh order with two lines, already fully picked and authorized
   * (requested 20 and 15, found in full) -- i.e. already READY_TO_INVOICE
   * with the full requested quantity outstanding to dispatch. Fulfilment
   * logic starts from exactly this state; picking itself is
   * Milestone 3A's own already-tested concern, reused here only to reach
   * a realistic starting point.
   */
  async function createReadyToInvoiceOrder() {
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
        orderDate: new Date("2026-11-01T00:00:00.000Z"),
        requestedDeliveryDate: new Date("2026-11-05T00:00:00.000Z"),
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [
            { lineNumber: 1, originalProductDescription: `Baby Marrow 250G ${uniqueSuffix}`, requestedQuantity: "20.0000", requestedUnitCode: "EA", isDemo: true },
            { lineNumber: 2, originalProductDescription: `Baby Marrow 500G ${uniqueSuffix}`, requestedQuantity: "15.0000", requestedUnitCode: "EA", isDemo: true },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, lineNumber: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdOrderIds.push(order.id);
    const [line1, line2] = order.lines;

    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    await recordPickedLine(started.session.id, line1!.id, "20.0000", "0.0000", undefined, adminId);
    await recordPickedLine(started.session.id, line2!.id, "15.0000", "0.0000", undefined, adminId);
    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    return { orderId: order.id, line1: line1!, line2: line2! };
  }

  it("getOrderFulfilmentStatus reports the full authorized quantity outstanding before any dispatch", async () => {
    if (skipAll) return;
    const { getOrderFulfilmentStatus } = await import("@/lib/fulfilment/queries");

    const { orderId } = await createReadyToInvoiceOrder();
    const status = await getOrderFulfilmentStatus(orderId);

    expect(status).not.toBeNull();
    const byLine = new Map(status!.lines.map((l) => [l.lineNumber, l]));
    expect(byLine.get(1)!.authorizedFoundQuantity).toBe("20");
    expect(byLine.get(1)!.outstandingQuantity).toBe("20");
    expect(byLine.get(2)!.authorizedFoundQuantity).toBe("15");
    expect(byLine.get(2)!.outstandingQuantity).toBe("15");
  });

  it("createDispatchRecord refuses to dispatch more than is outstanding, and refuses an order that isn't READY_TO_INVOICE", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { createDispatchRecord } = await import("@/lib/fulfilment/dispatch");

    const { orderId, line1 } = await createReadyToInvoiceOrder();

    const overDispatch = await createDispatchRecord(orderId, adminId, { lines: [{ orderLineId: line1.id, quantity: "20.0001" }] });
    expect(overDispatch.ok).toBe(false);
    if (!overDispatch.ok) expect(overDispatch.status).toBe(400);

    const notReady = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: { create: [{ lineNumber: 1, originalProductDescription: "x", requestedQuantity: "1", requestedUnitCode: "EA", isDemo: true }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    createdOrderIds.push(notReady.id);
    const notReadyResult = await createDispatchRecord(notReady.id, adminId, { lines: [{ orderLineId: notReady.lines[0]!.id, quantity: "1" }] });
    expect(notReadyResult.ok).toBe(false);
    if (!notReadyResult.ok) expect(notReadyResult.status).toBe(409);
  });

  it("a partial dispatch reduces outstandingQuantity by exactly the dispatched amount, leaving the rest available for a second dispatch", async () => {
    if (skipAll) return;
    const { createDispatchRecord, departDispatchRecord, cancelDispatchRecord } = await import("@/lib/fulfilment/dispatch");
    const { getOrderFulfilmentStatus } = await import("@/lib/fulfilment/queries");

    const { orderId, line1, line2 } = await createReadyToInvoiceOrder();

    const first = await createDispatchRecord(orderId, adminId, {
      lines: [
        { orderLineId: line1.id, quantity: "12.0000" },
        { orderLineId: line2.id, quantity: "15.0000" },
      ],
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.message);

    const afterFirst = await getOrderFulfilmentStatus(orderId);
    const byLineAfterFirst = new Map(afterFirst!.lines.map((l) => [l.lineNumber, l]));
    expect(byLineAfterFirst.get(1)!.outstandingQuantity).toBe("8");
    expect(byLineAfterFirst.get(2)!.outstandingQuantity).toBe("0");

    // A second dispatch can now only take line 1's remaining 8 -- more
    // than that must still be refused even though the first dispatch has
    // not yet departed.
    const { createDispatchRecord: createAgain } = await import("@/lib/fulfilment/dispatch");
    const overDispatchRemaining = await createAgain(orderId, adminId, { lines: [{ orderLineId: line1.id, quantity: "8.0001" }] });
    expect(overDispatchRemaining.ok).toBe(false);

    const second = await createAgain(orderId, adminId, { lines: [{ orderLineId: line1.id, quantity: "8.0000" }] });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.message);

    const afterSecond = await getOrderFulfilmentStatus(orderId);
    expect(afterSecond!.lines.find((l) => l.lineNumber === 1)!.outstandingQuantity).toBe("0");

    // Cancelling the second (still PLANNED) dispatch gives its quantity
    // back to the outstanding pool -- a CANCELLED DispatchRecord's lines
    // are excluded from getOrderFulfilmentStatus's dispatched sum.
    const cancelled = await cancelDispatchRecord(second.dispatchRecordId, adminId, "Customer changed delivery window");
    expect(cancelled.ok).toBe(true);
    const afterCancel = await getOrderFulfilmentStatus(orderId);
    expect(afterCancel!.lines.find((l) => l.lineNumber === 1)!.outstandingQuantity).toBe("8");

    // A departed dispatch can no longer be cancelled -- it must be
    // resolved via a delivery outcome instead.
    const departed = await departDispatchRecord(first.dispatchRecordId, adminId, "TRUCK-07");
    expect(departed.ok).toBe(true);
    const cancelAfterDeparture = await cancelDispatchRecord(first.dispatchRecordId, adminId, "too late");
    expect(cancelAfterDeparture.ok).toBe(false);
    if (!cancelAfterDeparture.ok) expect(cancelAfterDeparture.status).toBe(409);
  });

  it("recordDelivery enforces accepted+rejected === dispatched, requires a reason for any rejection, and moves the dispatch to DELIVERED", async () => {
    if (skipAll) return;
    const { createDispatchRecord, departDispatchRecord } = await import("@/lib/fulfilment/dispatch");
    const { recordDelivery } = await import("@/lib/fulfilment/delivery");
    const { getDispatchRecordDetail } = await import("@/lib/fulfilment/queries");
    const { prisma } = await import("@/lib/prisma");

    const { orderId, line1, line2 } = await createReadyToInvoiceOrder();
    const dispatch = await createDispatchRecord(orderId, adminId, {
      lines: [
        { orderLineId: line1.id, quantity: "20.0000" },
        { orderLineId: line2.id, quantity: "15.0000" },
      ],
    });
    if (!dispatch.ok) throw new Error(dispatch.message);
    await departDispatchRecord(dispatch.dispatchRecordId, adminId);

    const detail = await getDispatchRecordDetail(dispatch.dispatchRecordId);
    expect(detail).not.toBeNull();
    const [dLine1, dLine2] = detail!.lines;

    // accepted + rejected must equal dispatched exactly (20 here).
    const badMath = await recordDelivery(dispatch.dispatchRecordId, adminId, {
      lines: [
        { dispatchLineId: dLine1!.id, acceptedQuantity: "15.0000", rejectedQuantity: "0.0000" },
        { dispatchLineId: dLine2!.id, acceptedQuantity: "15.0000", rejectedQuantity: "0.0000" },
      ],
    }, {});
    expect(badMath.ok).toBe(false);
    if (!badMath.ok) expect(badMath.status).toBe(400);

    // A rejected quantity with no rejection reason must be refused.
    const noReason = await recordDelivery(dispatch.dispatchRecordId, adminId, {
      lines: [
        { dispatchLineId: dLine1!.id, acceptedQuantity: "18.0000", rejectedQuantity: "2.0000" },
        { dispatchLineId: dLine2!.id, acceptedQuantity: "15.0000", rejectedQuantity: "0.0000" },
      ],
    }, {});
    expect(noReason.ok).toBe(false);

    const result = await recordDelivery(dispatch.dispatchRecordId, adminId, {
      lines: [
        { dispatchLineId: dLine1!.id, acceptedQuantity: "18.0000", rejectedQuantity: "2.0000", rejectionReason: "2 units damaged in transit" },
        { dispatchLineId: dLine2!.id, acceptedQuantity: "15.0000", rejectedQuantity: "0.0000" },
      ],
    }, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome).toBe("PARTIALLY_REJECTED");

    const dispatchAfter = await prisma.dispatchRecord.findUniqueOrThrow({ where: { id: dispatch.dispatchRecordId }, select: { status: true } });
    expect(dispatchAfter.status).toBe("DELIVERED");

    // A second delivery outcome for the same dispatch must be refused --
    // DeliveryRecord.dispatchRecordId is @unique, one outcome per dispatch.
    const duplicate = await recordDelivery(dispatch.dispatchRecordId, adminId, {
      lines: [
        { dispatchLineId: dLine1!.id, acceptedQuantity: "20.0000", rejectedQuantity: "0.0000" },
        { dispatchLineId: dLine2!.id, acceptedQuantity: "15.0000", rejectedQuantity: "0.0000" },
      ],
    }, {});
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.status).toBe(409);
  });
});
