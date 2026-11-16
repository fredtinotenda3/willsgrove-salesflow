import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 * DB-backed acceptance tests for the full picking lifecycle --
 * start -> record -> complete -> authorize, every refusal path along the
 * way, and the re-pick-after-authorization case -- against a REAL
 * database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as
 * tests/handover-db.integration.test.ts: @prisma/client in this sandbox
 * is a stub that THROWS when merely constructed (see
 * docs/milestones/PROGRESS.md's "Sandbox-only blocker"). Every lib
 * touched here (lib/picking/*, lib/orders, lib/prisma) is imported with a
 * dynamic `await import(...)` INSIDE the (skippable) test bodies below,
 * never a static top-of-file import.
 *
 * On your machine, where `prisma generate` has actually run against the
 * real schema (including this milestone's migration), set
 * RUN_DB_INTEGRATION_TESTS=1 to include it:
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` at least once first (an admin user
 * and at least one DEMO-CUST-* customer must already exist).
 *
 * Note on role gating: authorizePickingSession() itself is role-agnostic
 * by design -- SALES_MANAGER/ADMINISTRATOR-only enforcement lives in
 * app/api/orders/[id]/picking/[sessionId]/authorize/route.ts's
 * requireUserOrResponse(["SALES_MANAGER","ADMINISTRATOR"]) call, not in
 * the lib function (the same lib/-vs-route split every other role-gated
 * action in this project already follows -- see e.g.
 * app/api/users/route.ts). This test calls the lib function directly, so
 * it intentionally does not (and cannot, from here) exercise that 403.
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 3A: warehouse picking", () => {
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
        "Skipping Milestone 3A picking DB integration test: need an admin user and a DEMO-CUST-* customer. " +
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
        // PickingLine rows cascade-delete with their PickingSession.
        await prisma.pickingSession.deleteMany({ where: { orderId } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
        await prisma.auditEvent.deleteMany({ where: { entityType: { in: ["CustomerOrder", "PickingSession", "PickingLine"] } } });
        await prisma.orderLine.deleteMany({ where: { orderId } });
      }
      for (const orderId of createdOrderIds) {
        await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => undefined);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  /** A fresh RECEIVED order with two lines, quantities 20 and 15 -- enough to exercise the spec's worked example (20/20/0 and 15/10/5). */
  async function createTwoLineOrder() {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");

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
            {
              lineNumber: 1,
              originalProductDescription: `Baby Marrow 250G ${uniqueSuffix}`,
              requestedQuantity: "20.0000",
              requestedUnitCode: "EA",
              isDemo: true,
            },
            {
              lineNumber: 2,
              originalProductDescription: `Baby Marrow 500G ${uniqueSuffix}`,
              requestedQuantity: "15.0000",
              requestedUnitCode: "EA",
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true, lineNumber: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdOrderIds.push(order.id);
    return order;
  }

  it("startPickingSession snapshots requestedQuantity per line and moves the order to PICKING", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { startPickingSession } = await import("@/lib/picking/start-picking");

    const order = await createTwoLineOrder();
    const result = await startPickingSession(order.id, adminId);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.session.lines).toHaveLength(2);
    expect(result.session.lines.map((l) => l.requestedQuantity).sort()).toEqual(["15.0000", "20.0000"].sort());

    const orderAfter = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    expect(orderAfter.status).toBe("PICKING");
  });

  it("refuses to start a second session while one is already in progress", async () => {
    if (skipAll) return;
    const { startPickingSession } = await import("@/lib/picking/start-picking");

    const order = await createTwoLineOrder();
    const first = await startPickingSession(order.id, adminId);
    expect(first.ok).toBe(true);

    const second = await startPickingSession(order.id, adminId);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
  });

  it("refuses to start picking for a cancelled order or an order with no lines", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");

    const cancelled = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "CANCELLED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: { create: [{ lineNumber: 1, originalProductDescription: "x", requestedQuantity: "1", requestedUnitCode: "EA", isDemo: true }] },
      },
      select: { id: true },
    });
    createdOrderIds.push(cancelled.id);
    const cancelledResult = await startPickingSession(cancelled.id, adminId);
    expect(cancelledResult.ok).toBe(false);
    if (!cancelledResult.ok) expect(cancelledResult.status).toBe(409);

    const empty = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
      },
      select: { id: true },
    });
    createdOrderIds.push(empty.id);
    const emptyResult = await startPickingSession(empty.id, adminId);
    expect(emptyResult.ok).toBe(false);
    if (!emptyResult.ok) expect(emptyResult.status).toBe(400);
  });

  it("recordPickedLine rejects overcounting and accepts a valid entry; completePickingSession enforces full accounting", async () => {
    if (skipAll) return;
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");

    const order = await createTwoLineOrder();
    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    const [line1, line2] = order.lines;

    // Line 1: requested 20 -- overcounting (21 > 20) must be rejected.
    const overcount = await recordPickedLine(started.session.id, line1!.id, "21.0000", "0.0000", undefined, adminId);
    expect(overcount.ok).toBe(false);
    if (!overcount.ok) expect(overcount.status).toBe(400);

    // Completing now must fail -- neither line has been fully accounted for yet.
    const tooEarly = await completePickingSession(started.session.id, adminId);
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.status).toBe(400);

    // Spec's worked example: 20 requested / 20 found / 0 unavailable.
    const recordedLine1 = await recordPickedLine(started.session.id, line1!.id, "20.0000", "0.0000", undefined, adminId);
    expect(recordedLine1.ok).toBe(true);

    // Still incomplete -- line 2 not yet recorded.
    const stillIncomplete = await completePickingSession(started.session.id, adminId);
    expect(stillIncomplete.ok).toBe(false);

    // Spec's worked example: 15 requested / 10 found / 5 unavailable.
    const recordedLine2 = await recordPickedLine(started.session.id, line2!.id, "10.0000", "5.0000", "5 damaged in transit", adminId);
    expect(recordedLine2.ok).toBe(true);
    if (recordedLine2.ok) expect(recordedLine2.line.notes).toBe("5 damaged in transit");

    const completed = await completePickingSession(started.session.id, adminId);
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.session.status).toBe("COMPLETED");

    // Lines are locked once completed.
    const editAfterComplete = await recordPickedLine(started.session.id, line1!.id, "20.0000", "0.0000", undefined, adminId);
    expect(editAfterComplete.ok).toBe(false);
    if (!editAfterComplete.ok) expect(editAfterComplete.status).toBe(409);
  });

  /**
   * Final Operational Enhancements (spec Part 2.1). completePickingSession
   * now accepts an optional `lineEdits` batch so the caller can save
   * every not-yet-individually-saved line AND complete the session in one
   * atomic call ("save ALL entered records together, not just already-
   * individually-saved ones"). Every check is identical to the existing
   * per-line save path (exceedsRequested/fullyAccountsFor) -- this suite
   * exercises that the batch path enforces the exact same rules, is
   * genuinely all-or-nothing, can mix with already-individually-saved
   * lines, and leaves an identical audit trail.
   */
  it("completePickingSession's lineEdits batch saves every line and completes atomically, with no pre-existing per-line saves at all", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");

    const order = await createTwoLineOrder();
    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    const [line1, line2] = order.lines;

    const completed = await completePickingSession(started.session.id, adminId, [
      { orderLineId: line1!.id, foundQuantity: "20.0000", unavailableQuantity: "0.0000" },
      { orderLineId: line2!.id, foundQuantity: "10.0000", unavailableQuantity: "5.0000", notes: "5 damaged in transit" },
    ]);
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.session.status).toBe("COMPLETED");

    const persistedLines = await prisma.pickingLine.findMany({
      where: { pickingSessionId: started.session.id },
      select: { orderLineId: true, foundQuantity: true, unavailableQuantity: true, notes: true, pickedById: true },
    });
    const byOrderLineId = new Map(persistedLines.map((l) => [l.orderLineId, l]));
    expect(byOrderLineId.get(line1!.id)!.foundQuantity!.toString()).toBe("20.0000");
    expect(byOrderLineId.get(line2!.id)!.foundQuantity!.toString()).toBe("10.0000");
    expect(byOrderLineId.get(line2!.id)!.unavailableQuantity!.toString()).toBe("5.0000");
    expect(byOrderLineId.get(line2!.id)!.notes).toBe("5 damaged in transit");
    expect(byOrderLineId.get(line1!.id)!.pickedById).toBe(adminId);

    // Each batched line save leaves the exact same shape of audit event a
    // record-picked-line.ts individual save would, just flagged with
    // viaCompletePicking: true (lib/picking/complete-picking.ts's own
    // comment on why) -- entityId is the PickingLine's own id, not the
    // session id, so look it up via the persisted lines fetched above.
    const persistedWithIds = await prisma.pickingLine.findMany({
      where: { pickingSessionId: started.session.id },
      select: { id: true, orderLineId: true },
    });
    const auditEvents = await prisma.auditEvent.findMany({
      where: { action: "PICKING_LINE_RECORDED", entityId: { in: persistedWithIds.map((l) => l.id) } },
    });
    expect(auditEvents).toHaveLength(2);
    expect(auditEvents.every((e) => (e.afterData as { viaCompletePicking?: boolean } | null)?.viaCompletePicking === true)).toBe(true);
  });

  it("completePickingSession's lineEdits batch is all-or-nothing: one invalid edit means NOTHING is written, not even a valid sibling edit", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");

    const order = await createTwoLineOrder();
    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    const [line1, line2] = order.lines; // requested 20 and 15

    // line1's edit is perfectly valid; line2's edit exceeds its requested
    // quantity (16 > 15) -- the whole batch must be refused, and line1's
    // otherwise-valid edit must NOT have been written either.
    const result = await completePickingSession(started.session.id, adminId, [
      { orderLineId: line1!.id, foundQuantity: "20.0000", unavailableQuantity: "0.0000" },
      { orderLineId: line2!.id, foundQuantity: "16.0000", unavailableQuantity: "0.0000" },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);

    const sessionAfter = await prisma.pickingSession.findUniqueOrThrow({ where: { id: started.session.id }, select: { status: true } });
    expect(sessionAfter.status).toBe("IN_PROGRESS"); // never completed

    const line1After = await prisma.pickingLine.findFirstOrThrow({ where: { pickingSessionId: started.session.id, orderLineId: line1!.id } });
    expect(line1After.foundQuantity).toBeNull(); // the valid sibling edit was NOT written
  });

  it("completePickingSession's lineEdits rejects an edit for an order line not in this session, and a duplicate orderLineId within one batch", async () => {
    if (skipAll) return;
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");

    const order = await createTwoLineOrder();
    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    const [line1] = order.lines;

    const foreignLine = await completePickingSession(started.session.id, adminId, [
      { orderLineId: "not-part-of-this-session", foundQuantity: "1.0000", unavailableQuantity: "0.0000" },
    ]);
    expect(foreignLine.ok).toBe(false);
    if (!foreignLine.ok) expect(foreignLine.status).toBe(400);

    const duplicateInBatch = await completePickingSession(started.session.id, adminId, [
      { orderLineId: line1!.id, foundQuantity: "20.0000", unavailableQuantity: "0.0000" },
      { orderLineId: line1!.id, foundQuantity: "19.0000", unavailableQuantity: "1.0000" },
    ]);
    expect(duplicateInBatch.ok).toBe(false);
    if (!duplicateInBatch.ok) expect(duplicateInBatch.status).toBe(400);
  });

  it("completePickingSession's lineEdits can mix with an already-individually-saved line -- the edit overrides a line in the batch, the persisted value is used for a line not in it", async () => {
    if (skipAll) return;
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { prisma } = await import("@/lib/prisma");

    const order = await createTwoLineOrder();
    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    const [line1, line2] = order.lines;

    // line2 is saved individually, the ordinary way, ahead of time.
    await recordPickedLine(started.session.id, line2!.id, "15.0000", "0.0000", undefined, adminId);

    // Only line1 is supplied via the batch; line2 is left to its already-
    // persisted value and must still be checked (and must still pass).
    const completed = await completePickingSession(started.session.id, adminId, [
      { orderLineId: line1!.id, foundQuantity: "20.0000", unavailableQuantity: "0.0000" },
    ]);
    expect(completed.ok).toBe(true);

    const persisted = await prisma.pickingLine.findMany({ where: { pickingSessionId: started.session.id }, select: { orderLineId: true, foundQuantity: true } });
    expect(persisted.find((l) => l.orderLineId === line1!.id)!.foundQuantity!.toString()).toBe("20.0000");
    expect(persisted.find((l) => l.orderLineId === line2!.id)!.foundQuantity!.toString()).toBe("15.0000");
  });

  it("authorizePickingSession refuses before completion, then moves the order to READY_TO_INVOICE once authorized", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

    const order = await createTwoLineOrder();
    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    const [line1, line2] = order.lines;

    const tooEarly = await authorizePickingSession(started.session.id, adminId);
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.status).toBe(409);

    await recordPickedLine(started.session.id, line1!.id, "20.0000", "0.0000", undefined, adminId);
    await recordPickedLine(started.session.id, line2!.id, "15.0000", "0.0000", undefined, adminId);
    const completed = await completePickingSession(started.session.id, adminId);
    expect(completed.ok).toBe(true);

    const authorized = await authorizePickingSession(started.session.id, adminId);
    expect(authorized.ok).toBe(true);
    if (authorized.ok) expect(authorized.session.status).toBe("AUTHORIZED");

    const orderAfter = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    expect(orderAfter.status).toBe("READY_TO_INVOICE");

    const historyEntries = await prisma.orderStatusHistory.findMany({
      where: { orderId: order.id },
      orderBy: { createdAt: "asc" },
      select: { fromStatus: true, toStatus: true },
    });
    expect(historyEntries.map((h) => h.toStatus)).toEqual(["PICKING", "READY_TO_INVOICE"]);
  });

  it("allows starting a brand-new session after the previous one was authorized, preserving its history", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

    const order = await createTwoLineOrder();
    const [line1, line2] = order.lines;

    const first = await startPickingSession(order.id, adminId);
    if (!first.ok) throw new Error(first.message);
    await recordPickedLine(first.session.id, line1!.id, "20.0000", "0.0000", undefined, adminId);
    await recordPickedLine(first.session.id, line2!.id, "15.0000", "0.0000", undefined, adminId);
    await completePickingSession(first.session.id, adminId);
    await authorizePickingSession(first.session.id, adminId);

    // A re-pick (correction) is allowed now that the first session is AUTHORIZED.
    const second = await startPickingSession(order.id, adminId);
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error(second.message);
    expect(second.session.id).not.toBe(first.session.id);

    const sessions = await prisma.pickingSession.findMany({ where: { orderId: order.id }, select: { id: true, status: true } });
    expect(sessions).toHaveLength(2);
    expect(sessions.find((s) => s.id === first.session.id)!.status).toBe("AUTHORIZED");
    expect(sessions.find((s) => s.id === second.session.id)!.status).toBe("IN_PROGRESS");
  });
});
