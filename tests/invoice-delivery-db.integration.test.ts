import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Final Operational Enhancements (spec Part 5) -- the "central
 * requirement." DB-backed acceptance tests for
 * lib/invoice-delivery/record-outcome.ts and lib/invoice-delivery/
 * queries.ts against a REAL database through a REAL generated
 * @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as every other
 * *-db.integration test in this project (see docs/milestones/PROGRESS.md's
 * "Sandbox-only blocker"). Every lib touched here is imported with a
 * dynamic `await import(...)` inside the (skippable) test bodies below.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and the
 * DEMO-CUST-001 customer must exist).
 *
 * Builds its own SapInvoiceImportBatch/SapInvoice/SapInvoiceLine rows
 * directly, same pattern as tests/invoice-claims-db.integration.test.ts's
 * own createSapInvoice() helper (not duplicated via a shared module --
 * this project's established convention is one small per-file fixture
 * builder, not a shared test-fixtures module).
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Final Operational Enhancements Part 5: invoice delivery outcome recording", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  const uniqueSuffix = `delivtest-${Date.now()}`;

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
        "Skipping Final Operational Enhancements Part 5 invoice-delivery DB integration test: need an admin " +
          "user and the DEMO-CUST-001 customer. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
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
      await prisma.invoiceClaimAttachment.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.claimResolution.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaimLine.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaim.deleteMany({ where: { id: { in: createdClaimIds } } });
      await prisma.invoiceDeliveryRecord.deleteMany({ where: { id: { in: createdDeliveryRecordIds } } });
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoiceId: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoice.deleteMany({ where: { id: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { id: { in: createdImportBatchIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /** One SAP invoice with N lines, optionally with no resolved customer (to exercise the "no resolved customer" error path). */
  async function createSapInvoice(lines: { quantityInvoiced: string; unitPrice: string }[], options: { withMatchedCustomer?: boolean } = {}) {
    const { prisma } = await import("@/lib/prisma");
    const withMatchedCustomer = options.withMatchedCustomer ?? true;

    const batch = await prisma.sapInvoiceImportBatch.create({
      data: {
        originalFileName: "part5-test.csv",
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
        customerName: "Part 5 test customer (Demo)",
        matchedCustomerId: withMatchedCustomer ? customerId : null,
        invoiceDate: new Date(),
        currencyCode: "USD",
        total: lines.reduce((sum, l) => sum + Number(l.quantityInvoiced) * Number(l.unitPrice), 0).toFixed(4),
        rawSourceData: {},
        isDemo: true,
        lines: {
          create: lines.map((line, i) => ({
            lineNumber: i + 1,
            sapItemCode: `ITEM-${uniqueSuffix}-${i + 1}`,
            sapItemDescription: "Part 5 test item",
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

  it("NO_CLAIM leaves an explicit record and moves the derived status from READY_FOR_INVOICE to DELIVERED", async () => {
    if (skipAll) return;
    const { recordInvoiceDeliveryOutcome } = await import("@/lib/invoice-delivery/record-outcome");
    const { getDeliveryStatusesForInvoiceIds, getDeliveredSapInvoiceIds, getInvoiceDeliveryRecord } = await import("@/lib/invoice-delivery/queries");

    const { invoiceId } = await createSapInvoice([{ quantityInvoiced: "10.0000", unitPrice: "5.0000" }]);

    const before = await getDeliveryStatusesForInvoiceIds([invoiceId]);
    expect(before.get(invoiceId)).toBe("READY_FOR_INVOICE");

    const result = await recordInvoiceDeliveryOutcome(invoiceId, adminId, { outcome: "NO_CLAIM", podReference: "POD-001", notes: "Clean delivery" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    createdDeliveryRecordIds.push(result.id);
    expect(result.claimIds).toEqual([]);

    const after = await getDeliveryStatusesForInvoiceIds([invoiceId]);
    expect(after.get(invoiceId)).toBe("DELIVERED");

    const deliveredIds = await getDeliveredSapInvoiceIds();
    expect(deliveredIds).toContain(invoiceId);

    const detail = await getInvoiceDeliveryRecord(invoiceId);
    expect(detail).not.toBeNull();
    expect(detail!.outcome).toBe("NO_CLAIM");
    expect(detail!.podReference).toBe("POD-001");
    expect(detail!.claims).toEqual([]);

    // SAP's own reconciliationStatus is NEVER touched by this -- it stays
    // at whatever Milestone 5 itself last set it to (its own default,
    // since this test doesn't reconcile the invoice at all); "Delivered"
    // is a wholly separate, SalesFlow-only derived status that is never
    // written back onto SapInvoice as a column.
    const { prisma } = await import("@/lib/prisma");
    const sapInvoice = await prisma.sapInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { reconciliationStatus: true } });
    expect(sapInvoice.reconciliationStatus).toBe("UNMATCHED");
  });

  it("WITH_CLAIM creates the InvoiceDeliveryRecord and the claim(s) atomically, defaulting customerId from the invoice's own resolved match", async () => {
    if (skipAll) return;
    const { recordInvoiceDeliveryOutcome } = await import("@/lib/invoice-delivery/record-outcome");
    const { getInvoiceDeliveryRecord } = await import("@/lib/invoice-delivery/queries");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineIds } = await createSapInvoice([{ quantityInvoiced: "20.0000", unitPrice: "10.0000" }]);

    const result = await recordInvoiceDeliveryOutcome(invoiceId, adminId, {
      outcome: "WITH_CLAIM",
      podReference: "POD-002",
      claims: [
        {
          category: "SHORT_DELIVERY",
          description: "3 units short on delivery",
          claimDate: new Date().toISOString().slice(0, 10),
          lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "QUANTITY", acceptedQuantity: "17.0000", rejectedQuantity: "3.0000", reason: "3 short", reasonCategory: "SHORT_DELIVERY" }],
        },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    createdDeliveryRecordIds.push(result.id);
    expect(result.claimIds).toHaveLength(1);
    createdClaimIds.push(result.claimIds[0]!);

    // The claim was created WITHOUT an explicit customerId -- it must have
    // been defaulted from the invoice's own matchedCustomerId.
    const claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: result.claimIds[0]! }, select: { customerId: true, invoiceDeliveryRecordId: true } });
    expect(claim.customerId).toBe(customerId);
    expect(claim.invoiceDeliveryRecordId).toBe(result.id);

    const detail = await getInvoiceDeliveryRecord(invoiceId);
    expect(detail!.outcome).toBe("WITH_CLAIM");
    expect(detail!.claims).toHaveLength(1);
    expect(detail!.claims[0]!.id).toBe(result.claimIds[0]);
  });

  it("refuses a second delivery outcome for the same invoice (either outcome), and leaves the original untouched", async () => {
    if (skipAll) return;
    const { recordInvoiceDeliveryOutcome } = await import("@/lib/invoice-delivery/record-outcome");

    const { invoiceId } = await createSapInvoice([{ quantityInvoiced: "5.0000", unitPrice: "2.0000" }]);

    const first = await recordInvoiceDeliveryOutcome(invoiceId, adminId, { outcome: "NO_CLAIM" });
    expect(first.ok).toBe(true);
    if (first.ok) createdDeliveryRecordIds.push(first.id);

    const second = await recordInvoiceDeliveryOutcome(invoiceId, adminId, { outcome: "NO_CLAIM" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);

    const thirdAttemptAsClaim = await recordInvoiceDeliveryOutcome(invoiceId, adminId, {
      outcome: "WITH_CLAIM",
      claims: [
        {
          category: "QUALITY_ISSUE",
          description: "test",
          claimDate: new Date().toISOString().slice(0, 10),
          lines: [{ sapInvoiceLineId: "irrelevant", disputeType: "AMOUNT_ONLY", disputedAmount: "1", reason: "test" }],
        },
      ],
    });
    expect(thirdAttemptAsClaim.ok).toBe(false);
    if (!thirdAttemptAsClaim.ok) expect(thirdAttemptAsClaim.status).toBe(409);
  });

  it("WITH_CLAIM is genuinely atomic: an invalid claim line leaves NO InvoiceDeliveryRecord behind at all", async () => {
    if (skipAll) return;
    const { recordInvoiceDeliveryOutcome } = await import("@/lib/invoice-delivery/record-outcome");
    const { getInvoiceDeliveryRecord } = await import("@/lib/invoice-delivery/queries");

    const { invoiceId, lineIds } = await createSapInvoice([{ quantityInvoiced: "10.0000", unitPrice: "1.0000" }]);

    // 8 accepted + 5 rejected = 13 > 10 invoiced -- an invalid claim line.
    const failed = await recordInvoiceDeliveryOutcome(invoiceId, adminId, {
      outcome: "WITH_CLAIM",
      claims: [
        {
          category: "SHORT_DELIVERY",
          description: "Overcounted on purpose",
          claimDate: new Date().toISOString().slice(0, 10),
          lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "QUANTITY", acceptedQuantity: "8.0000", rejectedQuantity: "5.0000", reason: "test" }],
        },
      ],
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) expect(failed.status).toBe(400);

    // No InvoiceDeliveryRecord was left behind by the failed attempt --
    // the invoice is still, genuinely, "Ready for Invoice."
    const detail = await getInvoiceDeliveryRecord(invoiceId);
    expect(detail).toBeNull();

    // And the invoice can still be recorded correctly afterward -- proof
    // the failed attempt left no partial state blocking a real retry.
    const retry = await recordInvoiceDeliveryOutcome(invoiceId, adminId, { outcome: "NO_CLAIM" });
    expect(retry.ok).toBe(true);
    if (retry.ok) createdDeliveryRecordIds.push(retry.id);
  });

  it("refuses a WITH_CLAIM claim with no resolvable customer, naming customerId as the missing field", async () => {
    if (skipAll) return;
    const { recordInvoiceDeliveryOutcome } = await import("@/lib/invoice-delivery/record-outcome");
    const { getInvoiceDeliveryRecord } = await import("@/lib/invoice-delivery/queries");

    const { invoiceId, lineIds } = await createSapInvoice([{ quantityInvoiced: "4.0000", unitPrice: "1.0000" }], { withMatchedCustomer: false });

    const result = await recordInvoiceDeliveryOutcome(invoiceId, adminId, {
      outcome: "WITH_CLAIM",
      claims: [
        {
          category: "QUALITY_ISSUE",
          description: "test",
          claimDate: new Date().toISOString().slice(0, 10),
          lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "AMOUNT_ONLY", disputedAmount: "1.0000", reason: "test" }],
        },
      ],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.fieldErrors?.customerId).toBeDefined();
    }

    // Still atomic: no delivery record left behind here either.
    const detail = await getInvoiceDeliveryRecord(invoiceId);
    expect(detail).toBeNull();
  });
});
