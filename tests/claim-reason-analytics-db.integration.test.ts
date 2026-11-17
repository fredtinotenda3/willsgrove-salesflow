import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Management Analytics / Claims Standardisation spec, Part 5 and Part 8:
 * DB-backed tests for lib/invoice-claims/reason-analytics.ts's
 * getClaimReasonAnalytics -- the function that connects the 8
 * standardised claim reasons (Part 4) to analytics.
 *
 * OFF BY DEFAULT, same reason and same invocation as every other
 * *-db.integration test in this project:
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-001 customer must exist).
 *
 * Every row this test creates is marked isDemo: true and cleaned up in
 * afterAll, in FK-respecting (leaves-first) order.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Management Analytics spec Part 5: getClaimReasonAnalytics", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  const uniqueSuffix = `reasonanalytics-${Date.now()}`;

  const createdImportBatchIds: string[] = [];
  const createdSapInvoiceIds: string[] = [];
  const createdClaimIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping claim-reason-analytics DB integration test: need an admin user and the " +
          "DEMO-CUST-001 customer. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
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

  async function createSapInvoice(currencyCode: string, lines: { quantityInvoiced: string; unitPrice: string }[]) {
    const { prisma } = await import("@/lib/prisma");

    const batch = await prisma.sapInvoiceImportBatch.create({
      data: {
        originalFileName: "reason-analytics-test.csv",
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
        customerName: "TM Supermarket Borrowdale (Demo)",
        matchedCustomerId: customerId,
        invoiceDate: new Date(),
        currencyCode,
        total: lines.reduce((sum, l) => sum + Number(l.quantityInvoiced) * Number(l.unitPrice), 0).toFixed(4),
        rawSourceData: {},
        isDemo: true,
        lines: {
          create: lines.map((line, i) => ({
            lineNumber: i + 1,
            sapItemCode: `ITEM-${uniqueSuffix}-${createdSapInvoiceIds.length}-${i + 1}`,
            sapItemDescription: `Reason analytics test item ${createdSapInvoiceIds.length}-${i + 1}`,
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

    return { invoiceId: invoice.id, lineIds: invoice.lines.map((l: { id: string }) => l.id) };
  }

  it("groups claim lines into the 8 standardised reasons, never blends exposure across currencies, and separates resolved from outstanding", async () => {
    if (skipAll) return;
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { prisma } = await import("@/lib/prisma");
    const { getClaimReasonAnalytics } = await import("@/lib/invoice-claims/reason-analytics");

    const usd = await createSapInvoice("USD", [{ quantityInvoiced: "100.0000", unitPrice: "10.0000" }]);
    const zwg = await createSapInvoice("ZWG", [{ quantityInvoiced: "40.0000", unitPrice: "20.0000" }]);

    const usdClaim = await createInvoiceClaim(
      {
        sapInvoiceId: usd.invoiceId,
        customerId,
        category: "SHORT_DELIVERY",
        description: "USD claim: 10 short-delivered",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [
          {
            sapInvoiceLineId: usd.lineIds[0]!,
            disputeType: "QUANTITY",
            acceptedQuantity: "90.0000",
            rejectedQuantity: "10.0000",
            disputedUnitPrice: "10.0000",
            reason: "10 units short-delivered",
            reasonCategory: "SHORT_DELIVERY",
          },
        ],
      },
      adminId
    );
    expect(usdClaim.ok).toBe(true);
    if (!usdClaim.ok) return;
    createdClaimIds.push(usdClaim.id);

    const zwgClaim = await createInvoiceClaim(
      {
        sapInvoiceId: zwg.invoiceId,
        customerId,
        category: "SHORT_DELIVERY",
        description: "ZWG claim: 5 short-delivered",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [
          {
            sapInvoiceLineId: zwg.lineIds[0]!,
            disputeType: "QUANTITY",
            acceptedQuantity: "35.0000",
            rejectedQuantity: "5.0000",
            disputedUnitPrice: "20.0000",
            reason: "5 units short-delivered",
            reasonCategory: "SHORT_DELIVERY",
          },
        ],
      },
      adminId
    );
    expect(zwgClaim.ok).toBe(true);
    if (!zwgClaim.ok) return;
    createdClaimIds.push(zwgClaim.id);

    // Mark the USD claim's status RESOLVED directly (bypassing the
    // status-transition workflow, which is out of scope for this test)
    // so resolved/outstanding classification has something real to see.
    await prisma.invoiceClaim.update({ where: { id: usdClaim.id }, data: { status: "RESOLVED" } });

    const analytics = await getClaimReasonAnalytics({ includeDemo: true, dateFrom: null, dateTo: null, customerId: null });

    const shortDelivered = analytics.byReason.find((r) => r.reasonCategory === "SHORT_DELIVERY");
    expect(shortDelivered).toBeDefined();
    expect(shortDelivered!.label).toBe("Short Delivered");
    expect(shortDelivered!.claimLineCount).toBeGreaterThanOrEqual(2);
    expect(shortDelivered!.resolvedCount).toBeGreaterThanOrEqual(1);
    expect(shortDelivered!.outstandingCount).toBeGreaterThanOrEqual(1);

    // The core regression this test guards: USD 100 and ZWG 100 must
    // NEVER be summed into a single blended 200 -- each currency is its
    // own row.
    const usdRow = shortDelivered!.informationalExposureByCurrency.find((e) => e.currency === "USD");
    const zwgRow = shortDelivered!.informationalExposureByCurrency.find((e) => e.currency === "ZWG");
    expect(usdRow).toBeDefined();
    expect(zwgRow).toBeDefined();
    expect(Number(usdRow!.amount)).toBeGreaterThanOrEqual(100); // 10 units x $10
    expect(Number(zwgRow!.amount)).toBeGreaterThanOrEqual(100); // 5 units x 20
    // No currency appears twice as a separate row.
    const currencies = shortDelivered!.informationalExposureByCurrency.map((e) => e.currency);
    expect(new Set(currencies).size).toBe(currencies.length);
  });

  it("buckets a legacy (pre-Part-4) reasonCategory under 'Other (legacy reason)' rather than discarding it, and excludes lines with no reasonCategory at all", async () => {
    if (skipAll) return;
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { getClaimReasonAnalytics } = await import("@/lib/invoice-claims/reason-analytics");

    const invoice = await createSapInvoice("USD", [
      { quantityInvoiced: "20.0000", unitPrice: "5.0000" },
      { quantityInvoiced: "30.0000", unitPrice: "5.0000" },
    ]);

    const claim = await createInvoiceClaim(
      {
        sapInvoiceId: invoice.invoiceId,
        customerId,
        category: "OTHER",
        categoryDetail: "Mixed legacy + unspecified reasons",
        description: "One legacy-reason line, one with no reasonCategory at all",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [
          {
            sapInvoiceLineId: invoice.lineIds[0]!,
            disputeType: "QUANTITY",
            acceptedQuantity: "15.0000",
            rejectedQuantity: "5.0000",
            reason: "Never ordered this product",
            // Superseded (spec Part 4) but still a legitimate HISTORICAL
            // value -- the Prisma enum member was never removed. A real
            // row with this value could only come from before Part 4
            // shipped; constructed directly here since the current zod
            // schema rightly refuses it as new input (see
            // tests/invoice-claims.test.ts's own regression test for
            // that refusal).
            reasonCategory: "PRODUCT_NOT_ORDERED" as never,
          },
          {
            sapInvoiceLineId: invoice.lineIds[1]!,
            disputeType: "QUANTITY",
            acceptedQuantity: "25.0000",
            rejectedQuantity: "5.0000",
            reason: "No standardised reason recorded for this line",
          },
        ],
      },
      adminId
    );
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    createdClaimIds.push(claim.id);

    const analytics = await getClaimReasonAnalytics({ includeDemo: true, dateFrom: null, dateTo: null, customerId: null });

    const legacyRow = analytics.byReason.find((r) => r.reasonCategory === "__LEGACY__");
    expect(legacyRow).toBeDefined();
    expect(legacyRow!.label).toBe("Other (legacy reason)");
    expect(legacyRow!.claimLineCount).toBeGreaterThanOrEqual(1);

    // The line with NO reasonCategory must not appear anywhere, legacy
    // bucket included -- it was never classified in the first place.
    const totalAcrossReasons = analytics.byReason.reduce((sum, r) => sum + r.claimLineCount, 0);
    expect(totalAcrossReasons).toBe(analytics.totalClaimLines);
  });
});
