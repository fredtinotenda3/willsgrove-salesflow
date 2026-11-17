import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Management Analytics spec, Part 6 and Part 8: DB-backed tests for
 * lib/delivered-orders/queries.ts's listDeliveredOrders and
 * getDeliveredOrderDetail -- the dedicated, permanent "Delivered Orders"
 * history.
 *
 * OFF BY DEFAULT, same reason and invocation as every other
 * *-db.integration test in this project:
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-001 customer must exist).
 *
 * Builds a full order -> picking -> dispatch -> physical delivery ->
 * invoice -> invoice-delivery-outcome chain through the EXISTING
 * lib/picking/*, lib/fulfilment/* and lib/invoice-delivery/* functions
 * (never by hand-inserting rows those modules are responsible for), the
 * same convention tests/fulfilment-db.integration.test.ts already
 * established. Every row created here is marked isDemo: true and cleaned
 * up in afterAll, in FK-respecting (leaves-first) order.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Management Analytics spec Part 6: Delivered Orders history", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let driverId: string;
  let assistantId: string;
  let vehicleId: string;
  const uniqueSuffix = `deliveredorders-${Date.now()}`;

  const createdOrderIds: string[] = [];
  const createdPersonnelIds: string[] = [];
  const createdVehicleIds: string[] = [];
  const createdImportBatchIds: string[] = [];
  const createdSapInvoiceIds: string[] = [];
  const createdClaimIds: string[] = [];
  const createdDeliveryRecordIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping Delivered Orders DB integration test: need an admin user and the DEMO-CUST-001 customer. " +
          "Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;

    const driver = await prisma.personnel.create({ data: { name: `DO Test Driver ${uniqueSuffix}`, role: "DRIVER", createdById: adminId, isDemo: true }, select: { id: true } });
    createdPersonnelIds.push(driver.id);
    const assistant = await prisma.personnel.create({ data: { name: `DO Test Assistant ${uniqueSuffix}`, role: "DRIVER_ASSISTANT", createdById: adminId, isDemo: true }, select: { id: true } });
    createdPersonnelIds.push(assistant.id);
    const vehicle = await prisma.vehicle.create({ data: { registrationNumber: `DOTEST-${uniqueSuffix}`, createdById: adminId, isDemo: true }, select: { id: true } });
    createdVehicleIds.push(vehicle.id);

    driverId = driver.id;
    assistantId = assistant.id;
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.claimResolution.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaimAttachment.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaimLine.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaim.deleteMany({ where: { id: { in: createdClaimIds } } });
      await prisma.invoiceDeliveryRecord.deleteMany({ where: { id: { in: createdDeliveryRecordIds } } });
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoiceId: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoice.deleteMany({ where: { id: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { id: { in: createdImportBatchIds } } });

      for (const orderId of createdOrderIds) {
        const dispatchRecordIds: { id: string }[] = await prisma.dispatchRecord.findMany({ where: { orderId }, select: { id: true } });
        await prisma.deliveryRecord.deleteMany({ where: { dispatchRecordId: { in: dispatchRecordIds.map((d: { id: string }) => d.id) } } });
        await prisma.dispatchRecord.deleteMany({ where: { orderId } });
        await prisma.pickingSession.deleteMany({ where: { orderId } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
        await prisma.auditEvent.deleteMany({ where: { entityType: { in: ["CustomerOrder", "PickingSession", "PickingLine", "DispatchRecord", "DeliveryRecord"] }, entityId: orderId } });
        await prisma.orderLine.deleteMany({ where: { orderId } });
      }
      await prisma.auditEvent.deleteMany({ where: { entityType: "DispatchRecord" } });
      for (const orderId of createdOrderIds) {
        await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => undefined);
      }
      await prisma.personnel.deleteMany({ where: { id: { in: createdPersonnelIds } } });
      await prisma.vehicle.deleteMany({ where: { id: { in: createdVehicleIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /** One SAP invoice with N lines, optionally matched to an order/customer. */
  async function createSapInvoice(
    lines: { quantityInvoiced: string; unitPrice: string }[],
    options: { matchedOrderId?: string; currencyCode?: string } = {}
  ) {
    const { prisma } = await import("@/lib/prisma");

    const batch = await prisma.sapInvoiceImportBatch.create({
      data: {
        originalFileName: "delivered-orders-test.csv",
        uploadedById: adminId,
        columnMapping: {},
        totalRows: lines.length,
        importedInvoiceCount: 1,
        importedLineCount: lines.length,
        duplicateRowCount: 0,
        invalidRowCount: 0,
        isDemo: true,
      },
      select: { id: true },
    });
    createdImportBatchIds.push(batch.id);

    const docNum = `INV-${uniqueSuffix}-${createdSapInvoiceIds.length + 1}`;
    const invoice = await prisma.sapInvoice.create({
      data: {
        importBatchId: batch.id,
        sapDocNum: docNum,
        customerSapCode: "DEMO-CUST-001",
        customerName: "Delivered Orders test customer (Demo)",
        matchedCustomerId: customerId,
        matchedOrderId: options.matchedOrderId ?? null,
        invoiceDate: new Date(),
        currencyCode: options.currencyCode ?? "USD",
        total: lines.reduce((sum, l) => sum + Number(l.quantityInvoiced) * Number(l.unitPrice), 0).toFixed(4),
        rawSourceData: {},
        isDemo: true,
        lines: {
          create: lines.map((line, i) => ({
            lineNumber: i + 1,
            sapItemCode: `ITEM-${uniqueSuffix}-${createdSapInvoiceIds.length}-${i + 1}`,
            sapItemDescription: `Delivered orders test item ${createdSapInvoiceIds.length}-${i + 1}`,
            quantityInvoiced: line.quantityInvoiced,
            unitPrice: line.unitPrice,
            lineTotal: (Number(line.quantityInvoiced) * Number(line.unitPrice)).toFixed(4),
            rawSourceData: {},
            isDemo: true,
          })),
        },
      },
      select: { id: true, sapDocNum: true, lines: { select: { id: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdSapInvoiceIds.push(invoice.id);

    return { invoiceId: invoice.id, sapDocNum: invoice.sapDocNum, lineIds: invoice.lines.map((l: { id: string }) => l.id) };
  }

  /**
   * A fresh order with one 10-unit line, fully picked/authorized by
   * `adminId`, then split across TWO dispatches (6 + 4) -- both using the
   * SAME driver/assistant/vehicle, so a test can assert the people list
   * deduplicates a driver who appears on more than one dispatch for the
   * same order. Both dispatches depart and get a clean physical delivery
   * outcome recorded.
   */
  async function createFullyDispatchedOrder() {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");
    const { createDispatchRecord, departDispatchRecord } = await import("@/lib/fulfilment/dispatch");
    const { recordDelivery } = await import("@/lib/fulfilment/delivery");

    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        customerPoReference: `PO-${uniqueSuffix}`,
        orderDate: new Date("2026-11-01T08:00:00.000Z"),
        currency: "USD",
        receivedAt: new Date("2026-11-01T08:05:00.000Z"),
        isDemo: true,
        lines: { create: [{ lineNumber: 1, originalProductDescription: `Delivered Orders test item ${uniqueSuffix}`, requestedQuantity: "10.0000", requestedUnitCode: "EA", isDemo: true }] },
      },
      select: { id: true, reference: true, lines: { select: { id: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdOrderIds.push(order.id);
    const line = order.lines[0]!;

    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    await recordPickedLine(started.session.id, line.id, "10.0000", "0.0000", undefined, adminId);
    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    const dispatch1 = await createDispatchRecord(order.id, adminId, { lines: [{ orderLineId: line.id, quantity: "6.0000" }], driverId, assistantId, vehicleId });
    if (!dispatch1.ok) throw new Error(dispatch1.message);
    const dispatch2 = await createDispatchRecord(order.id, adminId, { lines: [{ orderLineId: line.id, quantity: "4.0000" }], driverId, assistantId, vehicleId });
    if (!dispatch2.ok) throw new Error(dispatch2.message);

    for (const dispatchRecordId of [dispatch1.dispatchRecordId, dispatch2.dispatchRecordId]) {
      const departed = await departDispatchRecord(dispatchRecordId, adminId);
      if (!departed.ok) throw new Error(departed.message);

      // A clean ("ACCEPTED_IN_FULL") outcome: accepted quantity equals
      // exactly what this dispatch line dispatched, nothing rejected.
      const dispatchLines: { id: string; dispatchedQuantity: unknown }[] = await prisma.dispatchLine.findMany({ where: { dispatchRecordId }, select: { id: true, dispatchedQuantity: true } });
      const delivered = await recordDelivery(
        dispatchRecordId,
        adminId,
        { lines: dispatchLines.map((l) => ({ dispatchLineId: l.id, acceptedQuantity: String(l.dispatchedQuantity), rejectedQuantity: "0" })), recipientName: "Test Recipient" },
        {}
      );
      if (!delivered.ok) throw new Error(delivered.message);
    }

    return { orderId: order.id, orderReference: order.reference, orderLineId: line.id };
  }

  it("lists an invoice in Delivered Orders only once its outcome is recorded, and keeps its own definition of 'delivered' identical to the Ready-for-Invoice queue's", async () => {
    if (skipAll) return;
    const { recordInvoiceDeliveryOutcome } = await import("@/lib/invoice-delivery/record-outcome");
    const { getDeliveredSapInvoiceIds } = await import("@/lib/invoice-delivery/queries");
    const { listDeliveredOrders } = await import("@/lib/delivered-orders/queries");

    const { orderId, orderReference } = await createFullyDispatchedOrder();
    const { invoiceId, sapDocNum } = await createSapInvoice([{ quantityInvoiced: "10.0000", unitPrice: "15.0000" }], { matchedOrderId: orderId });

    // Not delivered yet -- must not appear in either list.
    const before = await listDeliveredOrders({ includeDemo: true }, { page: 1, pageSize: 50 });
    expect(before.rows.some((r) => r.sapInvoiceId === invoiceId)).toBe(false);

    const result = await recordInvoiceDeliveryOutcome(invoiceId, adminId, { outcome: "NO_CLAIM", podReference: "POD-DO-1" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    createdDeliveryRecordIds.push(result.id);

    // Now delivered in BOTH places, from the same single source of truth.
    const deliveredIds = await getDeliveredSapInvoiceIds();
    expect(deliveredIds).toContain(invoiceId);

    const after = await listDeliveredOrders({ includeDemo: true }, { page: 1, pageSize: 50 });
    const row = after.rows.find((r) => r.sapInvoiceId === invoiceId);
    expect(row).toBeDefined();
    expect(row!.sapDocNum).toBe(sapDocNum);
    expect(row!.hasClaim).toBe(false);
    expect(row!.outcome).toBe("NO_CLAIM");
    expect(row!.orderReference).toBe(orderReference);
    expect(row!.driverNames).toEqual([`DO Test Driver ${uniqueSuffix}`]); // deduplicated across both dispatches
    expect(row!.vehicleRegistrations).toEqual([`DOTEST-${uniqueSuffix}`]);

    // Filters: outcome.
    const noClaimOnly = await listDeliveredOrders({ includeDemo: true, outcome: "NO_CLAIM" }, { page: 1, pageSize: 50 });
    expect(noClaimOnly.rows.some((r) => r.sapInvoiceId === invoiceId)).toBe(true);
    const withClaimOnly = await listDeliveredOrders({ includeDemo: true, outcome: "WITH_CLAIM" }, { page: 1, pageSize: 50 });
    expect(withClaimOnly.rows.some((r) => r.sapInvoiceId === invoiceId)).toBe(false);

    // Filters: driver and vehicle.
    const byDriver = await listDeliveredOrders({ includeDemo: true, driverId }, { page: 1, pageSize: 50 });
    expect(byDriver.rows.some((r) => r.sapInvoiceId === invoiceId)).toBe(true);
    const byOtherVehicle = await listDeliveredOrders({ includeDemo: true, vehicleId: "non-existent-vehicle-id" }, { page: 1, pageSize: 50 });
    expect(byOtherVehicle.rows.some((r) => r.sapInvoiceId === invoiceId)).toBe(false);

    // Filters: invoice number search and PO reference search.
    const byInvoiceSearch = await listDeliveredOrders({ includeDemo: true, invoiceSearch: sapDocNum }, { page: 1, pageSize: 50 });
    expect(byInvoiceSearch.rows.some((r) => r.sapInvoiceId === invoiceId)).toBe(true);
    const byPoReference = await listDeliveredOrders({ includeDemo: true, poReference: orderReference }, { page: 1, pageSize: 50 });
    expect(byPoReference.rows.some((r) => r.sapInvoiceId === invoiceId)).toBe(true);
  });

  it("assembles the full A-H lifecycle detail, never assuming zero for a missing timestamp, and deduplicates a driver who appears on more than one dispatch", async () => {
    if (skipAll) return;
    const { recordInvoiceDeliveryOutcome } = await import("@/lib/invoice-delivery/record-outcome");
    const { getDeliveredOrderDetail } = await import("@/lib/delivered-orders/queries");

    const { orderId } = await createFullyDispatchedOrder();
    const { invoiceId } = await createSapInvoice([{ quantityInvoiced: "10.0000", unitPrice: "15.0000" }], { matchedOrderId: orderId });

    const result = await recordInvoiceDeliveryOutcome(invoiceId, adminId, { outcome: "NO_CLAIM", podReference: "POD-DO-2" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    createdDeliveryRecordIds.push(result.id);

    const detail = await getDeliveredOrderDetail(invoiceId);
    expect(detail).not.toBeNull();
    if (!detail) return;

    // (A) Original PO
    expect(detail.purchaseOrder).not.toBeNull();
    expect(detail.purchaseOrder!.lines).toHaveLength(1);
    expect(detail.purchaseOrder!.lines[0]!.requestedQuantity).toBe("10.0000");

    // (B) Picking
    expect(detail.pickingSessions).toHaveLength(1);
    expect(detail.pickingSessions[0]!.lines[0]!.foundQuantity).toBe("10.0000");

    // (C) Invoice
    expect(detail.invoice.lines).toHaveLength(1);

    // (D) Dispatch -- both dispatches present, each with its own physical delivery outcome.
    expect(detail.dispatches).toHaveLength(2);
    for (const dispatch of detail.dispatches) {
      expect(dispatch.physicalDelivery).not.toBeNull();
      expect(dispatch.driverName).toBe(`DO Test Driver ${uniqueSuffix}`);
    }

    // (E) Delivery outcome
    expect(detail.deliveryOutcome.outcome).toBe("NO_CLAIM");
    expect(detail.deliveryOutcome.podReference).toBe("POD-DO-2");

    // (F) Claims -- none for a NO_CLAIM outcome.
    expect(detail.claims).toEqual([]);

    // (G) People -- the SAME driver/assistant/vehicle operator recorded
    // on two separate dispatches must appear exactly once each, not twice.
    const driverEntries = detail.people.filter((p) => p.role === "Driver");
    expect(driverEntries).toHaveLength(1);
    const assistantEntries = detail.people.filter((p) => p.role === "Driver's assistant");
    expect(assistantEntries).toHaveLength(1);

    // (H) Durations -- every stage has a real timestamp here, so NONE
    // should be "Not Available" (null).
    for (const d of detail.durations) {
      expect(d.milliseconds, `duration "${d.label}" unexpectedly null`).not.toBeNull();
      expect(d.milliseconds).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns 'Not Available' (null), never a fabricated zero, for every duration and section an unmatched invoice has no data for", async () => {
    if (skipAll) return;
    const { recordInvoiceDeliveryOutcome } = await import("@/lib/invoice-delivery/record-outcome");
    const { getDeliveredOrderDetail } = await import("@/lib/delivered-orders/queries");

    // No matchedOrderId at all -- an invoice delivered with no SalesFlow
    // order behind it (e.g. invoiced outside this system).
    const { invoiceId } = await createSapInvoice([{ quantityInvoiced: "3.0000", unitPrice: "9.0000" }]);

    const result = await recordInvoiceDeliveryOutcome(invoiceId, adminId, { outcome: "NO_CLAIM" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    createdDeliveryRecordIds.push(result.id);

    const detail = await getDeliveredOrderDetail(invoiceId);
    expect(detail).not.toBeNull();
    if (!detail) return;

    expect(detail.purchaseOrder).toBeNull();
    expect(detail.pickingSessions).toEqual([]);
    expect(detail.dispatches).toEqual([]);

    // Every duration depends on either the (absent) order or the (absent)
    // dispatch -- all seven must be explicitly "Not Available" (null),
    // never zero.
    expect(detail.durations).toHaveLength(7);
    for (const d of detail.durations) {
      expect(d.milliseconds, `duration "${d.label}" should be null (Not Available), not a fabricated value`).toBeNull();
    }
  });

  it("getDeliveredOrderDetail returns null for an invoice with no delivery outcome recorded at all", async () => {
    if (skipAll) return;
    const { getDeliveredOrderDetail } = await import("@/lib/delivered-orders/queries");

    const { invoiceId } = await createSapInvoice([{ quantityInvoiced: "1.0000", unitPrice: "1.0000" }]);
    // Deliberately never calling recordInvoiceDeliveryOutcome.

    const detail = await getDeliveredOrderDetail(invoiceId);
    expect(detail).toBeNull();
  });
});
