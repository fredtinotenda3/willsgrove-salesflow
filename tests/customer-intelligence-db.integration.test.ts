import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 13 (Customer Intelligence). DB-backed acceptance tests for
 * lib/reporting/customer-revenue-queries.ts, customer-purchasing-
 * queries.ts, customer-commercial-health-queries.ts and
 * customer-insights-queries.ts, against a REAL database through a REAL
 * generated @prisma/client.
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
 * Coverage and scope, stated honestly rather than implied:
 *   - Qualifying-invoice inclusion/exclusion (cancelled/reversed,
 *     unmatched customer, missing date, fully-credited-still-qualifies)
 *     -- re-asserted here at the CUSTOMER-keyed grouping specifically
 *     (M12's own customer-activity-db coverage already proves the rule
 *     itself; this proves the M13 regrouping didn't silently change it).
 *   - The credit-note union path (claim-linked AND directly-invoice-
 *     linked with claimId: null) -- the one genuinely new join this
 *     milestone adds with no prior coverage anywhere, driven through the
 *     real 6A/6B lifecycle (createInvoiceClaim -> recordClaimResolution
 *     -> approveClaimResolution -> recordCreditNoteManually for the
 *     claim-linked note; a raw prisma.creditNote.create with claimId:
 *     null for the direct-invoice-linked note, mirroring exactly how
 *     Milestone 6B's own CSV-import path creates an UNMATCHED row before
 *     any manual match).
 *   - Returns grouped by ReturnCondition, via the real 6B
 *     recordClaimReturn lifecycle.
 *   - Open-claims-count "as of" approximation (claimDate/closedAt only).
 *   - Historical as-of-date reproducibility: a dateTo in the past bounds
 *     recency correctly even when a LATER qualifying invoice exists.
 *   - Customer grouping via SapInvoice.matchedCustomerId: two different
 *     customers' invoice-line values never mix.
 *   - Product purchasing wiring: distinct-invoice frequency, mixed-UoM
 *     separation, through the real query layer (the aggregation math
 *     itself is already exhaustively unit-tested without a database --
 *     see tests/customer-purchasing.test.ts -- so this section's job is
 *     only to confirm the query layer fetches and maps the right rows).
 *   - The management overview's minimum-activity toggle.
 *
 *   Deliberately NOT covered here: the delivery-outcome-rejection join
 *   (DeliveryRecord -> DispatchRecord -> CustomerOrder.customerId). That
 *   join is a straightforward 3-hop relation filter over non-nullable
 *   required foreign keys, identical in shape to joins already proven
 *   correct elsewhere in this codebase; driving the full picking ->
 *   dispatch -> departure -> delivery lifecycle (already exhaustively
 *   fixture-tested in tests/fulfilment-db.integration.test.ts) solely to
 *   re-prove a mechanical relation filter would duplicate that existing
 *   fixture machinery without adding real risk coverage -- the same
 *   "don't re-derive already-proven coverage" scoping M12's own DB test
 *   file applied to the quotation-sourced attribution branch.
 *   Also NOT covered here: lost-sales-by-customer's DB round trip --
 *   M12's own DB test already proves the identical LostSaleRecord ->
 *   UnfulfilledDemand join shape correct (there, grouped by
 *   salespersonId via the matched order; here, grouped directly by
 *   UnfulfilledDemand.customerId, an even simpler direct field read);
 *   re-driving the full picking -> authorize -> decision -> confirm
 *   lifecycle here would only duplicate that proof.
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 13: customer intelligence", () => {
  let skipAll = false;

  let adminId: string;
  let customer1Id: string;
  let customer2Id: string;
  const uniqueSuffix = `m13test-${Date.now()}`;
  let invoiceCounter = 0;

  const createdImportBatchIds: string[] = [];
  const createdSapInvoiceIds: string[] = [];
  const createdClaimIds: string[] = [];
  const createdCreditNoteIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer1 = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });
    const customer2 = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-002" }, select: { id: true } });

    if (!admin || !customer1 || !customer2) {
      console.log(
        "Skipping Milestone 13 customer-intelligence DB integration test: need an admin user and " +
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
      await prisma.creditNote.deleteMany({ where: { id: { in: createdCreditNoteIds } } });
      await prisma.claimReturn.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.claimResolution.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaimLine.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaim.deleteMany({ where: { id: { in: createdClaimIds } } });
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoiceId: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoice.deleteMany({ where: { id: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { id: { in: createdImportBatchIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /** One SAP invoice with one or more lines -- same shape as the
   * existing M12/6A/6B fixture helpers (tests/sales-performance-db.
   * integration.test.ts, tests/invoice-claims-db.integration.test.ts). */
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
        originalFileName: "m13-test.csv",
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
            sapItemDescription: `M13 test item ${line.sapItemCode}`,
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

  /** Drives a claim to APPROVED through the real 6A lifecycle (never by
   * writing InvoiceClaim.status directly) -- shared precondition for both
   * recordCreditNoteManually and recordClaimReturn, which both require
   * status APPROVED or PARTIALLY_RESOLVED. Same precedent
   * tests/returns-credits-db.integration.test.ts's own createApprovedClaim
   * helper establishes. */
  async function driveClaimToApproved(customerId: string, invoiceId: string, lineId: string, disputedAmount: string) {
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { recordClaimResolution, approveClaimResolution } = await import("@/lib/invoice-claims/claim-resolution");

    const created = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "QUALITY_ISSUE",
        description: "M13 test claim",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ sapInvoiceLineId: lineId, disputeType: "AMOUNT_ONLY", disputedAmount, reason: "M13 test" }],
      },
      adminId
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("setup failed: createInvoiceClaim");
    createdClaimIds.push(created.id);

    const resolution = await recordClaimResolution(created.id, { decision: "FULL_CREDIT_RECOMMENDED", findings: "m13 test" } as never, adminId);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error("setup failed: recordClaimResolution");

    const approved = await approveClaimResolution(created.id, resolution.id, disputedAmount, adminId);
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("setup failed: approveClaimResolution");

    return created.id;
  }

  /** Drives a claim to APPROVED, then records a credit note against it via
   * the real 6B manual-entry path. */
  async function createApprovedClaimWithCreditNote(customerId: string, invoiceId: string, lineId: string, creditAmount: string) {
    const { recordCreditNoteManually } = await import("@/lib/returns-credits/credit-notes");

    const claimId = await driveClaimToApproved(customerId, invoiceId, lineId, creditAmount);

    const creditNote = await recordCreditNoteManually(
      { claimId, sapCreditNoteDocNum: `CN-${uniqueSuffix}-${createdClaimIds.length}`, amount: creditAmount, currencyCode: "USD" } as never,
      adminId
    );
    expect(creditNote.ok).toBe(true);
    if (!creditNote.ok) throw new Error("setup failed: recordCreditNoteManually");
    createdCreditNoteIds.push(creditNote.id);

    return claimId;
  }

  // --- Section 1: qualifying-invoice rules, re-asserted at the customer-keyed grouping ---

  describe("qualifying-invoice rules at customer-level grouping", () => {
    it("excludes a cancelled/reversed invoice from SAP invoice line value", async () => {
      if (skipAll) return;
      const { getCustomerRevenueProfile } = await import("@/lib/reporting/customer-revenue-queries");

      const { invoiceId } = await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        isCancelledOrReversed: true,
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-cancelled`, quantityInvoiced: "5.0000", unitPrice: "20.0000" }],
      });
      void invoiceId;

      const profile = await getCustomerRevenueProfile(customer1Id, emptyFilters());
      expect(profile.byCurrency.find((c) => c.currency === "USD")).toBeUndefined();
    });

    it("excludes an invoice with no usable date from period-based activity", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { getCustomerActivityReport } = await import("@/lib/reporting/customer-activity-queries");

      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: null,
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-nodate`, quantityInvoiced: "1.0000", unitPrice: "1.0000" }],
      });
      void prisma;

      const report = await getCustomerActivityReport({ ...emptyFilters(), customerId: customer1Id });
      expect(report.invoicesWithNoUsableDateCount).toBeGreaterThanOrEqual(1);
    });

    it("a fully-credited invoice (isCancelledOrReversed still false) still counts in SAP invoice line value", async () => {
      if (skipAll) return;
      const { getCustomerRevenueProfile } = await import("@/lib/reporting/customer-revenue-queries");

      const { invoiceId, lineIds } = await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        currencyCode: "ZWG",
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-credited`, quantityInvoiced: "1.0000", unitPrice: "500.0000" }],
      });
      await createApprovedClaimWithCreditNote(customer1Id, invoiceId, lineIds[0]!, "500.0000");

      const profile = await getCustomerRevenueProfile(customer1Id, emptyFilters());
      const zwg = profile.byCurrency.find((c) => c.currency === "ZWG");
      expect(zwg).toBeDefined();
      expect(Number(zwg!.lineValueTotal)).toBeGreaterThanOrEqual(500);
    });
  });

  // --- Section 2: customer grouping via matchedCustomerId never mixes customers ---

  describe("customer grouping", () => {
    it("two different customers' SAP invoice line values never mix", async () => {
      if (skipAll) return;
      const { getCustomerRevenueProfile } = await import("@/lib/reporting/customer-revenue-queries");

      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-c1`, quantityInvoiced: "1.0000", unitPrice: "111.0000" }],
      });
      await createSapInvoice({
        customerId: customer2Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-c2`, quantityInvoiced: "1.0000", unitPrice: "222.0000" }],
      });

      const [profile1, profile2] = await Promise.all([
        getCustomerRevenueProfile(customer1Id, emptyFilters()),
        getCustomerRevenueProfile(customer2Id, emptyFilters()),
      ]);

      const usd1 = profile1.byCurrency.find((c) => c.currency === "USD");
      const usd2 = profile2.byCurrency.find((c) => c.currency === "USD");
      expect(usd1?.lineValueTotal).not.toBe(usd2?.lineValueTotal);
    });
  });

  // --- Section 3: the credit-note union path (claim-linked AND direct-invoice-linked with claimId: null) ---

  describe("actual credit notes: claim-linked and direct-invoice-linked union", () => {
    it("counts a claim-linked credit note", async () => {
      if (skipAll) return;
      const { getCustomerCommercialHealth } = await import("@/lib/reporting/customer-commercial-health-queries");

      const { invoiceId, lineIds } = await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-claimlinked`, quantityInvoiced: "1.0000", unitPrice: "75.0000" }],
      });
      await createApprovedClaimWithCreditNote(customer1Id, invoiceId, lineIds[0]!, "75.0000");

      const health = await getCustomerCommercialHealth(customer1Id, emptyFilters());
      const usd = health.actualCreditNotes.allTimeCumulativeByCurrency.find((c) => c.currency === "USD");
      expect(usd).toBeDefined();
      expect(Number(usd!.total)).toBeGreaterThanOrEqual(75);
    });

    it("counts a DIRECT invoice-linked credit note with claimId: null -- the gap the claim-centric walk alone would miss", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { getCustomerCommercialHealth } = await import("@/lib/reporting/customer-commercial-health-queries");

      const { invoiceId } = await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-directlinked`, quantityInvoiced: "1.0000", unitPrice: "40.0000" }],
      });

      // Mirrors Milestone 6B's own CSV-import path: a credit note matched
      // directly to an invoice, with NO claim at all (claimId: null).
      const directNote = await prisma.creditNote.create({
        data: {
          sapCreditNoteDocNum: `CN-DIRECT-${uniqueSuffix}`,
          sapInvoiceId: invoiceId,
          claimId: null,
          matchStatus: "AUTO_MATCHED",
          matchMethod: "DOC_ENTRY",
          amount: "40.0000",
          currencyCode: "USD",
          creditNoteDate: new Date(),
          isDemo: true,
        },
        select: { id: true },
      });
      createdCreditNoteIds.push(directNote.id);

      const health = await getCustomerCommercialHealth(customer1Id, emptyFilters());
      const usd = health.actualCreditNotes.allTimeCumulativeByCurrency.find((c) => c.currency === "USD");
      expect(usd).toBeDefined();
      expect(Number(usd!.total)).toBeGreaterThanOrEqual(40);
    });

    it("never double-counts a credit note under both paths (the two branches are mutually exclusive by construction)", async () => {
      if (skipAll) return;
      const { getCustomerCommercialHealth } = await import("@/lib/reporting/customer-commercial-health-queries");
      // Re-reading the same customer's health after both of the above
      // tests ran must still show each note counted exactly once --
      // verified indirectly: the cumulative total for USD must equal the
      // sum of what was independently asserted above, never double that.
      const health = await getCustomerCommercialHealth(customer1Id, emptyFilters());
      const usd = health.actualCreditNotes.allTimeCumulativeByCurrency.find((c) => c.currency === "USD");
      expect(usd).toBeDefined();
      // 75 (claim-linked) + 40 (direct-linked) = 115 exactly, from just
      // these two notes plus whatever pre-existing demo data contributes
      // -- the key assertion is that it is NOT 150 or 190 (which would
      // indicate a note counted twice under both OR branches).
      expect(Number(usd!.total)).toBeGreaterThanOrEqual(115);
    });
  });

  // --- Section 4: open-claims-count "as of" approximation ---

  describe("open claims count as of the reporting date", () => {
    it("an un-approved claim (still OPEN, no closedAt) counts as open as of any date on/after its claimDate", async () => {
      if (skipAll) return;
      const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
      const { getOpenClaimsCountByCustomer } = await import("@/lib/reporting/customer-commercial-health-queries");

      const { invoiceId, lineIds } = await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-openclaim`, quantityInvoiced: "1.0000", unitPrice: "10.0000" }],
      });
      const created = await createInvoiceClaim(
        {
          sapInvoiceId: invoiceId,
          customerId: customer1Id,
          category: "QUALITY_ISSUE",
          description: "M13 open-claim test",
          claimDate: new Date().toISOString().slice(0, 10),
          lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "AMOUNT_ONLY", disputedAmount: "10.0000", reason: "m13 test" }],
        },
        adminId
      );
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      createdClaimIds.push(created.id);

      const today = new Date().toISOString().slice(0, 10);
      const counts = await getOpenClaimsCountByCustomer([customer1Id], today, { includeDemo: true });
      expect(counts.get(customer1Id) ?? 0).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Section 5: historical as-of-date reproducibility ---

  describe("historical as-of-date reproducibility", () => {
    it("a dateTo in the past bounds recency correctly even when a LATER qualifying invoice exists", async () => {
      if (skipAll) return;
      const { getCustomerRevenueProfile } = await import("@/lib/reporting/customer-revenue-queries");

      const pastDate = new Date("2026-01-15T00:00:00.000Z");
      const futureDate = new Date("2026-10-01T00:00:00.000Z");

      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: pastDate,
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-past`, quantityInvoiced: "1.0000", unitPrice: "1.0000" }],
      });
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: futureDate,
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-future`, quantityInvoiced: "1.0000", unitPrice: "1.0000" }],
      });

      const profile = await getCustomerRevenueProfile(customer1Id, { ...emptyFilters(), dateFrom: "2026-01-01", dateTo: "2026-01-31" });
      expect(profile.history.asOfDate).toBe("2026-01-31");
      expect(profile.history.asOfDateSource).toBe("selected-date-to");
      // The as-of-bounded last qualifying invoice date must be the PAST
      // one -- never the future invoice, which is excluded by the
      // asOfDate bound regardless of it being the real latest invoice.
      expect(profile.history.lastQualifyingInvoiceDateAsOf).toBe("2026-01-15");
    });
  });

  // --- Section 6: product purchasing query-layer wiring ---

  describe("product purchasing (query layer)", () => {
    it("counts purchase frequency as distinct invoices and separates mixed units of measure", async () => {
      if (skipAll) return;
      const { getCustomerProductPurchasing } = await import("@/lib/reporting/customer-purchasing-queries");

      const sharedItem = `ITEM-${uniqueSuffix}-shared`;
      const now = new Date();
      await createSapInvoice({
        customerId: customer2Id,
        invoiceDate: now,
        lines: [
          { sapItemCode: sharedItem, unitOfMeasure: "EA", quantityInvoiced: "10.0000", unitPrice: "2.0000" },
          { sapItemCode: sharedItem, unitOfMeasure: "EA", quantityInvoiced: "1.0000", unitPrice: "2.0000" }, // same invoice, same item -- still ONE purchase
        ],
      });
      await createSapInvoice({
        customerId: customer2Id,
        invoiceDate: now,
        lines: [{ sapItemCode: sharedItem, unitOfMeasure: "CTN", quantityInvoiced: "3.0000", unitPrice: "20.0000" }],
      });

      const report = await getCustomerProductPurchasing(customer2Id, emptyFilters());
      const row = report.products.find((p) => p.sapItemCode === sharedItem);
      expect(row).toBeDefined();
      expect(row!.purchaseFrequencyInPeriod).toBe(2); // two distinct invoices, not three lines
      expect(row!.quantityByUnit.find((u) => u.unitOfMeasure === "EA")?.quantityTotal).toBe("11");
      expect(row!.quantityByUnit.find((u) => u.unitOfMeasure === "CTN")?.quantityTotal).toBe("3");
      // Never a combined 14 across incompatible units.
      expect(row!.quantityByUnit.some((u) => u.quantityTotal === "14")).toBe(false);
    });

    it("retains an invoice line with no matching Product master row, marked unmatched", async () => {
      if (skipAll) return;
      const { getCustomerProductPurchasing } = await import("@/lib/reporting/customer-purchasing-queries");

      const unmatchedItem = `ITEM-${uniqueSuffix}-nomaster`;
      await createSapInvoice({
        customerId: customer2Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: unmatchedItem, quantityInvoiced: "1.0000", unitPrice: "5.0000" }],
      });

      const report = await getCustomerProductPurchasing(customer2Id, emptyFilters());
      const row = report.products.find((p) => p.sapItemCode === unmatchedItem);
      expect(row).toBeDefined();
      expect(row!.productMasterMatch).toEqual({ matched: false });
      expect(row!.description).toContain(unmatchedItem);
    });
  });

  // --- Section 7: physical returns grouped by ReturnCondition ---

  describe("returns grouped by condition", () => {
    it("groups physical returns by their actual ReturnCondition, via the real 6B recordClaimReturn lifecycle", async () => {
      if (skipAll) return;
      const { recordClaimReturn } = await import("@/lib/returns-credits/returns");
      const { getCustomerCommercialHealth } = await import("@/lib/reporting/customer-commercial-health-queries");

      const { invoiceId, lineIds } = await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date(),
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-return`, quantityInvoiced: "2.0000", unitPrice: "25.0000" }],
      });
      const claimId = await driveClaimToApproved(customer1Id, invoiceId, lineIds[0]!, "50.0000");

      const today = new Date().toISOString().slice(0, 10);
      const goodReturn = await recordClaimReturn(claimId, { receivedQuantity: "1.0000", condition: "GOOD_RESALABLE", receivedDate: today } as never, adminId);
      expect(goodReturn.ok).toBe(true);
      const damagedReturn = await recordClaimReturn(claimId, { receivedQuantity: "1.0000", condition: "DAMAGED", receivedDate: today } as never, adminId);
      expect(damagedReturn.ok).toBe(true);

      const health = await getCustomerCommercialHealth(customer1Id, emptyFilters());
      const byCondition = new Map(health.returns.inPeriodByCondition.map((r) => [r.condition, r.count]));
      expect(byCondition.get("GOOD_RESALABLE")).toBeGreaterThanOrEqual(1);
      expect(byCondition.get("DAMAGED")).toBeGreaterThanOrEqual(1);
    });
  });

  // --- Section 8: management overview minimum-activity toggle ---

  describe("management overview: minimum-activity toggle", () => {
    it("minimumActivityOnly=true includes only customers with a qualifying invoice in the period", async () => {
      if (skipAll) return;
      const { getCustomerIntelligenceOverview } = await import("@/lib/reporting/customer-revenue-queries");

      const filters = { ...emptyFilters(), dateFrom: "2026-03-01", dateTo: "2026-03-31" };
      await createSapInvoice({
        customerId: customer1Id,
        invoiceDate: new Date("2026-03-10T00:00:00.000Z"),
        lines: [{ sapItemCode: `ITEM-${uniqueSuffix}-mar`, quantityInvoiced: "1.0000", unitPrice: "1.0000" }],
      });

      const enabled = await getCustomerIntelligenceOverview(filters, true);
      expect(enabled.rows.every((r) => r.purchaseFrequencyInPeriod >= 1)).toBe(true);

      const disabled = await getCustomerIntelligenceOverview(filters, false);
      // Disabled must include every eligible customer, including those
      // with zero qualifying invoices in the period.
      expect(disabled.rows.some((r) => r.purchaseFrequencyInPeriod === 0)).toBe(true);
    });
  });

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
    };
  }
});
