import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Follow-up fix ("Returned-claim lost sales must... Show returned-claim
 * losses in the same Lost Sales Analytics page, KPIs, charts and reports
 * as shortage-based lost sales... Prevent duplicate counting... without
 * mixing currencies or units of measure"). DB-backed acceptance tests
 * for lib/lost-sales/consolidated-analytics.ts's
 * getConsolidatedLostSalesAnalytics -- the new combined-source layer
 * this round adds alongside (not instead of)
 * lib/lost-sales/analytics-queries.ts's existing shortage-only
 * getLostSalesAnalytics.
 *
 * OFF BY DEFAULT, for the exact same reason as every other
 * *-db.integration test in this project -- see
 * tests/lost-sales-db.integration.test.ts's own module comment.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user must exist;
 * this file creates its OWN dedicated Customer/Product fixtures, so it
 * has no dependency on any shared DEMO-CUST-* seed data and no cross-test
 * pollution risk).
 *
 * Fixture shape: ONE shortage-side confirmed loss (via the real
 * picking -> authorize pipeline, exactly
 * tests/lost-sales-analytics-db.integration.test.ts's own
 * createOrderWithKnownShortage pattern, with OrderLine.approvedUnitPrice
 * set directly for a deterministic price) and ONE returned-product-side
 * confirmed loss (via the real createInvoiceClaim -> recordClaimResolution
 * -> approveClaimResolution -> recordClaimReturn lifecycle, exactly
 * tests/returns-credits-db.integration.test.ts's own pattern), both
 * against the SAME dedicated customer and product, both in USD, so this
 * file can assert the combined figures exactly rather than by delta.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Follow-up fix: consolidated lost-sales analytics (shortage + returned product)", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let productId: string;
  const uniqueSuffix = `consolidated-inttest-${Date.now()}`;

  const createdOrderIds: string[] = [];
  const createdImportBatchIds: string[] = [];
  const createdSapInvoiceIds: string[] = [];
  const createdClaimIds: string[] = [];
  const createdClaimReturnIds: string[] = [];
  let createdCustomerId: string | null = null;
  let createdProductId: string | null = null;

  // Shortage-side fixture figures, filled in by beforeAll.
  let shortageOrderId: string;
  let shortageDemandId: string;
  const shortageRequestedQuantity = "10.0000";
  const shortageUnavailableQuantity = "4.0000";
  const shortageFoundQuantity = "6.0000";
  const shortageUnitPrice = "7.5000"; // OrderLine.approvedUnitPrice -- deterministic, never relies on an ambient price list

  // Returned-product-side fixture figures, filled in by beforeAll.
  let returnedOrderId: string;
  let returnedClaimId: string;
  let returnedClaimReturnId: string;
  let returnedSapInvoiceId: string;
  const returnedQuantity = "3.0000";
  const returnedUnitPrice = "12.0000"; // SapInvoiceLine.unitPrice -- the REAL invoiced price this round's existing rule resolves from, never an invented one

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    if (!admin) {
      console.log(
        "Skipping consolidated lost-sales analytics DB integration test: need an admin user. " +
          "Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }
    adminId = admin.id;

    const customer = await prisma.customer.create({
      data: { name: `Consolidated test customer ${uniqueSuffix}`, sapCustomerCode: `CONSOL-${uniqueSuffix}`, isDemo: true },
      select: { id: true },
    });
    customerId = customer.id;
    createdCustomerId = customer.id;

    const product = await prisma.product.create({
      data: { sapItemCode: `CONSOL-ITEM-${uniqueSuffix}`, itemName: `Consolidated test item ${uniqueSuffix}`, unitOfMeasure: "EA", isDemo: true },
      select: { id: true },
    });
    productId = product.id;
    createdProductId = product.id;

    // --- Shortage-side fixture: real picking -> authorize pipeline ------
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

    const shortageOrder = await prisma.customerOrder.create({
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
              originalProductDescription: `Consolidated shortage item ${uniqueSuffix}`,
              requestedQuantity: shortageRequestedQuantity,
              requestedUnitCode: "EA",
              productId,
              approvedUnitPrice: shortageUnitPrice,
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    shortageOrderId = shortageOrder.id;
    createdOrderIds.push(shortageOrder.id);
    const shortageLineId = shortageOrder.lines[0]!.id;

    const started = await startPickingSession(shortageOrder.id, adminId);
    if (!started.ok) throw new Error(started.message);
    await recordPickedLine(started.session.id, shortageLineId, shortageFoundQuantity, shortageUnavailableQuantity, "Short on stock", adminId);
    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    const demand = await prisma.unfulfilledDemand.findFirstOrThrow({ where: { orderId: shortageOrder.id }, select: { id: true } });
    shortageDemandId = demand.id;

    // --- Returned-product-side fixture: real claim -> return lifecycle --
    // A SEPARATE order, never picked -- exists purely to give the SAP
    // invoice line a real matchedOrderLine (so this module can resolve a
    // real productId for the returned side, same as Milestone 5
    // matching would) and a real order for the claim's own orderId
    // drill-down.
    const returnedOrder = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "INVOICED",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [
            {
              lineNumber: 1,
              originalProductDescription: `Consolidated returned item ${uniqueSuffix}`,
              requestedQuantity: "20.0000",
              requestedUnitCode: "EA",
              productId,
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    returnedOrderId = returnedOrder.id;
    createdOrderIds.push(returnedOrder.id);
    const returnedOrderLineId = returnedOrder.lines[0]!.id;

    const batch = await prisma.sapInvoiceImportBatch.create({
      data: {
        originalFileName: "consolidated-test.csv",
        uploadedById: adminId,
        columnMapping: {},
        totalRows: 1,
        importedInvoiceCount: 1,
        importedLineCount: 1,
        duplicateRowCount: 0,
        invalidRowCount: 0,
        isDemo: true,
      },
      select: { id: true },
    });
    createdImportBatchIds.push(batch.id);

    const invoice = await prisma.sapInvoice.create({
      data: {
        importBatchId: batch.id,
        sapDocEntry: `${uniqueSuffix}-1`,
        sapDocNum: `INV-${uniqueSuffix}-1`,
        customerSapCode: `CONSOL-${uniqueSuffix}`,
        customerName: `Consolidated test customer ${uniqueSuffix}`,
        matchedCustomerId: customerId,
        invoiceDate: new Date(),
        currencyCode: "USD",
        total: (20 * Number(returnedUnitPrice)).toFixed(4),
        rawSourceData: {},
        isDemo: true,
        lines: {
          create: [
            {
              lineNumber: 1,
              sapItemCode: `CONSOL-ITEM-${uniqueSuffix}`,
              sapItemDescription: `Consolidated returned item ${uniqueSuffix}`,
              quantityInvoiced: "20.0000",
              unitOfMeasure: "EA",
              unitPrice: returnedUnitPrice,
              lineTotal: (20 * Number(returnedUnitPrice)).toFixed(4),
              rawSourceData: {},
              matchedOrderId: returnedOrder.id,
              matchedOrderLineId: returnedOrderLineId,
              matchStatus: "AUTO_MATCHED",
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    returnedSapInvoiceId = invoice.id;
    createdSapInvoiceIds.push(invoice.id);
    const returnedInvoiceLineId = invoice.lines[0]!.id;

    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { recordClaimResolution, approveClaimResolution } = await import("@/lib/invoice-claims/claim-resolution");
    const { recordClaimReturn } = await import("@/lib/returns-credits/returns");

    const created = await createInvoiceClaim(
      {
        sapInvoiceId: invoice.id,
        orderId: returnedOrder.id,
        customerId,
        category: "QUALITY_ISSUE",
        description: `Consolidated test claim ${uniqueSuffix}`,
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ sapInvoiceLineId: returnedInvoiceLineId, disputeType: "AMOUNT_ONLY", disputedAmount: "1.0000", reason: "Consolidated test" }],
      } as never,
      adminId
    );
    if (!created.ok) throw new Error("setup failed: createInvoiceClaim");
    returnedClaimId = created.id;
    createdClaimIds.push(created.id);

    const resolution = await recordClaimResolution(created.id, { decision: "PHYSICAL_RETURN_REQUIRED", findings: "Consolidated test findings" } as never, adminId);
    if (!resolution.ok) throw new Error("setup failed: recordClaimResolution");
    const approved = await approveClaimResolution(created.id, resolution.id, undefined, adminId);
    if (!approved.ok) throw new Error("setup failed: approveClaimResolution");

    const claimLine = await prisma.invoiceClaimLine.findFirstOrThrow({ where: { claimId: created.id }, select: { id: true } });

    const returnResult = await recordClaimReturn(
      created.id,
      { claimLineId: claimLine.id, receivedQuantity: returnedQuantity, condition: "DAMAGED", receivedDate: new Date().toISOString().slice(0, 10) } as never,
      adminId
    );
    if (!returnResult.ok) throw new Error("setup failed: recordClaimReturn");
    returnedClaimReturnId = returnResult.id;
    createdClaimReturnIds.push(returnedClaimReturnId);
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.lostSaleRecord.deleteMany({ where: { unfulfilledDemand: { orderId: { in: createdOrderIds } } } });
      await prisma.unfulfilledDemand.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.pickingSession.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });

      await prisma.claimReturnLostSale.deleteMany({ where: { claimReturnId: { in: createdClaimReturnIds } } });
      await prisma.claimReturn.deleteMany({ where: { id: { in: createdClaimReturnIds } } });
      await prisma.invoiceClaimAttachment.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.claimResolution.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaimLine.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaim.deleteMany({ where: { id: { in: createdClaimIds } } });

      // SapInvoiceLine.matchedOrderLineId is onDelete: Restrict, so the
      // invoice line must go before the order/orderLine it was matched to.
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoiceId: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoice.deleteMany({ where: { id: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { id: { in: createdImportBatchIds } } });

      await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: createdOrderIds } } });

      if (createdProductId) await prisma.product.deleteMany({ where: { id: createdProductId } });
      if (createdCustomerId) await prisma.customer.deleteMany({ where: { id: createdCustomerId } });
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
    lostSaleSource: null,
    includeDemo: true,
    productCategory: null,
    productSearch: null,
    sapItemCode: null,
    decisionCategory: null,
    priority: null,
    recommendationStatus: null,
    ...overrides,
  });

  it("combines both sources into one KPI set, by-currency value, by-source breakdown, and by-product/customer breakdown -- with no overlap between them", async () => {
    if (skipAll) return;
    const { getConsolidatedLostSalesAnalytics } = await import("@/lib/lost-sales/consolidated-analytics");

    const result = await getConsolidatedLostSalesAnalytics(baseFilters({ customerId }) as never, { page: 1, pageSize: 50 });

    expect(result.sampleSize).toBe(2);
    expect(result.truncated).toBe(false);

    // --- Quantities: exactly the two sources, never blended into one
    // indistinguishable figure, and exactly summing to the combined total
    // (the "prevent duplicate counting" requirement -- disjoint sets, so
    // this sum can never silently count either event twice).
    expect(result.kpis.shortageConfirmedLostQuantity).toBe(shortageUnavailableQuantity);
    expect(result.kpis.returnedConfirmedLostQuantity).toBe(returnedQuantity);
    expect(Number(result.kpis.totalConfirmedLostQuantity)).toBeCloseTo(Number(shortageUnavailableQuantity) + Number(returnedQuantity), 4);
    expect(result.kpis.recordsWithoutValue).toBe(0);
    expect(result.kpis.quantityUnitCode).toBe("EA");
    expect(result.kpis.mixedUnitsOfMeasure).toBe(false);
    expect(result.kpis.affectedOrderCount).toBe(2);
    expect(result.kpis.affectedCustomerCount).toBe(1);

    // --- Value by currency: never summed across currencies -- both
    // fixtures are USD, so there is exactly one bucket, and it carries
    // the per-source split as well as the combined figure.
    expect(result.valueByCurrency).toHaveLength(1);
    const usdBucket = result.valueByCurrency[0]!;
    expect(usdBucket.currencyCode).toBe("USD");
    const expectedShortageValue = Number(shortageUnavailableQuantity) * Number(shortageUnitPrice);
    const expectedReturnedValue = Number(returnedQuantity) * Number(returnedUnitPrice);
    expect(Number(usdBucket.shortageValue)).toBeCloseTo(expectedShortageValue, 4);
    expect(Number(usdBucket.returnedValue)).toBeCloseTo(expectedReturnedValue, 4);
    expect(Number(usdBucket.totalValue)).toBeCloseTo(expectedShortageValue + expectedReturnedValue, 4);

    // --- By source: exactly one record each, never merged.
    const shortageSource = result.bySource.find((s) => s.source === "SHORTAGE")!;
    const returnedSource = result.bySource.find((s) => s.source === "RETURNED_PRODUCT")!;
    expect(shortageSource.recordCount).toBe(1);
    expect(returnedSource.recordCount).toBe(1);
    expect(shortageSource.quantity).toBe(shortageUnavailableQuantity);
    expect(returnedSource.quantity).toBe(returnedQuantity);

    // --- By product: both fixtures share the SAME product, so they
    // combine into exactly one breakdown row, with the source split
    // preserved inside it.
    const productRow = result.byProduct.find((p) => p.productId === productId);
    expect(productRow).toBeDefined();
    expect(productRow!.shortageQuantity).toBe(shortageUnavailableQuantity);
    expect(productRow!.returnedQuantity).toBe(returnedQuantity);
    expect(Number(productRow!.quantity)).toBeCloseTo(Number(shortageUnavailableQuantity) + Number(returnedQuantity), 4);
    expect(productRow!.unitOfMeasure).toBe("EA");
    expect(productRow!.mixedUnitsOfMeasure).toBe(false);
    expect(productRow!.affectedOrderCount).toBe(2);

    // --- By customer: one row, both sources combined.
    expect(result.byCustomer).toHaveLength(1);
    const customerRow = result.byCustomer[0]!;
    expect(customerRow.customerId).toBe(customerId);
    expect(customerRow.shortageQuantity).toBe(shortageUnavailableQuantity);
    expect(customerRow.returnedQuantity).toBe(returnedQuantity);
  });

  it("drilldown rows carry drill-down ids to the original order/invoice/claim/return (shortage) and order/invoice/claim/return (returned product)", async () => {
    if (skipAll) return;
    const { getConsolidatedLostSalesAnalytics } = await import("@/lib/lost-sales/consolidated-analytics");

    const result = await getConsolidatedLostSalesAnalytics(baseFilters({ customerId }) as never, { page: 1, pageSize: 50 });
    expect(result.drilldown.rows).toHaveLength(2);

    const shortageRow = result.drilldown.rows.find((r) => r.source === "SHORTAGE")!;
    expect(shortageRow.orderId).toBe(shortageOrderId);
    expect(shortageRow.unfulfilledDemandId).toBe(shortageDemandId);
    expect(shortageRow.unitPrice).toBe(shortageUnitPrice);
    expect(shortageRow.currencyCode).toBe("USD");

    const returnedRow = result.drilldown.rows.find((r) => r.source === "RETURNED_PRODUCT")!;
    expect(returnedRow.orderId).toBe(returnedOrderId);
    expect(returnedRow.claimId).toBe(returnedClaimId);
    expect(returnedRow.sapInvoiceId).toBe(returnedSapInvoiceId);
    expect(returnedRow.condition).toBe("DAMAGED");
    expect(returnedRow.productId).toBe(productId); // resolved via the matched order line, not invented
    expect(returnedRow.unitPrice).toBe(returnedUnitPrice);
    expect(returnedRow.currencyCode).toBe("USD");

    // The drilldown's own returnReference is the real ClaimReturn row
    // this fixture created, not a re-derived or guessed reference.
    const { prisma } = await import("@/lib/prisma");
    const claimReturn = await prisma.claimReturn.findUniqueOrThrow({ where: { id: returnedClaimReturnId }, select: { returnReference: true } });
    expect(returnedRow.returnReference).toBe(claimReturn.returnReference);
  });

  it("the lostSaleSource filter excludes the OTHER source entirely -- never just hides it after the fact", async () => {
    if (skipAll) return;
    const { getConsolidatedLostSalesAnalytics } = await import("@/lib/lost-sales/consolidated-analytics");

    const shortageOnly = await getConsolidatedLostSalesAnalytics(baseFilters({ customerId, lostSaleSource: "SHORTAGE" }) as never, { page: 1, pageSize: 50 });
    expect(shortageOnly.sampleSize).toBe(1);
    expect(shortageOnly.drilldown.rows).toHaveLength(1);
    expect(shortageOnly.drilldown.rows[0]!.source).toBe("SHORTAGE");
    expect(shortageOnly.kpis.returnedConfirmedLostQuantity).toBe("0");

    const returnedOnly = await getConsolidatedLostSalesAnalytics(baseFilters({ customerId, lostSaleSource: "RETURNED_PRODUCT" }) as never, { page: 1, pageSize: 50 });
    expect(returnedOnly.sampleSize).toBe(1);
    expect(returnedOnly.drilldown.rows).toHaveLength(1);
    expect(returnedOnly.drilldown.rows[0]!.source).toBe("RETURNED_PRODUCT");
    expect(returnedOnly.kpis.shortageConfirmedLostQuantity).toBe("0");
  });

  it("the productId filter resolves the returned-product side via the matched order line, consistent with the shortage side", async () => {
    if (skipAll) return;
    const { getConsolidatedLostSalesAnalytics } = await import("@/lib/lost-sales/consolidated-analytics");

    const result = await getConsolidatedLostSalesAnalytics(baseFilters({ customerId, productId }) as never, { page: 1, pageSize: 50 });
    expect(result.sampleSize).toBe(2);
  });
});
