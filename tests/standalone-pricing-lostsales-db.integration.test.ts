import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Standalone business-logic correction: PostgreSQL integration tests for the
 * eight acceptance scenarios (full return, partial return, unfulfilled demand,
 * customer price isolation, automatic pricing, order total consistency,
 * historical price protection, standalone / no SAP).
 *
 *   RUN_DB_INTEGRATION_TESTS=1 DATABASE_URL=... npx vitest run tests/standalone-pricing-lostsales-db.integration.test.ts
 *
 * Self-contained: creates its own admin, customers, products, price lists and
 * orders (all isDemo: true, unique per-run codes) and removes them afterwards.
 * It does NOT need `npm run db:seed`, does not touch existing customers or the
 * existing price-list assignments, and reads the shared reports with
 * includeDemo + deltas so it is safe on a database that already holds data.
 * No SAP configuration or SAP rows are involved anywhere.
 */
const RUN = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

const run = `sa${Date.now().toString(36)}`;
const REASON_LABEL = "Poor Quality Product";

describe.skipIf(!RUN)("Standalone lost sales + customer pricing (PostgreSQL)", () => {
  type Prisma = typeof import("@/lib/prisma").prisma;
  let prisma: Prisma;
  let adminId: string;
  let customerA: string;
  let customerB: string;
  let customerC: string;
  let customerD: string;
  let p1: { id: string; code: string };
  let p2: { id: string; code: string };
  let p3: { id: string; code: string };
  let usdListId: string;

  const orderIds: string[] = [];
  const customerIds: string[] = [];
  const productIds: string[] = [];
  const listIds: string[] = [];

  async function makeOrder(customerId: string, lines: { productId: string; code: string; qty: string; price?: string }[], currency?: string) {
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
            currency,
            lines: lines.map((l) => ({
              originalProductDescription: `Item ${l.code}`,
              productId: l.productId,
              sapItemCodeSnapshot: l.code,
              requestedQuantity: l.qty,
              requestedUnitCode: "KG",
              customerUnitPrice: l.price ?? null,
            })),
          } as never,
          adminId,
          true
        ),
      TRANSACTION_OPTIONS
    );
    orderIds.push(created.id);
    return created;
  }

  /** A departed dispatch for the given order lines (what Record Delivery acts on). */
  async function departedDispatch(orderId: string, lines: { orderLineId: string; qty: string }[]) {
    const dispatch = await prisma.dispatchRecord.create({
      data: { orderId, createdById: adminId, isDemo: true, status: "DEPARTED", departedById: adminId, departedAt: new Date(), lines: { create: lines.map((l) => ({ orderLineId: l.orderLineId, dispatchedQuantity: l.qty })) } },
      select: { id: true, lines: { select: { id: true, orderLineId: true } } },
    });
    return dispatch;
  }

  async function deliver(dispatch: { id: string; lines: { id: string; orderLineId: string }[] }, outcomes: { orderLineId: string; accepted: string; rejected: string }[]) {
    const { recordDelivery } = await import("@/lib/fulfilment/delivery");
    return recordDelivery(
      dispatch.id,
      adminId,
      {
        lines: outcomes.map((o) => ({
          dispatchLineId: dispatch.lines.find((l) => l.orderLineId === o.orderLineId)!.id,
          acceptedQuantity: o.accepted,
          rejectedQuantity: o.rejected,
          ...(Number(o.rejected) > 0 ? { rejectionReason: REASON_LABEL } : {}),
        })),
      },
      {}
    );
  }

  beforeAll(async () => {
    ({ prisma } = await import("@/lib/prisma"));
    const admin = await prisma.user.create({ data: { name: `Admin ${run}`, email: `${run}@example.test`, passwordHash: "x", role: "ADMINISTRATOR" }, select: { id: true } });
    adminId = admin.id;

    const mkProduct = async (n: number) => {
      const code = `${run.toUpperCase()}-P${n}`;
      const p = await prisma.product.create({ data: { sapItemCode: code, itemName: `Product ${n} ${run}`, isDemo: true }, select: { id: true } });
      productIds.push(p.id);
      return { id: p.id, code };
    };
    p1 = await mkProduct(1);
    p2 = await mkProduct(2);
    p3 = await mkProduct(3); // never priced anywhere

    const usd = await prisma.priceList.create({ data: { code: `USD-${run}`, name: "Test USD", currencyCode: "USD", isDemo: true }, select: { id: true } });
    const zwg = await prisma.priceList.create({ data: { code: `ZWG-${run}`, name: "Test ZWG", currencyCode: "ZWG", isDemo: true }, select: { id: true } });
    usdListId = usd.id;
    listIds.push(usd.id, zwg.id);
    const validFrom = new Date("2026-01-01T00:00:00.000Z");
    await prisma.priceListEntry.createMany({
      data: [
        { priceListId: usd.id, productId: p1.id, sapItemCodeSnapshot: p1.code, unitPrice: "2.0000", validFrom, isDemo: true },
        { priceListId: usd.id, productId: p2.id, sapItemCodeSnapshot: p2.code, unitPrice: "4.0000", validFrom, isDemo: true },
        { priceListId: zwg.id, productId: p1.id, sapItemCodeSnapshot: p1.code, unitPrice: "700.0000", validFrom, isDemo: true },
      ],
    });

    const mkCustomer = async (name: string, priceListId: string | null, currencyCode: string | null) => {
      const c = await prisma.customer.create({ data: { name: `${name} ${run}`, priceListId, currencyCode, isDemo: true }, select: { id: true } });
      customerIds.push(c.id);
      return c.id;
    };
    customerA = await mkCustomer("Customer A", usd.id, "USD");
    customerB = await mkCustomer("Customer B", usd.id, "USD"); // SAME list as A
    customerC = await mkCustomer("Customer C", zwg.id, "ZWG");
    customerD = await mkCustomer("Customer D", null, "USD"); // no list at all
  });

  afterAll(async () => {
    if (!prisma) return;
    try {
      const dispatches = await prisma.dispatchRecord.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
      const dispatchIds = dispatches.map((d) => d.id);
      const claimWhere = { OR: [{ orderId: { in: orderIds } }, { customerId: { in: customerIds } }] };
      await prisma.invoiceClaimLine.deleteMany({ where: { claim: claimWhere } });
      await prisma.invoiceClaim.deleteMany({ where: claimWhere });
      await prisma.lostSaleRecord.deleteMany({ where: { unfulfilledDemand: { orderId: { in: orderIds } } } });
      await prisma.unfulfilledDemand.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.deliveryRecord.deleteMany({ where: { dispatchRecordId: { in: dispatchIds } } });
      await prisma.dispatchRecord.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.pickingSession.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderLine.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: orderIds } } });
      await prisma.customerProductPrice.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customerProductPriceHistory.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      await prisma.priceListEntry.deleteMany({ where: { priceListId: { in: listIds } } });
      await prisma.priceList.deleteMany({ where: { id: { in: listIds } } });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.auditEvent.deleteMany({ where: { actorId: adminId } });
      await prisma.user.deleteMany({ where: { id: adminId } });
    } catch (error) {
      console.warn("[test cleanup] incomplete:", error instanceof Error ? error.message : error);
    } finally {
      await prisma.$disconnect();
    }
  });

  // ------------------------------------------------------------------ 1
  it("1. FULL RETURN: all dispatched units rejected -> one claim line, full value in Confirmed Loss, resubmission adds nothing", async () => {
    const { getDeliveryReturnSummary, listDeliveryReturnRows } = await import("@/lib/lost-sales/delivery-returns");
    const { getReturnedGoodsLostSalesValue } = await import("@/lib/returns-credits/lost-sale-analytics");
    const before = await getReturnedGoodsLostSalesValue({ includeDemo: true });
    const usdBefore = Number(before.byCurrency.find((b) => b.currencyCode === "USD")?.estimatedValue ?? 0);

    const order = await makeOrder(customerA, [{ productId: p1.id, code: p1.code, qty: "10" }]); // price resolved from list: 2.00
    const dispatch = await departedDispatch(order.id, [{ orderLineId: order.lines[0].id, qty: "10" }]);
    const result = await deliver(dispatch, [{ orderLineId: order.lines[0].id, accepted: "0", rejected: "10" }]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.outcome).toBe("FULLY_REJECTED");
    expect(result.claim?.lineCount).toBe(1);

    const claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { deliveryRecordId: result.deliveryRecordId }, include: { lines: true } });
    expect(claim.sapInvoiceId).toBeNull(); // no SAP invoice involved
    expect(claim.status).toBe("OPEN");
    expect(claim.lines).toHaveLength(1);
    expect(claim.lines[0].orderLineId).toBe(order.lines[0].id);
    expect(claim.lines[0].reasonCategory).not.toBeNull(); // the label was mapped to the standard category

    const summary = await getDeliveryReturnSummary({ includeDemo: true, customerId: customerA });
    expect(summary.byCurrency).toEqual([expect.objectContaining({ currencyCode: "USD", recordCount: 1, value: "20" })]);
    const rows = await listDeliveryReturnRows({ includeDemo: true, customerId: customerA }, { take: 50 });
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ orderedQuantity: "10", deliveredQuantity: "0", returnedQuantity: "10", unitPrice: "2", totalValue: "20" });
    expect(rows.rows[0].claimId).toBe(claim.id);

    // The dashboard card source moved by exactly this value.
    const after = await getReturnedGoodsLostSalesValue({ includeDemo: true });
    expect(Number(after.byCurrency.find((b) => b.currencyCode === "USD")?.estimatedValue ?? 0) - usdBefore).toBeCloseTo(20, 4);

    // Resubmission: refused, and nothing is duplicated.
    const again = await deliver(dispatch, [{ orderLineId: order.lines[0].id, accepted: "0", rejected: "10" }]);
    expect(again.ok).toBe(false);
    expect(await prisma.invoiceClaim.count({ where: { orderId: order.id } })).toBe(1);
    expect((await getDeliveryReturnSummary({ includeDemo: true, customerId: customerA })).byCurrency[0].value).toBe("20");
  });

  // ------------------------------------------------------------------ 2
  it("2. PARTIAL RETURN: only the returned quantity counts; accepted-in-full and cancelled dispatches count nothing; concurrent resubmission yields one claim", async () => {
    const { getDeliveryReturnSummary } = await import("@/lib/lost-sales/delivery-returns");
    const { cancelDispatchRecord } = await import("@/lib/fulfilment/dispatch");
    const startValue = Number((await getDeliveryReturnSummary({ includeDemo: true, customerId: customerB })).byCurrency[0]?.value ?? 0);
    expect(startValue).toBe(0);

    // 10 ordered @4.00, 7 accepted, 3 returned -> loss is 3 x 4 = 12, not 40 and not 28.
    const order = await makeOrder(customerB, [{ productId: p2.id, code: p2.code, qty: "10" }]);
    const d1 = await departedDispatch(order.id, [{ orderLineId: order.lines[0].id, qty: "10" }]);
    const r1 = await deliver(d1, [{ orderLineId: order.lines[0].id, accepted: "7", rejected: "3" }]);
    expect(r1.ok && r1.outcome).toBe("PARTIALLY_REJECTED");
    expect((await getDeliveryReturnSummary({ includeDemo: true, customerId: customerB })).byCurrency[0]).toMatchObject({ value: "12", recordCount: 1 });

    // A second dispatch accepted in full: no claim, no row, value unchanged.
    const order2 = await makeOrder(customerB, [{ productId: p1.id, code: p1.code, qty: "5" }]);
    const d2 = await departedDispatch(order2.id, [{ orderLineId: order2.lines[0].id, qty: "5" }]);
    const r2 = await deliver(d2, [{ orderLineId: order2.lines[0].id, accepted: "5", rejected: "0" }]);
    expect(r2.ok && r2.claim).toBeNull();
    expect(await prisma.invoiceClaim.count({ where: { orderId: order2.id } })).toBe(0);

    // A cancelled dispatch never counts.
    const order3 = await makeOrder(customerB, [{ productId: p1.id, code: p1.code, qty: "5" }]);
    const d3 = await prisma.dispatchRecord.create({ data: { orderId: order3.id, createdById: adminId, isDemo: true, status: "PLANNED", lines: { create: [{ orderLineId: order3.lines[0].id, dispatchedQuantity: "5" }] } }, select: { id: true } });
    expect((await cancelDispatchRecord(d3.id, adminId, "test cancellation")).ok).toBe(true);
    expect((await getDeliveryReturnSummary({ includeDemo: true, customerId: customerB })).byCurrency[0]).toMatchObject({ value: "12", recordCount: 1 });

    // Two simultaneous submissions of the same outcome: exactly one wins, one claim exists.
    const order4 = await makeOrder(customerB, [{ productId: p2.id, code: p2.code, qty: "4" }]);
    const d4 = await departedDispatch(order4.id, [{ orderLineId: order4.lines[0].id, qty: "4" }]);
    const outcome = [{ orderLineId: order4.lines[0].id, accepted: "1", rejected: "3" }];
    const settled = await Promise.all([deliver(d4, outcome), deliver(d4, outcome)]);
    expect(settled.filter((r) => r.ok)).toHaveLength(1);
    expect(await prisma.invoiceClaim.count({ where: { orderId: order4.id } })).toBe(1);
    expect(await prisma.deliveryLine.count({ where: { deliveryRecord: { dispatchRecordId: d4.id } } })).toBe(1);

    // Total = 12 + 3 x 4 = 24, each unit counted once.
    expect((await getDeliveryReturnSummary({ includeDemo: true, customerId: customerB })).byCurrency[0]).toMatchObject({ value: "24", recordCount: 2 });

    // Re-running the claim builder for an existing delivery is a no-op.
    const { createClaimFromDelivery } = await import("@/lib/invoice-claims/create-delivery-claim");
    const delivery = await prisma.deliveryRecord.findUniqueOrThrow({ where: { dispatchRecordId: d1.id }, select: { id: true } });
    const replay = await prisma.$transaction((tx) => createClaimFromDelivery(tx, { deliveryRecordId: delivery.id, actorId: adminId }));
    expect(replay).toMatchObject({ created: false, reason: "ALREADY_EXISTS" });
  });

  // ------------------------------------------------------------------ 3
  it("3. UNFULFILLED DEMAND stays a separate category; overall view adds the two without double counting", async () => {
    const { getAutomaticLostSalesValue } = await import("@/lib/lost-sales/queries");
    const { getReturnedGoodsLostSalesValue } = await import("@/lib/returns-credits/lost-sale-analytics");
    const { combineLostSales } = await import("@/lib/lost-sales/overall");
    const { getDeliveryReturnSummary } = await import("@/lib/lost-sales/delivery-returns");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

    const demandBefore = await getAutomaticLostSalesValue({ includeDemo: true });
    const returnedBefore = await getReturnedGoodsLostSalesValue({ includeDemo: true });
    const returnedRowsBefore = (await getDeliveryReturnSummary({ includeDemo: true, customerId: customerD })).recordCount;

    // Customer D has no list: give the line its own price. 20 ordered @2.50, only 12 found -> 8 never supplied.
    const order = await makeOrder(customerD, [{ productId: p1.id, code: p1.code, qty: "20", price: "2.5000" }]);
    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    await recordPickedLine(started.session.id, order.lines[0].id, "12.0000", "8.0000", undefined, adminId);
    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    const demandAfter = await getAutomaticLostSalesValue({ includeDemo: true });
    expect(Number(demandAfter.estimatedValue) - Number(demandBefore.estimatedValue)).toBeCloseTo(20, 4); // 8 x 2.50

    // It is NOT returned goods: nothing moved there, no returned row exists for this order.
    const returnedAfter = await getReturnedGoodsLostSalesValue({ includeDemo: true });
    expect(returnedAfter.byCurrency).toEqual(returnedBefore.byCurrency);
    expect((await getDeliveryReturnSummary({ includeDemo: true, customerId: customerD })).recordCount).toBe(returnedRowsBefore);

    // Combined view: USD total = returned USD + unfulfilled, each counted once.
    const usdReturned = returnedAfter.byCurrency.find((b) => b.currencyCode === "USD")?.estimatedValue ?? "0";
    const [usd] = combineLostSales([{ currencyCode: "USD", value: usdReturned }], demandAfter.estimatedValue);
    expect(Number(usd.total)).toBeCloseTo(Number(usdReturned) + Number(demandAfter.estimatedValue), 4);
    expect(Number(usd.returnedGoods)).toBeCloseTo(Number(usdReturned), 4);
    expect(Number(usd.unfulfilledDemand)).toBeCloseTo(Number(demandAfter.estimatedValue), 4);
  });

  // ------------------------------------------------------------------ 4
  it("4. CUSTOMER PRICE ISOLATION: changing one customer never changes another or the shared list", async () => {
    const { setCustomerPrice, removeCustomerPrice, listCustomerPriceHistory } = await import("@/lib/pricing/customer-prices");
    const { resolveCustomerPriceListPrices } = await import("@/lib/order-price-resolution");
    const price = async (customerId: string, productId = p1.id) => {
      const r = await resolveCustomerPriceListPrices(prisma, customerId, [productId]);
      return { price: r.priceByProductId.get(productId) ?? null, source: r.sourceByProductId.get(productId) ?? null, currency: r.currencyCode };
    };
    const listEntriesBefore = await prisma.priceListEntry.findMany({ where: { priceListId: usdListId }, orderBy: { sapItemCodeSnapshot: "asc" }, select: { id: true, unitPrice: true } });

    expect(await price(customerA)).toMatchObject({ price: "2", source: "PRICE_LIST", currency: "USD" });
    expect(await price(customerB)).toMatchObject({ price: "2", source: "PRICE_LIST" });
    expect(await price(customerC)).toMatchObject({ price: "700", source: "PRICE_LIST", currency: "ZWG" });

    const set = await setCustomerPrice({ customerId: customerA, productId: p1.id, unitPrice: "1.50" }, adminId);
    expect(set).toMatchObject({ ok: true, changed: true, changeType: "CREATED", unitPrice: "1.5000" });
    expect(await price(customerA)).toMatchObject({ price: "1.5", source: "CUSTOMER_OVERRIDE" });
    // B (same list), C (other list/currency) and the shared list are untouched.
    expect(await price(customerB)).toMatchObject({ price: "2", source: "PRICE_LIST" });
    expect(await price(customerC)).toMatchObject({ price: "700", source: "PRICE_LIST" });
    expect(await prisma.priceListEntry.findMany({ where: { priceListId: usdListId }, orderBy: { sapItemCodeSnapshot: "asc" }, select: { id: true, unitPrice: true } })).toEqual(listEntriesBefore);

    // Editing B independently leaves A alone.
    await setCustomerPrice({ customerId: customerB, productId: p1.id, unitPrice: "1.75" }, adminId);
    expect((await price(customerA)).price).toBe("1.5");
    expect((await price(customerB)).price).toBe("1.75");

    // Idempotent: the same value again writes no history.
    const historyBefore = (await listCustomerPriceHistory(customerA, p1.id)).length;
    expect(await setCustomerPrice({ customerId: customerA, productId: p1.id, unitPrice: "1.5" }, adminId)).toMatchObject({ ok: true, changed: false, changeType: "UNCHANGED" });
    expect((await listCustomerPriceHistory(customerA, p1.id)).length).toBe(historyBefore);

    // Currency isolation: a ZWG price for a USD customer (and vice versa) is refused, not converted.
    expect(await setCustomerPrice({ customerId: customerA, productId: p2.id, unitPrice: "5", currencyCode: "ZWG" }, adminId)).toMatchObject({ ok: false, status: 409 });
    expect(await setCustomerPrice({ customerId: customerC, productId: p2.id, unitPrice: "5", currencyCode: "USD" }, adminId)).toMatchObject({ ok: false, status: 409 });
    expect(await setCustomerPrice({ customerId: customerA, productId: p2.id, unitPrice: "0" }, adminId)).toMatchObject({ ok: false, status: 400 });
    expect(await prisma.customerProductPrice.count({ where: { customerId: { in: [customerA, customerC] }, productId: p2.id } })).toBe(0);

    // Update then remove: A falls back to the list; history is append-only and complete.
    await setCustomerPrice({ customerId: customerA, productId: p1.id, unitPrice: "1.25" }, adminId);
    expect(await removeCustomerPrice(customerA, p1.id, adminId, "test")).toEqual({ ok: true, removed: true });
    expect(await removeCustomerPrice(customerA, p1.id, adminId)).toEqual({ ok: true, removed: false }); // idempotent
    expect(await price(customerA)).toMatchObject({ price: "2", source: "PRICE_LIST" });
    const history = await listCustomerPriceHistory(customerA, p1.id);
    expect(history.map((h) => h.changeType).reverse()).toEqual(["CREATED", "UPDATED", "REMOVED"]);
    expect(await prisma.auditEvent.count({ where: { entityType: "Customer", entityId: customerA, action: { startsWith: "CUSTOMER_PRICE_" } } })).toBeGreaterThanOrEqual(3);

    // Bulk is all-or-nothing.
    const bulkBad = await (await import("@/lib/pricing/customer-prices")).bulkSetCustomerPrices(customerA, [{ productId: p1.id, unitPrice: "3" }, { productId: p2.id, unitPrice: "-1" }], adminId, "bulk");
    expect(bulkBad.ok).toBe(false);
    expect(await prisma.customerProductPrice.count({ where: { customerId: customerA } })).toBe(0);
    const bulkOk = await (await import("@/lib/pricing/customer-prices")).bulkSetCustomerPrices(customerA, [{ productId: p1.id, unitPrice: "3" }, { productId: p2.id, unitPrice: "3.5" }], adminId, "bulk");
    expect(bulkOk.ok).toBe(true);
    expect(await prisma.customerProductPrice.count({ where: { customerId: customerA } })).toBe(2);
    await prisma.customerProductPrice.deleteMany({ where: { customerId: customerA } });
  });

  // ------------------------------------------------------------------ 5
  it("5. AUTOMATIC PRICING: override -> list -> no price; no silent total; currency never mixed", async () => {
    const { setCustomerPrice } = await import("@/lib/pricing/customer-prices");
    const { summariseOrderTotal, pricingFromLines } = await import("@/lib/order-totals");
    const lineOf = async (orderId: string, productId: string) => (await prisma.orderLine.findFirstOrThrow({ where: { orderId, productId }, select: { customerUnitPrice: true } })).customerUnitPrice?.toString() ?? null;

    await setCustomerPrice({ customerId: customerA, productId: p1.id, unitPrice: "1.20" }, adminId);
    const o = await makeOrder(customerA, [
      { productId: p1.id, code: p1.code, qty: "10" }, // override
      { productId: p2.id, code: p2.code, qty: "10" }, // list
      { productId: p3.id, code: p3.code, qty: "10" }, // nothing anywhere
    ]);
    expect(await lineOf(o.id, p1.id)).toBe("1.2");
    expect(await lineOf(o.id, p2.id)).toBe("4");
    expect(await lineOf(o.id, p3.id)).toBeNull();

    const stored = await prisma.orderLine.findMany({ where: { orderId: o.id }, select: { requestedQuantity: true, customerUnitPrice: true, approvedUnitPrice: true, product: { select: { vatCode: true } } } });
    const total = summariseOrderTotal({ storedTotal: null, currency: "USD", pricing: pricingFromLines(stored, new Map()) });
    expect(total.basis).toBe("PARTIAL");
    expect(Number(total.amount)).toBe(52); // 10x1.2 + 10x4, the unpriced line contributes nothing and is not "free"
    expect(total.warning).toMatch(/no price/i);

    // A customer with no price list and no override gets no price (no silent default).
    const d = await makeOrder(customerD, [{ productId: p1.id, code: p1.code, qty: "3" }]);
    expect(await lineOf(d.id, p1.id)).toBeNull();

    // Currency isolation: a ZWG customer never receives the USD list price, and an explicit USD order for them is not priced from the ZWG list.
    const c = await makeOrder(customerC, [{ productId: p1.id, code: p1.code, qty: "1" }]);
    expect(await lineOf(c.id, p1.id)).toBe("700");
    expect((await prisma.customerOrder.findUniqueOrThrow({ where: { id: c.id }, select: { currency: true } })).currency).toBe("ZWG");
    const cUsd = await makeOrder(customerC, [{ productId: p1.id, code: p1.code, qty: "1" }], "USD");
    expect(await lineOf(cUsd.id, p1.id)).toBeNull();

    // A customer-supplied price is never overridden.
    const explicit = await makeOrder(customerA, [{ productId: p1.id, code: p1.code, qty: "1", price: "9.99" }]);
    expect(await lineOf(explicit.id, p1.id)).toBe("9.99");
    await prisma.customerProductPrice.deleteMany({ where: { customerId: customerA } });
  });

  // ------------------------------------------------------------------ 6
  it("6. ORDER TOTAL CONSISTENCY: admin and operational views show the same amount and currency; unpriced orders warn instead of showing zero", async () => {
    const { listAdminOrders } = await import("@/lib/admin/order-admin");
    const { listOrders } = await import("@/lib/order-queries");

    const priced = await makeOrder(customerB, [{ productId: p2.id, code: p2.code, qty: "6" }]); // 6 x 4 = 24 (no tax code configured -> partial)
    const unpriced = await makeOrder(customerD, [{ productId: p3.id, code: p3.code, qty: "2" }]);
    const zwg = await makeOrder(customerC, [{ productId: p1.id, code: p1.code, qty: "2" }]); // 2 x 700 = 1400 ZWG

    const admin = await listAdminOrders({ q: run }, 1, 100);
    const adminById = new Map(admin.rows.map((r) => [r.id, r]));
    const operational = await listOrders({ page: 1, pageSize: 100, includeDemo: true, search: run } as never);
    const opById = new Map(operational.orders.map((o) => [o.id, o]));

    for (const order of [priced, zwg]) {
      const a = adminById.get(order.id)!;
      const op = opById.get(order.id)!;
      const opAmount = op.total ?? op.estimatedTotal;
      expect(a.orderTotal.amount, `admin amount for ${order.id}`).not.toBeNull();
      expect(Number(a.orderTotal.amount)).toBeCloseTo(Number(opAmount), 4);
      expect(a.orderTotal.currency).toBe(op.currency);
    }
    expect(adminById.get(zwg.id)!.orderTotal.currency).toBe("ZWG");
    expect(Number(adminById.get(priced.id)!.orderTotal.amount)).toBe(24);

    const u = adminById.get(unpriced.id)!;
    expect(u.orderTotal.amount).toBeNull(); // never 0
    expect(u.orderTotal.basis).toBe("UNAVAILABLE");
    expect(u.orderTotal.warning).toBeTruthy();
    expect(opById.get(unpriced.id)!.estimatedTotal).toBeNull();
  });

  // ------------------------------------------------------------------ 7
  it("7. HISTORICAL PRICE PROTECTION: later customer-price, list-price and validity changes never alter an existing order", async () => {
    const { setCustomerPrice } = await import("@/lib/pricing/customer-prices");
    const { listAdminOrders } = await import("@/lib/admin/order-admin");
    const { getOrderById } = await import("@/lib/order-queries");

    await setCustomerPrice({ customerId: customerA, productId: p1.id, unitPrice: "1.50" }, adminId);
    const order = await makeOrder(customerA, [{ productId: p1.id, code: p1.code, qty: "10" }]);
    const snapshot = async () => {
      const line = await prisma.orderLine.findFirstOrThrow({ where: { orderId: order.id }, select: { customerUnitPrice: true } });
      const admin = (await listAdminOrders({ q: order.id.slice(0, 0) + run }, 1, 100)).rows.find((r) => r.id === order.id)!;
      const detail = await getOrderById(order.id);
      return { price: line.customerUnitPrice?.toString(), adminTotal: admin.orderTotal.amount, detailLineTotal: detail?.lines[0].unitPrice };
    };
    const before = await snapshot();
    expect(before.price).toBe("1.5");

    await setCustomerPrice({ customerId: customerA, productId: p1.id, unitPrice: "9.00" }, adminId); // override edited
    await prisma.priceListEntry.updateMany({ where: { priceListId: usdListId, productId: p1.id }, data: { unitPrice: "3.0000" } }); // list repriced
    await prisma.priceListEntry.updateMany({ where: { priceListId: usdListId, productId: p1.id }, data: { validTo: new Date("2026-01-02T00:00:00.000Z") } }); // list entry expired
    await prisma.customerProductPrice.deleteMany({ where: { customerId: customerA } }); // override removed

    expect(await snapshot()).toEqual(before);

    // New orders see the new reality (no price now), proving the old one was protected rather than frozen globally.
    const fresh = await makeOrder(customerA, [{ productId: p1.id, code: p1.code, qty: "1" }]);
    expect((await prisma.orderLine.findFirstOrThrow({ where: { orderId: fresh.id }, select: { customerUnitPrice: true } })).customerUnitPrice).toBeNull();
    await prisma.priceListEntry.updateMany({ where: { priceListId: usdListId, productId: p1.id }, data: { unitPrice: "2.0000", validTo: null } });
  });

  // ------------------------------------------------------------------ 8
  it("8. STANDALONE: the whole flow ran with no SAP configuration, no SAP invoice and no SAP rows", async () => {
    for (const key of Object.keys(process.env).filter((k) => /^SAP_/.test(k))) expect(process.env[key], key).toBeFalsy();
    const claims = await prisma.invoiceClaim.findMany({ where: { orderId: { in: orderIds } }, select: { sapInvoiceId: true, deliveryRecordId: true } });
    expect(claims.length).toBeGreaterThan(0);
    expect(claims.every((c) => c.sapInvoiceId === null && c.deliveryRecordId !== null)).toBe(true);
    expect(await prisma.sapInvoice.count({ where: { matchedOrderId: { in: orderIds } } })).toBe(0);
    expect(await prisma.integrationOperation.count({ where: { customerOrderId: { in: orderIds } } })).toBe(0);
  });
});
