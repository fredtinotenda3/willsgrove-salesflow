import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Order workflow (Ready to Invoice > Invoiced > Dispatched > Delivered > Done) and
 * rejected-product recording, end to end on PostgreSQL.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 DATABASE_URL=... npx vitest run tests/order-workflow-db.integration.test.ts
 *
 * Self-contained (isDemo rows with unique codes, removed afterwards).
 */
const RUN = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";
const run = `wf${Date.now().toString(36)}`;

describe.skipIf(!RUN)("Order workflow + claims + lost sales (PostgreSQL)", () => {
  type Prisma = typeof import("@/lib/prisma").prisma;
  let prisma: Prisma;
  let adminId: string;
  let customerId: string;
  const productIds: string[] = [];
  const orderIds: string[] = [];
  const products: { id: string; code: string }[] = [];

  async function makeReadyOrder(qtys: string[]) {
    const { createOrderCore, generateOrderReference, TRANSACTION_OPTIONS } = await import("@/lib/orders");
    const created = await prisma.$transaction(
      (tx) =>
        createOrderCore(
          tx,
          generateOrderReference(),
          {
            customerId,
            source: "MANUAL",
            orderDate: "2026-11-01",
            requestedDeliveryDate: "2026-11-05",
            currency: "USD",
            lines: qtys.map((qty, i) => ({
              originalProductDescription: `Item ${i}`,
              productId: products[i].id,
              sapItemCodeSnapshot: products[i].code,
              requestedQuantity: qty,
              requestedUnitCode: "KG",
              customerUnitPrice: "2.0000",
            })),
          } as never,
          adminId,
          true
        ),
      TRANSACTION_OPTIONS
    );
    orderIds.push(created.id);
    // Real orders are not demo rows; the Claims/returned-products lists exclude demo data by design.
    await prisma.customerOrder.update({ where: { id: created.id }, data: { isDemo: false } });
    // Picking completed and authorised in full -> READY_TO_INVOICE.
    await prisma.pickingSession.create({
      data: {
        orderId: created.id,
        startedById: adminId,
        status: "AUTHORIZED",
        authorizedById: adminId,
        authorizedAt: new Date(),
        isDemo: true,
        lines: { create: created.lines.map((l: { id: string }, i: number) => ({ orderLineId: l.id, requestedQuantity: qtys[i], foundQuantity: qtys[i], unavailableQuantity: "0" })) },
      },
    });
    await prisma.customerOrder.update({ where: { id: created.id }, data: { status: "READY_TO_INVOICE" } });
    return created as { id: string; lines: { id: string }[] };
  }

  async function dispatchDeparted(orderId: string, lines: { orderLineId: string; qty: string }[]) {
    return prisma.dispatchRecord.create({
      data: { orderId, createdById: adminId, isDemo: true, status: "DEPARTED", departedById: adminId, departedAt: new Date(), lines: { create: lines.map((l) => ({ orderLineId: l.orderLineId, dispatchedQuantity: l.qty })) } },
      select: { id: true, lines: { select: { id: true, orderLineId: true } } },
    });
  }

  async function statusOf(orderId: string) {
    const { getOrderById } = await import("@/lib/order-queries");
    const { getEffectiveOrderStatus } = await import("@/lib/order-display");
    const order = await getOrderById(orderId);
    return getEffectiveOrderStatus({ status: order!.status, dispatchStatuses: order!.dispatchStatuses, invoiceState: order!.invoiceState, completed: order!.completed }).label;
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    const admin = await prisma.user.create({ data: { name: `Admin ${run}`, email: `${run}@example.test`, passwordHash: "x", role: "ADMINISTRATOR" }, select: { id: true } });
    adminId = admin.id;
    for (let n = 0; n < 3; n++) {
      const code = `${run.toUpperCase()}-P${n}`;
      const p = await prisma.product.create({ data: { sapItemCode: code, itemName: `Product ${n} ${run}`, isDemo: true }, select: { id: true } });
      productIds.push(p.id);
      products.push({ id: p.id, code });
    }
    const c = await prisma.customer.create({ data: { name: `Customer ${run}`, currencyCode: "USD", isDemo: true }, select: { id: true } });
    customerId = c.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      const invoices = await prisma.sapInvoice.findMany({ where: { matchedOrderId: { in: orderIds } }, select: { id: true } });
      const invoiceIds = invoices.map((i) => i.id);
      const dispatches = await prisma.dispatchRecord.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
      const dispatchIds = dispatches.map((d) => d.id);
      await prisma.invoiceClaimLine.deleteMany({ where: { claim: { customerId } } });
      await prisma.invoiceClaim.deleteMany({ where: { customerId } });
      await prisma.invoiceDeliveryRecord.deleteMany({ where: { sapInvoiceId: { in: invoiceIds } } });
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoiceId: { in: invoiceIds } } });
      await prisma.sapInvoice.deleteMany({ where: { id: { in: invoiceIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { uploadedById: adminId } });
      await prisma.deliveryRecord.deleteMany({ where: { dispatchRecordId: { in: dispatchIds } } });
      await prisma.dispatchRecord.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.pickingSession.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.auditEvent.deleteMany({ where: { actorId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
    } catch (error) {
      console.warn("[test cleanup] incomplete:", error instanceof Error ? error.message : error);
    } finally {
      await prisma.$disconnect();
    }
  });

  it("walks Ready to Invoice > Invoiced > Dispatched > Delivered > Completed, never skipping the invoice", async () => {
    const { getOrderFulfilmentStatus } = await import("@/lib/fulfilment/queries");
    const { recordNativeInvoice } = await import("@/lib/invoice-recording/record-native-invoice");
    const { recordDelivery } = await import("@/lib/fulfilment/delivery");
    const { completeOrder } = await import("@/lib/order-completion");

    const order = await makeReadyOrder(["10", "10"]);
    const [l1, l2] = order.lines;
    expect(await statusOf(order.id)).toBe("Ready to Invoice");

    // Nothing is dispatchable before it is invoiced.
    let fulfilment = await getOrderFulfilmentStatus(order.id);
    expect(fulfilment!.lines.every((l) => l.dispatchableQuantity === "0")).toBe(true);
    expect(fulfilment!.lines.every((l) => Number(l.awaitingInvoiceQuantity) === 10)).toBe(true);

    // Invoice ONE line (line by line) -> partially invoiced, only that line dispatchable.
    const first = await recordNativeInvoice(order.id, adminId, { invoiceDate: "2026-11-02", lines: [{ orderLineId: l1.id, quantityInvoiced: "10", unitPrice: "2" }] });
    expect(first.ok).toBe(true);
    expect(await statusOf(order.id)).toBe("Partially Invoiced");
    fulfilment = await getOrderFulfilmentStatus(order.id);
    expect(Number(fulfilment!.lines.find((l) => l.orderLineId === l1.id)!.dispatchableQuantity)).toBe(10);
    expect(Number(fulfilment!.lines.find((l) => l.orderLineId === l2.id)!.dispatchableQuantity)).toBe(0);

    // Completing too early is refused.
    const early = await completeOrder(order.id, adminId);
    expect(early.ok).toBe(false);

    const second = await recordNativeInvoice(order.id, adminId, { invoiceDate: "2026-11-02", lines: [{ orderLineId: l2.id, quantityInvoiced: "10", unitPrice: "2" }] });
    expect(second.ok).toBe(true);
    expect(await statusOf(order.id)).toBe("Invoiced");

    const dispatch = await dispatchDeparted(order.id, [
      { orderLineId: l1.id, qty: "10" },
      { orderLineId: l2.id, qty: "10" },
    ]);
    expect(await statusOf(order.id)).toBe("Dispatched");

    // A reason beside a 0 rejected quantity is refused (the "Accepted in full" bug), as is a non-standard reason.
    const lineIds = dispatch.lines;
    const bad = await recordDelivery(
      dispatch.id,
      adminId,
      { lines: lineIds.map((l) => ({ dispatchLineId: l.id, acceptedQuantity: "10", rejectedQuantity: "0", rejectionReason: "Short Delivered" })) },
      {}
    );
    expect(bad.ok).toBe(false);
    const freeText = await recordDelivery(
      dispatch.id,
      adminId,
      { lines: lineIds.map((l) => ({ dispatchLineId: l.id, acceptedQuantity: "0", rejectedQuantity: "10", rejectionReason: "whatever" })) },
      {}
    );
    expect(freeText.ok).toBe(false);

    // Deliver: line 1 clean, line 2 fully rejected as Short Delivered.
    const delivered = await recordDelivery(
      dispatch.id,
      adminId,
      {
        lines: [
          { dispatchLineId: lineIds.find((l) => l.orderLineId === l1.id)!.id, acceptedQuantity: "10", rejectedQuantity: "0" },
          { dispatchLineId: lineIds.find((l) => l.orderLineId === l2.id)!.id, acceptedQuantity: "4", rejectedQuantity: "6", rejectionReason: "Short Delivered" },
        ],
      },
      {}
    );
    expect(delivered.ok).toBe(true);
    if (!delivered.ok) return;
    expect(delivered.outcome).toBe("PARTIALLY_REJECTED");
    expect(delivered.claim?.lineCount).toBe(1);
    expect(await statusOf(order.id)).toBe("Delivered");

    // Mark as Done: invoices get their delivery outcome, the claim is attached.
    const done = await completeOrder(order.id, adminId);
    expect(done.ok).toBe(true);
    if (!done.ok) return;
    expect(done.claimCount).toBe(1);
    expect(await statusOf(order.id)).toBe("Completed");
    const again = await completeOrder(order.id, adminId);
    expect(again.ok).toBe(false);

    // The claim is linked and visible everywhere.
    const claim = await prisma.invoiceClaim.findFirstOrThrow({ where: { orderId: order.id }, include: { lines: true } });
    expect(claim.invoiceDeliveryRecordId).not.toBeNull();
    expect(claim.lines[0].reasonCategory).toBe("SHORT_DELIVERY");

    const { listInvoiceClaims } = await import("@/lib/invoice-claims/queries");
    const claimsPage = await listInvoiceClaims({ customerId }, 1, 25);
    expect(claimsPage.rows.map((c) => c.id)).toContain(claim.id);

    const { listReturnedProducts, getReturnReasonSummary } = await import("@/lib/invoice-claims/returned-products");
    const returned = await listReturnedProducts({ customerId }, 1, 25);
    expect(returned.rows).toHaveLength(1);
    expect(returned.rows[0]).toMatchObject({ rejectedQuantity: "6", reasonLabel: "Short Delivered", rejectedValue: "12.0000" });
    const reasons = await getReturnReasonSummary();
    expect(reasons.find((r) => r.reasonLabel === "Short Delivered")).toBeTruthy();

    const { getUnifiedLostSalesReport } = await import("@/lib/lost-sales/unified-queries");
    const unified = await getUnifiedLostSalesReport({ includeDemo: true, customerId, dateFrom: null, dateTo: null });
    expect(JSON.stringify(unified)).toContain("Short Delivered");
  });

  it("an order with nothing rejected completes as No Claim", async () => {
    const { recordNativeInvoice } = await import("@/lib/invoice-recording/record-native-invoice");
    const { recordDelivery } = await import("@/lib/fulfilment/delivery");
    const { completeOrder } = await import("@/lib/order-completion");
    const order = await makeReadyOrder(["5"]);
    const inv = await recordNativeInvoice(order.id, adminId, { invoiceDate: "2026-11-02", lines: [{ orderLineId: order.lines[0].id, quantityInvoiced: "5", unitPrice: "2" }] });
    expect(inv.ok).toBe(true);
    const dispatch = await dispatchDeparted(order.id, [{ orderLineId: order.lines[0].id, qty: "5" }]);
    const delivered = await recordDelivery(dispatch.id, adminId, { lines: [{ dispatchLineId: dispatch.lines[0].id, acceptedQuantity: "5", rejectedQuantity: "0" }] }, {});
    expect(delivered.ok).toBe(true);
    const done = await completeOrder(order.id, adminId);
    expect(done).toMatchObject({ ok: true, claimCount: 0, withClaimCount: 0 });
    const record = await prisma.invoiceDeliveryRecord.findFirstOrThrow({ where: { sapInvoice: { matchedOrderId: order.id } } });
    expect(record.outcome).toBe("NO_CLAIM");
  });

  it("an order delivered before the invoice step existed is invoiced automatically when marked as done, and counts in admin order value", async () => {
    const { recordDelivery } = await import("@/lib/fulfilment/delivery");
    const { completeOrder } = await import("@/lib/order-completion");
    const order = await makeReadyOrder(["5"]);
    const dispatch = await dispatchDeparted(order.id, [{ orderLineId: order.lines[0].id, qty: "5" }]);
    await recordDelivery(dispatch.id, adminId, { lines: [{ dispatchLineId: dispatch.lines[0].id, acceptedQuantity: "5", rejectedQuantity: "0" }] }, {});
    expect(await statusOf(order.id)).toBe("Delivered");
    expect(await prisma.sapInvoice.count({ where: { matchedOrderId: order.id } })).toBe(0);

    const done = await completeOrder(order.id, adminId);
    expect(done.ok).toBe(true);
    const invoices = await prisma.sapInvoice.findMany({ where: { matchedOrderId: order.id }, include: { deliveryRecord: true } });
    expect(invoices).toHaveLength(1);
    expect(invoices[0].deliveryRecord?.outcome).toBe("NO_CLAIM");
    expect(await statusOf(order.id)).toBe("Completed");

    // Admin "Value by currency": order value comes from the lines when the stored total is null (it was $0.00).
    const { getCommandCentre } = await import("@/lib/admin/command-centre");
    const centre = await getCommandCentre("7d");
    const usd = centre.money.ordersByCurrency.find((r) => r.currency === "USD");
    expect(Number(usd?.total ?? 0)).toBeGreaterThan(0);
  });
});
