import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 14 (Product Intelligence). DB-backed acceptance tests for
 * lib/reporting/product-revenue-queries.ts, product-demand-queries.ts,
 * product-commercial-health-queries.ts, product-fulfilment-queries.ts,
 * product-insights-queries.ts and lib/product-queries.ts's getProductById,
 * against a REAL database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as every other
 * *-db.integration test in this project (@prisma/client-stub sandbox
 * limitation). Every lib touched here is imported with a dynamic
 * `await import(...)` inside the (skippable) test bodies below.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and
 * DEMO-CUST-001/DEMO-CUST-002 customers must exist).
 *
 * Coverage and scope, stated honestly rather than implied, following the
 * exact same "don't re-derive already-proven coverage" principle
 * tests/customer-intelligence-db.integration.test.ts's own comment
 * states for M13:
 *   - Items 1-4 (value by currency, quantity by unit, invoice frequency,
 *     distinct customers), at the sapItemCode-keyed grouping, through
 *     both the Product 360 single-product read and the management
 *     overview's ranked assembly -- including a product with NO matching
 *     Product master row (never hidden).
 *   - Item 5 (lost sales), through the REAL picking -> authorize ->
 *     decide -> confirm-lost-sale lifecycle, specifically to prove the
 *     NEW sapItemCode-keyed grouping and productId resolution -- the
 *     underlying LostSaleRecord -> UnfulfilledDemand join shape itself is
 *     already proven by M12's sales-performance-db integration test and
 *     M13's own customer-insights-queries equivalent, so this section
 *     does not re-derive that join a third time.
 *   - Item 6 (claims/returns): single-product attribution AND the
 *     multi-product exclusion (one claim with lines spanning two
 *     distinct SAP item codes), via the real 6A lifecycle.
 *   - Item 7 (credit notes): a claim-linked note on a single-product
 *     claim counted correctly, AND a credit note on a multi-product
 *     claim excluded and counted in unattributableCreditNoteCount instead
 *     -- never silently absorbed into either product's total.
 *   - Item 8 (delivery rejections): THE GENUINELY NEW RISK THIS MILESTONE
 *     INTRODUCED -- this exercises the DispatchLine.createdAt-based
 *     period/demo filter fix (DispatchRecord has no dispatchedAt column;
 *     see lib/reporting/product-fulfilment-queries.ts's own comment),
 *     through the real create-dispatch -> depart -> record-delivery
 *     lifecycle, to prove the corrected query actually finds the
 *     rejection rather than silently excluding it.
 *   - Item 9 (declining activity): a product whose current-period value
 *     is strictly lower than its previous-period value in one currency,
 *     ranked independently per currency.
 *   - Item 10 (master data quality): an UNMATCHED sapItemCode (real
 *     invoice activity, no Product row at all) and a MATCHED product
 *     with no recorded category -- both surfaced, never hidden.
 *   - getProductById / getProductProfile: the Product 360 composite
 *     assembly returns a profile for a real product id, and null for a
 *     nonexistent one.
 *   - getProductIntelligenceOverview: the composite management-overview
 *     assembly returns all ten spec section 4.B dimensions, each its own
 *     named key -- never merged into one composite row set.
 *
 *   Deliberately NOT re-covered here (already proven elsewhere, per the
 *   same principle M13's own DB test states): the qualifying-invoice
 *   inclusion/exclusion rule itself (cancelled/reversed, no usable date,
 *   fully-credited-still-qualifies -- M12 and M13's own DB tests already
 *   prove this at the invoice level; this file's job is only to confirm
 *   the NEW product-keyed grouping on top of it, exercised implicitly by
 *   every section above using real qualifying invoices); the physical
 *   picking -> authorize lifecycle's own mechanics (M10's fulfilment-db
 *   integration test already exhaustively covers dispatch/delivery
 *   validation rules; this file drives that lifecycle only as a means to
 *   reach the one NEW product-level query on top of it).
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 14: product intelligence", () => {
  let skipAll = false;

  let adminId: string;
  let customer1Id: string;
  let customer2Id: string;
  const uniqueSuffix = `m14test-${Date.now()}`;
  let invoiceCounter = 0;

  const createdImportBatchIds: string[] = [];
  const createdSapInvoiceIds: string[] = [];
  const createdClaimIds: string[] = [];
  const createdCreditNoteIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdDispatchRecordIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer1 = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });
    const customer2 = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-002" }, select: { id: true } });

    if (!admin || !customer1 || !customer2) {
      console.log(
        "Skipping Milestone 14 product-intelligence DB integration test: need an admin user and " +
          "the DEMO-CUST-001/DEMO-CUST-002 customers. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customer1Id = customer1.id;
    customer2Id = customer2.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.deliveryLine.deleteMany({ where: { dispatchLine: { dispatchRecord: { id: { in: createdDispatchRecordIds } } } } });
      await prisma.deliveryRecord.deleteMany({ where: { dispatchRecordId: { in: createdDispatchRecordIds } } });
      await prisma.dispatchLine.deleteMany({ where: { dispatchRecordId: { in: createdDispatchRecordIds } } });
      await prisma.dispatchRecord.deleteMany({ where: { id: { in: createdDispatchRecordIds } } });
      // UnfulfilledDemand.pickingLineId/pickingSessionId are both Restrict,
      // so UnfulfilledDemand (and its own dependents) must be cleared
      // BEFORE PickingLine/PickingSession, never after.
      await prisma.lostSaleRecord.deleteMany({ where: { unfulfilledDemand: { orderId: { in: createdOrderIds } } } });
      await prisma.customerDecisionEvent.deleteMany({ where: { unfulfilledDemand: { orderId: { in: createdOrderIds } } } });
      await prisma.unfulfilledDemand.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.pickingLine.deleteMany({ where: { pickingSession: { orderId: { in: createdOrderIds } } } });
      await prisma.pickingSession.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
      await prisma.creditNote.deleteMany({ where: { id: { in: createdCreditNoteIds } } });
      await prisma.claimReturn.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.claimResolution.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaimLine.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaim.deleteMany({ where: { id: { in: createdClaimIds } } });
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoiceId: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoice.deleteMany({ where: { id: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { id: { in: createdImportBatchIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /** One SAP invoice with one or more lines -- same shape as
   * tests/customer-intelligence-db.integration.test.ts's own helper. */
  async function createSapInvoice(input: {
    customerId: string | null;
    invoiceDate: Date | null;
    isCancelledOrReversed?: boolean;
    currencyCode?: string;
    lines: { sapItemCode: string; unitOfMeasure?: string; quantityInvoiced: string; unitPrice: string }[];
  }) {
    const { prisma } = await import("@/lib/prisma");
    invoiceCounter += 1;

    const batch = await prisma.sapInvoiceImportBatch.create({
      data: {
        originalFileName: "m14-test.csv",
        uploadedById: adminId,
        columnMapping: {},
        totalRows: input.lines.length,
        importedInvoiceCount: 1,
        importedLineCount: input.lines.length,
        duplicateRowCount: 0,
        invalidRowCount: 0,
        isDemo: true,
      },
      select: { id: true },
    });
    createdImportBatchIds.push(batch.id);

    const docEntry = `${uniqueSuffix}-${invoiceCounter}`;
    const docNum = `INV-${uniqueSuffix}-${invoiceCounter}`;
    const currency = input.currencyCode ?? "USD";

    const invoice = await prisma.sapInvoice.create({
      data: {
        importBatchId: batch.id,
        sapDocEntry: docEntry,
        sapDocNum: docNum,
        matchedCustomerId: input.customerId,
        invoiceDate: input.invoiceDate,
        currencyCode: currency,
        isCancelledOrReversed: input.isCancelledOrReversed ?? false,
        total: input.lines.reduce((sum, l) => sum + Number(l.quantityInvoiced) * Number(l.unitPrice), 0).toFixed(4),
        rawSourceData: {},
        isDemo: true,
        lines: {
          create: input.lines.map((line, i) => ({
            lineNumber: i + 1,
            sapItemCode: line.sapItemCode,
            sapItemDescription: `M14 test item ${line.sapItemCode}`,
            unitOfMeasure: line.unitOfMeasure ?? "EA",
            quantityInvoiced: line.quantityInvoiced,
            unitPrice: line.unitPrice,
            lineTotal: (Number(line.quantityInvoiced) * Number(line.unitPrice)).toFixed(4),
            rawSourceData: {},
            isDemo: true,
          })),
        },
      },
      select: { id: true, lines: { select: { id: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdSapInvoiceIds.push(invoice.id);
    return { invoiceId: invoice.id, lineIds: invoice.lines.map((l) => l.id) };
  }

  /** A minimal Product master row, matching one of createSapInvoice's own sapItemCode values. */
  async function createProduct(input: { sapItemCode: string; itemName?: string; category?: string | null }) {
    const { prisma } = await import("@/lib/prisma");
    const product = await prisma.product.create({
      data: {
        sapItemCode: input.sapItemCode,
        itemName: input.itemName ?? `M14 test product ${input.sapItemCode}`,
        category: input.category ?? "M14-TEST-CATEGORY",
        status: "ACTIVE",
        isDemo: true,
      },
      select: { id: true, sapItemCode: true },
    });
    createdProductIds.push(product.id);
    return product;
  }

  /** Drives a claim to APPROVED through the real 6A lifecycle -- same
   * precedent as tests/customer-intelligence-db.integration.test.ts's own
   * driveClaimToApproved helper, generalised to accept several lines
   * (for the multi-product-claim scenario). */
  async function driveClaimToApproved(customerId: string, invoiceId: string, claimLines: { sapInvoiceLineId: string; disputedAmount: string }[]) {
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { recordClaimResolution, approveClaimResolution } = await import("@/lib/invoice-claims/claim-resolution");

    const totalDisputed = claimLines.reduce((sum, l) => sum + Number(l.disputedAmount), 0).toFixed(4);

    const created = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "QUALITY_ISSUE",
        description: "M14 test claim",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: claimLines.map((l) => ({ sapInvoiceLineId: l.sapInvoiceLineId, disputeType: "AMOUNT_ONLY" as const, disputedAmount: l.disputedAmount, reason: "M14 test" })),
      },
      adminId
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("setup failed: createInvoiceClaim");
    createdClaimIds.push(created.id);

    const resolution = await recordClaimResolution(created.id, { decision: "FULL_CREDIT_RECOMMENDED", findings: "m14 test" } as never, adminId);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error("setup failed: recordClaimResolution");

    const approved = await approveClaimResolution(created.id, resolution.id, totalDisputed, adminId);
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("setup failed: approveClaimResolution");

    return created.id;
  }

  /** Creates a claim WITHOUT driving it through resolution/approval --
   * sufficient for item 6's claimCount/multiProductClaimCount, which
   * lib/reporting/product-commercial-health-queries.ts's loadClaimAttribution
   * computes from InvoiceClaimLine + claim.claimDate/closedAt alone, never
   * gated by claim status. */
  async function createRawClaim(customerId: string, invoiceId: string, claimLines: { sapInvoiceLineId: string; disputedAmount: string }[]) {
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const created = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "QUALITY_ISSUE",
        description: "M14 test raw claim",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: claimLines.map((l) => ({ sapInvoiceLineId: l.sapInvoiceLineId, disputeType: "AMOUNT_ONLY" as const, disputedAmount: l.disputedAmount, reason: "M14 test" })),
      },
      adminId
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("setup failed: createInvoiceClaim (raw)");
    createdClaimIds.push(created.id);
    return created.id;
  }

  function emptyFilters() {
    return {
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
      includeDemo: true,
      currency: null,
      lostSalesReason: null,
      productCategory: null,
      productSearch: null,
      sapItemCode: null,
    };
  }

  // --- Items 1-4: value by currency, quantity by unit, invoice frequency, distinct customers ---

  describe("items 1-4: revenue, quantity, frequency, distinct customers (sapItemCode-keyed)", () => {
    it("the Product 360 profile and the management overview agree on a matched product's figures, and never mix currencies or units", async () => {
      if (skipAll) return;
      const { getProductRevenueProfile, getProductRevenueOverview } = await import("@/lib/reporting/product-revenue-queries");

      const itemCode = `ITEM-${uniqueSuffix}-matched`;
      await createProduct({ sapItemCode: itemCode, category: "Fresh Produce" });

      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        currencyCode: "USD",
        lines: [{ sapItemCode: itemCode, unitOfMeasure: "EA", quantityInvoiced: "10.0000", unitPrice: "2.0000" }],
      });
      await createSapInvoice({
        customerId: customer2Id,
        invoiceDate: new Date(),
        currencyCode: "USD",
        lines: [{ sapItemCode: itemCode, unitOfMeasure: "CTN", quantityInvoiced: "3.0000", unitPrice: "20.0000" }],
      });
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        currencyCode: "ZWG",
        lines: [{ sapItemCode: itemCode, unitOfMeasure: "EA", quantityInvoiced: "1.0000", unitPrice: "900.0000" }],
      });

      const profile = await getProductRevenueProfile(itemCode, emptyFilters());
      expect(profile.byCurrency.find((c) => c.currency === "USD")!.lineValueTotal).toBe("80"); // 10*2 + 3*20
      expect(profile.byCurrency.find((c) => c.currency === "ZWG")!.lineValueTotal).toBe("900");
      expect(profile.quantityByUnit.find((q) => q.unitOfMeasure === "EA")!.quantityTotal).toBe("11"); // 10 + 1 -- never combined with CTN
      expect(profile.quantityByUnit.find((q) => q.unitOfMeasure === "CTN")!.quantityTotal).toBe("3");
      expect(profile.distinctCustomerCountInPeriod).toBe(2);
      expect(profile.history.purchaseFrequencyInPeriod).toBe(3);

      const overview = await getProductRevenueOverview(emptyFilters());
      const overviewRow = overview.rows.find((r) => r.sapItemCode === itemCode);
      expect(overviewRow).toBeDefined();
      expect(overviewRow!.productMasterMatched).toBe(true);
      expect(overviewRow!.distinctCustomerCountInPeriod).toBe(2);
      expect(overviewRow!.invoiceFrequencyInPeriod).toBe(3);
    });

    it("retains a SAP item code with real activity but no Product master row -- never hidden", async () => {
      if (skipAll) return;
      const { getProductRevenueOverview } = await import("@/lib/reporting/product-revenue-queries");

      const unmatchedItem = `ITEM-${uniqueSuffix}-unmatched`;
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: unmatchedItem, quantityInvoiced: "1.0000", unitPrice: "5.0000" }],
      });

      const overview = await getProductRevenueOverview(emptyFilters());
      const row = overview.rows.find((r) => r.sapItemCode === unmatchedItem);
      expect(row).toBeDefined();
      expect(row!.productMasterMatched).toBe(false);
      expect(row!.productId).toBeNull();
    });
  });

  // --- Item 5: lost sales, via the real picking -> authorize -> decide -> confirm lifecycle ---

  describe("item 5: highest lost-sales activity", () => {
    it("a confirmed lost sale is grouped by sapItemCode and resolves productId through the real lifecycle", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { generateOrderReference } = await import("@/lib/orders");
      const { startPickingSession } = await import("@/lib/picking/start-picking");
      const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
      const { completePickingSession } = await import("@/lib/picking/complete-picking");
      const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");
      const { recordCustomerDecision } = await import("@/lib/lost-sales/record-decision");
      const { confirmLostSale } = await import("@/lib/lost-sales/confirm-lost-sale");
      const { getProductLostSalesRanking } = await import("@/lib/reporting/product-demand-queries");

      const itemCode = `ITEM-${uniqueSuffix}-lostsale`;
      const product = await createProduct({ sapItemCode: itemCode });

      const order = await prisma.customerOrder.create({
        data: {
          reference: generateOrderReference(),
          customerId: customer1Id,
          createdById: adminId,
          source: "MANUAL",
          status: "RECEIVED",
          currency: "USD",
          orderDate: new Date(),
          requestedDeliveryDate: new Date(),
          receivedAt: new Date(),
          isDemo: true,
          lines: {
            create: [
              {
                lineNumber: 1,
                originalProductDescription: `M14 unavailable item ${uniqueSuffix}`,
                productId: product.id,
                sapItemCodeSnapshot: itemCode,
                requestedQuantity: "10.0000",
                requestedUnitCode: "EA",
                isDemo: true,
              },
            ],
          },
        },
        select: { id: true, lines: { select: { id: true } } },
      });
      createdOrderIds.push(order.id);
      const lineId = order.lines[0]!.id;

      const started = await startPickingSession(order.id, adminId);
      if (!started.ok) throw new Error(started.message);
      await recordPickedLine(started.session.id, lineId, "0.0000", "10.0000", undefined, adminId);
      const completed = await completePickingSession(started.session.id, adminId);
      if (!completed.ok) throw new Error(completed.message);
      const authorized = await authorizePickingSession(started.session.id, adminId);
      if (!authorized.ok) throw new Error(authorized.message);

      const demand = await prisma.unfulfilledDemand.findFirst({ where: { orderId: order.id }, select: { id: true, sapItemCodeSnapshot: true, productId: true } });
      if (!demand) throw new Error("Expected an UnfulfilledDemand row after authorization.");
      expect(demand.sapItemCodeSnapshot).toBe(itemCode);
      expect(demand.productId).toBe(product.id);

      const decided = await recordCustomerDecision({ unfulfilledDemandId: demand.id, decisionType: "ENTIRE_LINE_CANCELLED", source: "CUSTOMER_EMAIL", quantity: "10.0000" }, adminId);
      if (!decided.ok) throw new Error(decided.message);

      const confirmed = await confirmLostSale({ unfulfilledDemandId: demand.id, quantity: "10.0000", reason: "PRODUCT_UNAVAILABLE", decisionSource: "CUSTOMER_EMAIL" }, adminId);
      if (!confirmed.ok) throw new Error(confirmed.message);

      const ranking = await getProductLostSalesRanking(emptyFilters());
      const row = ranking.rows.find((r) => r.sapItemCode === itemCode);
      expect(row).toBeDefined();
      expect(row!.productId).toBe(product.id);
      expect(row!.confirmedLostSaleCount).toBe(1);
      expect(Number(row!.confirmedLostSaleQuantityTotal)).toBe(10);
    });
  });

  // --- Item 6: claims and returns (inclusive count + multi-product exclusion) ---

  describe("item 6: claim and return activity", () => {
    it("a single-product claim counts toward exactly that product, and a multi-product claim counts toward BOTH its products inclusively", async () => {
      if (skipAll) return;
      const { getProductClaimAndReturnOverview } = await import("@/lib/reporting/product-commercial-health-queries");

      const itemA = `ITEM-${uniqueSuffix}-claim-a`;
      const itemB = `ITEM-${uniqueSuffix}-claim-b`;

      const { invoiceId: singleInvoiceId, lineIds: singleLineIds } = await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: itemA, quantityInvoiced: "1.0000", unitPrice: "30.0000" }],
      });
      await driveClaimToApproved(customer1Id, singleInvoiceId, [{ sapInvoiceLineId: singleLineIds[0]!, disputedAmount: "30.0000" }]);

      const { invoiceId: multiInvoiceId, lineIds: multiLineIds } = await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [
          { sapItemCode: itemA, quantityInvoiced: "1.0000", unitPrice: "10.0000" },
          { sapItemCode: itemB, quantityInvoiced: "1.0000", unitPrice: "10.0000" },
        ],
      });
      await createRawClaim(customer1Id, multiInvoiceId, [
        { sapInvoiceLineId: multiLineIds[0]!, disputedAmount: "10.0000" },
        { sapInvoiceLineId: multiLineIds[1]!, disputedAmount: "10.0000" },
      ]);

      const overview = await getProductClaimAndReturnOverview(emptyFilters());
      const rowA = overview.rows.find((r) => r.sapItemCode === itemA);
      const rowB = overview.rows.find((r) => r.sapItemCode === itemB);
      expect(rowA).toBeDefined();
      expect(rowB).toBeDefined();
      // itemA appears in BOTH the single-product claim and the
      // multi-product claim -- claimCount is inclusive, so it must be >= 2.
      expect(rowA!.claimCount).toBeGreaterThanOrEqual(2);
      expect(rowB!.claimCount).toBeGreaterThanOrEqual(1);
      expect(overview.multiProductClaimCount).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Item 7: credit-note value (claim-linked, single-product only; multi-product excluded) ---

  describe("item 7: highest actual credit-note values", () => {
    it("counts a claim-linked credit note on a single-product claim, and excludes one on a multi-product claim into unattributableCreditNoteCount", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { getProductCreditNoteValueOverview } = await import("@/lib/reporting/product-commercial-health-queries");

      const itemC = `ITEM-${uniqueSuffix}-cn-single`;
      const { invoiceId: singleInvoiceId, lineIds: singleLineIds } = await createSapInvoice({
        customerId: customer2Id,
        invoiceDate: new Date(),
        currencyCode: "USD",
        lines: [{ sapItemCode: itemC, quantityInvoiced: "1.0000", unitPrice: "60.0000" }],
      });
      const singleClaimId = await driveClaimToApproved(customer2Id, singleInvoiceId, [{ sapInvoiceLineId: singleLineIds[0]!, disputedAmount: "60.0000" }]);
      const singleNote = await prisma.creditNote.create({
        data: {
          sapCreditNoteDocNum: `CN-SINGLE-${uniqueSuffix}`,
          claimId: singleClaimId,
          matchStatus: "AUTO_MATCHED",
          matchMethod: "MANUAL",
          amount: "60.0000",
          currencyCode: "USD",
          creditNoteDate: new Date(),
          isDemo: true,
        },
        select: { id: true },
      });
      createdCreditNoteIds.push(singleNote.id);

      const itemD = `ITEM-${uniqueSuffix}-cn-multi-d`;
      const itemE = `ITEM-${uniqueSuffix}-cn-multi-e`;
      const { invoiceId: multiInvoiceId, lineIds: multiLineIds } = await createSapInvoice({
        customerId: customer2Id,
        invoiceDate: new Date(),
        lines: [
          { sapItemCode: itemD, quantityInvoiced: "1.0000", unitPrice: "15.0000" },
          { sapItemCode: itemE, quantityInvoiced: "1.0000", unitPrice: "15.0000" },
        ],
      });
      const multiClaimId = await createRawClaim(customer2Id, multiInvoiceId, [
        { sapInvoiceLineId: multiLineIds[0]!, disputedAmount: "15.0000" },
        { sapInvoiceLineId: multiLineIds[1]!, disputedAmount: "15.0000" },
      ]);
      // Created directly (bypassing recordCreditNoteManually's APPROVED-
      // status gate) purely to prove the OVERVIEW QUERY'S exclusion rule
      // -- this note deliberately exists on a multi-product claim.
      const multiNote = await prisma.creditNote.create({
        data: {
          sapCreditNoteDocNum: `CN-MULTI-${uniqueSuffix}`,
          claimId: multiClaimId,
          matchStatus: "AUTO_MATCHED",
          matchMethod: "MANUAL",
          amount: "30.0000",
          currencyCode: "USD",
          creditNoteDate: new Date(),
          isDemo: true,
        },
        select: { id: true },
      });
      createdCreditNoteIds.push(multiNote.id);

      const overview = await getProductCreditNoteValueOverview(emptyFilters());
      const rowC = overview.rows.find((r) => r.sapItemCode === itemC && r.currency === "USD");
      expect(rowC).toBeDefined();
      expect(Number(rowC!.total)).toBeGreaterThanOrEqual(60);

      // Neither itemD nor itemE gets this credit note's value -- it is
      // unattributable, never guessed or split pro-rata between them.
      expect(overview.rows.some((r) => r.sapItemCode === itemD)).toBe(false);
      expect(overview.rows.some((r) => r.sapItemCode === itemE)).toBe(false);
      expect(overview.unattributableCreditNoteCount).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Item 8: delivery rejections -- the DispatchLine.createdAt fix ---

  describe("item 8: highest recorded delivery rejection quantities (DispatchLine.createdAt period/demo filter)", () => {
    it("finds a recorded delivery rejection through the real create-dispatch -> depart -> record-delivery lifecycle", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { generateOrderReference } = await import("@/lib/orders");
      const { startPickingSession } = await import("@/lib/picking/start-picking");
      const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
      const { completePickingSession } = await import("@/lib/picking/complete-picking");
      const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");
      const { createDispatchRecord, departDispatchRecord } = await import("@/lib/fulfilment/dispatch");
      const { recordDelivery } = await import("@/lib/fulfilment/delivery");
      const { getDispatchRecordDetail } = await import("@/lib/fulfilment/queries");
      const { getProductDeliveryRejectionOverview, getProductFulfilmentSummary } = await import("@/lib/reporting/product-fulfilment-queries");

      const itemCode = `ITEM-${uniqueSuffix}-rejection`;
      const product = await createProduct({ sapItemCode: itemCode });

      const order = await prisma.customerOrder.create({
        data: {
          reference: generateOrderReference(),
          customerId: customer1Id,
          createdById: adminId,
          source: "MANUAL",
          status: "RECEIVED",
          currency: "USD",
          orderDate: new Date(),
          requestedDeliveryDate: new Date(),
          receivedAt: new Date(),
          isDemo: true,
          lines: {
            create: [
              {
                lineNumber: 1,
                originalProductDescription: `M14 rejection item ${uniqueSuffix}`,
                productId: product.id,
                sapItemCodeSnapshot: itemCode,
                requestedQuantity: "10.0000",
                requestedUnitCode: "EA",
                isDemo: true,
              },
            ],
          },
        },
        select: { id: true, lines: { select: { id: true } } },
      });
      createdOrderIds.push(order.id);
      const lineId = order.lines[0]!.id;

      const started = await startPickingSession(order.id, adminId);
      if (!started.ok) throw new Error(started.message);
      await recordPickedLine(started.session.id, lineId, "10.0000", "0.0000", undefined, adminId);
      const completed = await completePickingSession(started.session.id, adminId);
      if (!completed.ok) throw new Error(completed.message);
      const authorized = await authorizePickingSession(started.session.id, adminId);
      if (!authorized.ok) throw new Error(authorized.message);

      const dispatch = await createDispatchRecord(order.id, adminId, { lines: [{ orderLineId: lineId, quantity: "10.0000" }] });
      if (!dispatch.ok) throw new Error(dispatch.message);
      createdDispatchRecordIds.push(dispatch.dispatchRecordId);

      const departed = await departDispatchRecord(dispatch.dispatchRecordId, adminId, "TRUCK-M14");
      expect(departed.ok).toBe(true);

      const detail = await getDispatchRecordDetail(dispatch.dispatchRecordId);
      const dLine = detail!.lines[0]!;

      const delivered = await recordDelivery(
        dispatch.dispatchRecordId,
        adminId,
        { lines: [{ dispatchLineId: dLine.id, acceptedQuantity: "7.0000", rejectedQuantity: "3.0000", rejectionReason: "3 units damaged in transit" }] },
        {}
      );
      expect(delivered.ok).toBe(true);

      // Product 360: this product's own fulfilment summary must show the rejection.
      const summary = await getProductFulfilmentSummary(itemCode, product.id, emptyFilters());
      expect(summary.deliveryLinesWithRejectionCount).toBe(1);
      expect(summary.deliveredRejectedQuantityByUnit.find((q) => q.unitOfMeasure === "EA")?.quantityTotal).toBe("3");

      // Management overview: the SAME rejection, found through the corrected
      // DispatchLine.createdAt-based query (never the nonexistent
      // DispatchRecord.dispatchedAt field this milestone's own bug fix removed).
      const overview = await getProductDeliveryRejectionOverview(emptyFilters());
      const row = overview.rows.find((r) => r.sapItemCode === itemCode);
      expect(row).toBeDefined();
      expect(row!.productId).toBe(product.id);
      expect(row!.deliveryLinesWithRejectionCount).toBe(1);
      expect(row!.rejectedQuantityByUnit.find((q) => q.unitOfMeasure === "EA")?.quantityTotal).toBe("3");
    });
  });

  // --- Item 9: declining invoice activity vs. the previous comparable period ---

  describe("item 9: declining invoice activity", () => {
    it("ranks a product's decline independently per currency, comparing against the immediately preceding period of equal duration", async () => {
      if (skipAll) return;
      const { getProductDecliningActivityOverview } = await import("@/lib/reporting/product-revenue-queries");

      const itemCode = `ITEM-${uniqueSuffix}-decline`;
      // Current period: 2026-03-01 to 2026-03-10 (10 days). Previous: 2026-02-19 to 2026-02-28.
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date("2026-02-20T00:00:00.000Z"),
        currencyCode: "USD",
        lines: [{ sapItemCode: itemCode, quantityInvoiced: "1.0000", unitPrice: "200.0000" }],
      });
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date("2026-03-05T00:00:00.000Z"),
        currencyCode: "USD",
        lines: [{ sapItemCode: itemCode, quantityInvoiced: "1.0000", unitPrice: "50.0000" }],
      });

      const overview = await getProductDecliningActivityOverview({ ...emptyFilters(), dateFrom: "2026-03-01", dateTo: "2026-03-10" });
      expect(overview.previousPeriodFrom).toBe("2026-02-19");
      expect(overview.previousPeriodTo).toBe("2026-02-28");

      const row = overview.rows.find((r) => r.sapItemCode === itemCode && r.currency === "USD");
      expect(row).toBeDefined();
      expect(row!.previousPeriodValue).toBe("200");
      expect(row!.currentPeriodValue).toBe("50");
      expect(row!.declineAmount).toBe("150");
    });

    it("never fabricates a decline from a zero previous period -- a product absent from the previous period is simply absent from this ranking", async () => {
      if (skipAll) return;
      const { getProductDecliningActivityOverview } = await import("@/lib/reporting/product-revenue-queries");

      const itemCode = `ITEM-${uniqueSuffix}-nodecline`;
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date("2026-04-05T00:00:00.000Z"),
        currencyCode: "USD",
        lines: [{ sapItemCode: itemCode, quantityInvoiced: "1.0000", unitPrice: "500.0000" }],
      });

      const overview = await getProductDecliningActivityOverview({ ...emptyFilters(), dateFrom: "2026-04-01", dateTo: "2026-04-10" });
      expect(overview.rows.some((r) => r.sapItemCode === itemCode)).toBe(false);
    });
  });

  // --- Item 10: incomplete or unmatched master data ---

  describe("item 10: incomplete or unmatched master data", () => {
    it("flags a SAP item code with real invoice activity and no Product master row as unmatched -- never hidden", async () => {
      if (skipAll) return;
      const { getProductMasterDataQualityOverview } = await import("@/lib/reporting/product-revenue-queries");

      const unmatchedItem = `ITEM-${uniqueSuffix}-mdq-unmatched`;
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: unmatchedItem, quantityInvoiced: "1.0000", unitPrice: "1.0000" }],
      });

      const overview = await getProductMasterDataQualityOverview(emptyFilters());
      const row = overview.rows.find((r) => r.sapItemCode === unmatchedItem);
      expect(row).toBeDefined();
      expect(row!.issue).toBe("unmatched");
      expect(row!.productId).toBeNull();
      expect(overview.unmatchedCount).toBeGreaterThanOrEqual(1);
    });

    it("flags a matched product with no recorded category as incomplete_category -- never for a null unitOfMeasure", async () => {
      if (skipAll) return;
      const { getProductMasterDataQualityOverview } = await import("@/lib/reporting/product-revenue-queries");

      const itemCode = `ITEM-${uniqueSuffix}-mdq-incomplete`;
      await createProduct({ sapItemCode: itemCode, category: null });
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: itemCode, quantityInvoiced: "1.0000", unitPrice: "1.0000" }],
      });

      const overview = await getProductMasterDataQualityOverview(emptyFilters());
      const row = overview.rows.find((r) => r.sapItemCode === itemCode);
      expect(row).toBeDefined();
      expect(row!.issue).toBe("incomplete_category");
      expect(overview.incompleteCategoryCount).toBeGreaterThanOrEqual(1);
    });

    it("does NOT flag a fully-matched product with a recorded category", async () => {
      if (skipAll) return;
      const { getProductMasterDataQualityOverview } = await import("@/lib/reporting/product-revenue-queries");

      const itemCode = `ITEM-${uniqueSuffix}-mdq-complete`;
      await createProduct({ sapItemCode: itemCode, category: "Beverages" });
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: itemCode, quantityInvoiced: "1.0000", unitPrice: "1.0000" }],
      });

      const overview = await getProductMasterDataQualityOverview(emptyFilters());
      expect(overview.rows.some((r) => r.sapItemCode === itemCode)).toBe(false);
    });
  });

  // --- Product 360 composite assembly ---

  describe("getProductProfile / getProductById (Product 360 composite assembly)", () => {
    it("assembles a full profile, including deterministic insights, for a real product id", async () => {
      if (skipAll) return;
      const { getProductProfile } = await import("@/lib/reporting/product-insights-queries");

      const itemCode = `ITEM-${uniqueSuffix}-profile`;
      const product = await createProduct({ sapItemCode: itemCode });
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: itemCode, quantityInvoiced: "2.0000", unitPrice: "15.0000" }],
      });

      const profile = await getProductProfile(product.id, emptyFilters());
      expect(profile).not.toBeNull();
      expect(profile!.product.sapItemCode).toBe(itemCode);
      expect(profile!.revenue.byCurrency.find((c) => c.currency === "USD")!.lineValueTotal).toBe("30");
      expect(Array.isArray(profile!.insights)).toBe(true);
    });

    it("returns null for a nonexistent product id -- never throws", async () => {
      if (skipAll) return;
      const { getProductProfile } = await import("@/lib/reporting/product-insights-queries");
      const profile = await getProductProfile("nonexistent-cuid-value", emptyFilters());
      expect(profile).toBeNull();
    });
  });

  // --- Management overview composite assembly ---

  describe("getProductIntelligenceOverview (composite management-overview assembly)", () => {
    it("returns all ten spec section 4.B dimensions, each under its own named key -- never merged into one composite row set", async () => {
      if (skipAll) return;
      const { getProductIntelligenceOverview } = await import("@/lib/reporting/product-insights-queries");

      const overview = await getProductIntelligenceOverview(emptyFilters());

      expect(overview.revenueQuantityFrequencyCustomers).toBeDefined();
      expect(overview.lostSalesActivity).toBeDefined();
      expect(overview.claimAndReturnActivity).toBeDefined();
      expect(overview.creditNoteValue).toBeDefined();
      expect(overview.deliveryRejections).toBeDefined();
      expect(overview.decliningActivity).toBeDefined();
      expect(overview.masterDataQuality).toBeDefined();

      // No composite/blended score field anywhere on the top-level report.
      expect(Object.keys(overview)).not.toContain("compositeScore");
      expect(Object.keys(overview)).not.toContain("overallRank");

      // Item 10 is a flagged list, never a value ranking -- its rows carry no rank field.
      expect(overview.masterDataQuality.rows.every((r) => !("rank" in r))).toBe(true);
    });
  });
});
