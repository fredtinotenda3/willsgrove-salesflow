import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Real-world fix (native invoice recording). DB-backed acceptance tests
 * against a REAL database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the same reason as every other *-db.integration
 * test in this project: @prisma/client in this sandbox is a stub that
 * THROWS when merely constructed. Every lib touched here is imported
 * with a dynamic `await import(...)` inside the (skippable) test bodies
 * below.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-001 customer must exist).
 *
 * This feature (getInvoiceRecordingEligibility, recordNativeInvoice,
 * isNativelyRecordedInvoice -- lib/invoice-recording/*) shipped this
 * engagement with ZERO test coverage of any kind. The pure validation
 * half (validateNativeInvoiceLineQuantity, the zod schemas) is covered
 * separately in tests/invoice-recording-validation.test.ts, which needs
 * no database at all; this file is specifically the DB-dependent half:
 * the real dispatched/already-invoiced aggregation, the transactional
 * insert, and the race-safe re-validation inside that transaction.
 *
 * Fixture pipeline mirrors tests/invoice-claims-db.integration.test.ts's
 * own createDispatchedOrderLine helper (order -> pick -> authorize ->
 * dispatch), reused rather than reinvented, since this is exactly the
 * same real-world precondition a line needs before there is anything
 * left to invoice on it at all.
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Real-world fix: native invoice recording", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let driverId: string;
  let assistantId: string;
  let vehicleId: string;
  const uniqueSuffix = `invrec-test-${Date.now()}`;

  const createdOrderIds: string[] = [];
  const createdPersonnelIds: string[] = [];
  const createdVehicleIds: string[] = [];
  const createdSapInvoiceIds: string[] = [];
  const createdImportBatchIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping native-invoice-recording DB integration test: need an admin user and the " +
          "DEMO-CUST-001 customer. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;

    const driver = await prisma.personnel.create({
      data: { name: `Inv Rec Test Driver ${uniqueSuffix}`, role: "DRIVER", createdById: adminId, isDemo: true },
      select: { id: true },
    });
    createdPersonnelIds.push(driver.id);
    const assistant = await prisma.personnel.create({
      data: { name: `Inv Rec Test Assistant ${uniqueSuffix}`, role: "DRIVER_ASSISTANT", createdById: adminId, isDemo: true },
      select: { id: true },
    });
    createdPersonnelIds.push(assistant.id);
    const vehicle = await prisma.vehicle.create({
      data: { registrationNumber: `INVRECTEST-${uniqueSuffix}`, createdById: adminId, isDemo: true },
      select: { id: true },
    });
    createdVehicleIds.push(vehicle.id);

    driverId = driver.id;
    assistantId = assistant.id;
    vehicleId = vehicle.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoiceId: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoice.deleteMany({ where: { id: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { id: { in: createdImportBatchIds } } });

      for (const orderId of createdOrderIds) {
        const dispatchRecordIds: { id: string }[] = await prisma.dispatchRecord.findMany({ where: { orderId }, select: { id: true } });
        await prisma.deliveryRecord.deleteMany({ where: { dispatchRecordId: { in: dispatchRecordIds.map((d: { id: string }) => d.id) } } });
        await prisma.dispatchRecord.deleteMany({ where: { orderId } });
        await prisma.pickingSession.deleteMany({ where: { orderId } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
        await prisma.auditEvent.deleteMany({
          where: { entityType: { in: ["CustomerOrder", "PickingSession", "PickingLine", "DispatchRecord", "DeliveryRecord", "SapInvoice"] } },
        });
        await prisma.orderLine.deleteMany({ where: { orderId } });
      }
      for (const orderId of createdOrderIds) {
        await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => undefined);
      }
      await prisma.personnel.deleteMany({ where: { id: { in: createdPersonnelIds } } });
      await prisma.vehicle.deleteMany({ where: { id: { in: createdVehicleIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /** A fresh order with ONE line, fully picked, authorized, and
   * dispatched for the given quantity -- the real-world precondition
   * before there is anything to invoice on it. Mirrors
   * tests/invoice-claims-db.integration.test.ts's own
   * createDispatchedOrderLine, reused rather than reinvented. */
  async function createDispatchedOrderLine(quantity = "50.0000", unitPrice = "9.0000") {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");
    const { createDispatchRecord } = await import("@/lib/fulfilment/dispatch");

    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        orderDate: new Date("2026-11-01T00:00:00.000Z"),
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [
            {
              lineNumber: 1,
              originalProductDescription: `Native invoice recording test item ${uniqueSuffix}`,
              requestedQuantity: quantity,
              requestedUnitCode: "EA",
              customerUnitPrice: unitPrice,
              approvedUnitPrice: unitPrice,
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdOrderIds.push(order.id);
    const orderLineId = order.lines[0]!.id;

    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    await recordPickedLine(started.session.id, orderLineId, quantity, "0.0000", undefined, adminId);
    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    const dispatched = await createDispatchRecord(order.id, adminId, {
      lines: [{ orderLineId, quantity }],
      driverId,
      assistantId,
      vehicleId,
    });
    if (!dispatched.ok) throw new Error(dispatched.message);

    return { orderId: order.id, orderLineId };
  }

  it("getInvoiceRecordingEligibility surfaces the full dispatched quantity as remainingToInvoice before any invoice exists", async () => {
    if (skipAll) return;
    const { getInvoiceRecordingEligibility } = await import("@/lib/invoice-recording/queries");

    const { orderId, orderLineId } = await createDispatchedOrderLine("50.0000", "9.0000");
    const eligibility = await getInvoiceRecordingEligibility(orderId);

    expect(eligibility).not.toBeNull();
    expect(eligibility!.lines).toHaveLength(1);
    expect(eligibility!.lines[0]!.orderLineId).toBe(orderLineId);
    expect(eligibility!.lines[0]!.dispatchedQuantity).toBe("50");
    expect(eligibility!.lines[0]!.alreadyInvoicedQuantity).toBe("0");
    expect(eligibility!.lines[0]!.remainingToInvoice).toBe("50");
    expect(eligibility!.lines[0]!.suggestedUnitPrice).toBe("9");
  });

  it("returns null for an order id that does not exist, rather than throwing", async () => {
    if (skipAll) return;
    const { getInvoiceRecordingEligibility } = await import("@/lib/invoice-recording/queries");
    const result = await getInvoiceRecordingEligibility("nonexistent-order-id");
    expect(result).toBeNull();
  });

  it("recordNativeInvoice creates a SapInvoice honestly marked NATIVE_RECORDING, with taxTotal null and total equal to subtotal", async () => {
    if (skipAll) return;
    const { recordNativeInvoice } = await import("@/lib/invoice-recording/record-native-invoice");
    const { isNativelyRecordedInvoice } = await import("@/lib/invoice-recording/queries");
    const { prisma } = await import("@/lib/prisma");

    const { orderId, orderLineId } = await createDispatchedOrderLine("20.0000", "15.0000");

    const result = await recordNativeInvoice(orderId, adminId, {
      invoiceDate: "2026-11-23",
      lines: [{ orderLineId, quantityInvoiced: "20.0000", unitPrice: "15.0000" }],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdSapInvoiceIds.push(result.id);

    const invoice = await prisma.sapInvoice.findUnique({
      where: { id: result.id },
      select: { subtotal: true, taxTotal: true, total: true, reconciliationStatus: true, rawSourceData: true, importBatchId: true },
    });
    expect(invoice).not.toBeNull();
    createdImportBatchIds.push(invoice!.importBatchId);
    expect(invoice!.subtotal?.toString()).toBe("300");
    expect(invoice!.taxTotal).toBeNull();
    expect(invoice!.total?.toString()).toBe("300");
    expect(invoice!.reconciliationStatus).toBe("MATCHED");
    expect(isNativelyRecordedInvoice(invoice!.rawSourceData)).toBe(true);
  });

  it("recordNativeInvoice rejects a quantity exceeding what remains to invoice, and writes nothing", async () => {
    if (skipAll) return;
    const { recordNativeInvoice } = await import("@/lib/invoice-recording/record-native-invoice");
    const { prisma } = await import("@/lib/prisma");

    const { orderId, orderLineId } = await createDispatchedOrderLine("10.0000", "4.0000");

    const result = await recordNativeInvoice(orderId, adminId, {
      invoiceDate: "2026-11-23",
      lines: [{ orderLineId, quantityInvoiced: "10.0001", unitPrice: "4.0000" }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/outstanding to invoice/i);

    const invoiceCount = await prisma.sapInvoice.count({ where: { matchedOrderId: orderId } });
    expect(invoiceCount).toBe(0);
  });

  it("enforces the live remaining-to-invoice aggregate across invoices (a second invoice cannot re-invoice quantity the first already covered)", async () => {
    if (skipAll) return;
    const { recordNativeInvoice } = await import("@/lib/invoice-recording/record-native-invoice");
    const { getInvoiceRecordingEligibility } = await import("@/lib/invoice-recording/queries");

    const { orderId, orderLineId } = await createDispatchedOrderLine("30.0000", "6.0000");

    const first = await recordNativeInvoice(orderId, adminId, {
      invoiceDate: "2026-11-23",
      lines: [{ orderLineId, quantityInvoiced: "20.0000", unitPrice: "6.0000" }],
    });
    expect(first.ok).toBe(true);
    if (first.ok) createdSapInvoiceIds.push(first.id);

    // Only 10 remains (30 dispatched - 20 already invoiced).
    const eligibility = await getInvoiceRecordingEligibility(orderId);
    expect(eligibility!.lines[0]!.remainingToInvoice).toBe("10");

    const tooMuch = await recordNativeInvoice(orderId, adminId, {
      invoiceDate: "2026-11-23",
      lines: [{ orderLineId, quantityInvoiced: "10.0001", unitPrice: "6.0000" }],
    });
    expect(tooMuch.ok).toBe(false);

    const exactRemainder = await recordNativeInvoice(orderId, adminId, {
      invoiceDate: "2026-11-23",
      lines: [{ orderLineId, quantityInvoiced: "10.0000", unitPrice: "6.0000" }],
    });
    expect(exactRemainder.ok).toBe(true);
    if (exactRemainder.ok) createdSapInvoiceIds.push(exactRemainder.id);

    // Nothing left at all now.
    const finalEligibility = await getInvoiceRecordingEligibility(orderId);
    expect(finalEligibility!.lines).toHaveLength(0);
  });

  it("rejects a line referencing an order line that does not belong to this order", async () => {
    if (skipAll) return;
    const { recordNativeInvoice } = await import("@/lib/invoice-recording/record-native-invoice");

    const { orderId: orderA } = await createDispatchedOrderLine("5.0000", "2.0000");
    const { orderLineId: orderBLineId } = await createDispatchedOrderLine("5.0000", "2.0000");

    const result = await recordNativeInvoice(orderA, adminId, {
      invoiceDate: "2026-11-23",
      lines: [{ orderLineId: orderBLineId, quantityInvoiced: "5.0000", unitPrice: "2.0000" }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(400);
    expect(result.message).toMatch(/do not belong to this order/i);
  });

  it("rejects a request listing the same order line twice", async () => {
    if (skipAll) return;
    const { recordNativeInvoice } = await import("@/lib/invoice-recording/record-native-invoice");

    const { orderId, orderLineId } = await createDispatchedOrderLine("40.0000", "3.0000");

    const result = await recordNativeInvoice(orderId, adminId, {
      invoiceDate: "2026-11-23",
      lines: [
        { orderLineId, quantityInvoiced: "10.0000", unitPrice: "3.0000" },
        { orderLineId, quantityInvoiced: "10.0000", unitPrice: "3.0000" },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/only appear once/i);
  });

  it("returns 404 for a non-existent order", async () => {
    if (skipAll) return;
    const { recordNativeInvoice } = await import("@/lib/invoice-recording/record-native-invoice");

    const result = await recordNativeInvoice("nonexistent-order-id", adminId, {
      invoiceDate: "2026-11-23",
      lines: [{ orderLineId: "nonexistent-line-id", quantityInvoiced: "1.0000", unitPrice: "1.0000" }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(404);
  });
});
