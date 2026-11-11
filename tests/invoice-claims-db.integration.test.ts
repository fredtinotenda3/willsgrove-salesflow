import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 6A (Invoice Claims Management). DB-backed acceptance tests
 * against a REAL database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the same reason as every other *-db.integration
 * test in this project: @prisma/client in this sandbox is a stub that
 * THROWS when merely constructed (see docs/milestones/PROGRESS.md's
 * "Sandbox-only blocker"). Every lib touched here is imported with a
 * dynamic `await import(...)` inside the (skippable) test bodies below.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-001 customer must exist).
 *
 * Builds its own SapInvoiceImportBatch/SapInvoice/SapInvoiceLine rows
 * directly (not via the Milestone 5 CSV pipeline, which is already
 * covered by tests/invoice-reconciliation-db.integration.test.ts) --
 * this file is purely about Milestone 6A's own logic on top of an
 * already-existing invoice.
 *
 * Note on role gating (same documented, accepted scope boundary as
 * every prior milestone's DB integration test, including Milestone 5's
 * spec scenario 21): createInvoiceClaim/changeClaimStatus/
 * recordClaimResolution/approveClaimResolution/rejectClaimResolution are
 * role-agnostic by design -- SALES_MANAGER/ADMINISTRATOR-only
 * enforcement for approval-weight actions lives entirely in the route
 * layer (app/api/invoice-claims/.../approve, /reject, and the inline
 * check in .../status/route.ts). This test calls the lib functions
 * directly and intentionally does not (and cannot, from here) exercise
 * that 403.
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 6A: invoice claims management", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  const uniqueSuffix = `claimtest-${Date.now()}`;

  const createdImportBatchIds: string[] = [];
  const createdSapInvoiceIds: string[] = [];
  const createdClaimIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping Milestone 6A invoice-claims DB integration test: need an admin user and the " +
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
      // Deletion order respects every onDelete: Restrict FK this
      // milestone added -- same leaves-first order as
      // scripts/remove-demo-data.ts's own Milestone 6A block.
      await prisma.invoiceClaimAttachment.deleteMany({ where: { claimId: { in: createdClaimIds } } });
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

  /** One SAP invoice with N lines, each with a known unitPrice -- built
   * directly rather than through the CSV pipeline, since this file is
   * about Milestone 6A's logic, not Milestone 5's import/matching. */
  async function createSapInvoice(lines: { quantityInvoiced: string; unitPrice: string }[]) {
    const { prisma } = await import("@/lib/prisma");

    const batch = await prisma.sapInvoiceImportBatch.create({
      data: {
        originalFileName: "6a-test.csv",
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
        currencyCode: "USD",
        total: lines.reduce((sum, l) => sum + Number(l.quantityInvoiced) * Number(l.unitPrice), 0).toFixed(4),
        rawSourceData: {},
        isDemo: true,
        lines: {
          create: lines.map((line, i) => ({
            lineNumber: i + 1,
            sapItemCode: `ITEM-${uniqueSuffix}-${i + 1}`,
            sapItemDescription: "6A test item",
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

  it("creates a claim with a quantity dispute, enforcing accepted + rejected <= invoiced (worked example: 100 invoiced, 85 accepted, 15 rejected)", async () => {
    if (skipAll) return;
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");

    const { invoiceId, lineIds } = await createSapInvoice([{ quantityInvoiced: "100.0000", unitPrice: "10.0000" }]);

    const result = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "DAMAGED_PRODUCTS",
        description: "15 units arrived damaged",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [
          {
            sapInvoiceLineId: lineIds[0]!,
            disputeType: "QUANTITY",
            acceptedQuantity: "85.0000",
            rejectedQuantity: "15.0000",
            reason: "15 units damaged on arrival, photos attached",
          },
        ],
      },
      adminId
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdClaimIds.push(result.id);
    expect(result.claimReference).toMatch(/^CLM-\d{8}-[A-F0-9]{8}$/);

    const { getClaimDetail } = await import("@/lib/invoice-claims/queries");
    const detail = await getClaimDetail(result.id);
    expect(detail?.status).toBe("OPEN");
    expect(detail?.lines).toHaveLength(1);
    expect(detail?.lines[0]?.acceptedQuantity?.toString()).toBe("85.0000");
    expect(detail?.lines[0]?.rejectedQuantity?.toString()).toBe("15.0000");
    // The original SAP invoice line's own quantityInvoiced is NEVER
    // touched by filing a claim.
    expect(detail?.lines[0]?.sapInvoiceLine.quantityInvoiced.toString()).toBe("100.0000");
  });

  it("rejects a second claim against the same invoice line once the remaining quantity is exhausted (live aggregate across claims, not per-claim)", async () => {
    if (skipAll) return;
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");

    const { invoiceId, lineIds } = await createSapInvoice([{ quantityInvoiced: "50.0000", unitPrice: "5.0000" }]);

    const first = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "SHORT_DELIVERY",
        description: "First claim: 40 units short",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "QUANTITY", acceptedQuantity: "10.0000", rejectedQuantity: "40.0000", reason: "Short delivery" }],
      },
      adminId
    );
    expect(first.ok).toBe(true);
    if (first.ok) createdClaimIds.push(first.id);

    // Only 0 remains available (10 accepted + 40 rejected == 50 invoiced)
    // -- a second claim disputing even 1 more unit must fail.
    const second = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "QUALITY_ISSUE",
        description: "Second claim: found more damage later",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "QUANTITY", acceptedQuantity: "0.0000", rejectedQuantity: "1.0000", reason: "Additional damage noticed" }],
      },
      adminId
    );
    expect(second.ok).toBe(false);
  });

  it("supports an amount-only (pricing) dispute with no quantity involved", async () => {
    if (skipAll) return;
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");

    const { invoiceId, lineIds } = await createSapInvoice([{ quantityInvoiced: "20.0000", unitPrice: "15.0000" }]);

    const result = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "PRICING_DISPUTE",
        description: "Invoiced at the wrong price list",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "AMOUNT_ONLY", disputedAmount: "25.0000", reason: "Price should have been the contract rate" }],
      },
      adminId
    );

    expect(result.ok).toBe(true);
    if (result.ok) createdClaimIds.push(result.id);
  });

  it("full lifecycle: record a resolution (recommendation only, not an executed action), reject it, record another, then approve it -- status moves exactly per the structural mapping", async () => {
    if (skipAll) return;
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { recordClaimResolution, rejectClaimResolution, approveClaimResolution } = await import("@/lib/invoice-claims/claim-resolution");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineIds } = await createSapInvoice([{ quantityInvoiced: "30.0000", unitPrice: "8.0000" }]);

    const created = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "QUALITY_ISSUE",
        description: "Quality complaint",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "QUANTITY", acceptedQuantity: "20.0000", rejectedQuantity: "10.0000", reason: "Spoiled stock" }],
      },
      adminId
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdClaimIds.push(created.id);

    // Recording a resolution moves the claim to AWAITING_INTERNAL_ACTION
    // -- never straight to an approval-weight status.
    const firstResolution = await recordClaimResolution(created.id, { decision: "FULL_CREDIT_RECOMMENDED", findings: "Confirmed spoiled on arrival" }, adminId);
    expect(firstResolution.ok).toBe(true);
    if (!firstResolution.ok) return;

    let claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: created.id } });
    expect(claim.status).toBe("AWAITING_INTERNAL_ACTION");

    // A manager rejects this specific recommendation -- the claim's
    // status does NOT change by itself from a rejection alone.
    const rejected = await rejectClaimResolution(created.id, firstResolution.id, "Need more evidence before recommending a full credit", adminId);
    expect(rejected.ok).toBe(true);

    claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: created.id } });
    expect(claim.status).toBe("AWAITING_INTERNAL_ACTION");

    // Cannot approve an already-rejected resolution.
    const cannotApprove = await approveClaimResolution(created.id, firstResolution.id, undefined, adminId);
    expect(cannotApprove.ok).toBe(false);

    // Record a second, better-supported resolution and approve THAT one.
    const secondResolution = await recordClaimResolution(created.id, { decision: "PARTIAL_CREDIT_RECOMMENDED", findings: "Confirmed with photos this time" }, adminId);
    expect(secondResolution.ok).toBe(true);
    if (!secondResolution.ok) return;

    const approved = await approveClaimResolution(created.id, secondResolution.id, "80.0000", adminId);
    expect(approved.ok).toBe(true);
    if (approved.ok) {
      // PARTIAL_CREDIT_RECOMMENDED maps to APPROVED.
      expect(approved.claimStatus).toBe("APPROVED");
    }

    claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: created.id } });
    expect(claim.status).toBe("APPROVED");

    const resolution = await prisma.claimResolution.findUniqueOrThrow({ where: { id: secondResolution.id } });
    expect(resolution.approvedById).toBe(adminId);
    expect(resolution.approvedCreditAmount?.toString()).toBe("80.0000");

    // The first, rejected resolution is STILL visible -- append-only
    // history, nothing is ever hidden or deleted.
    const firstStillThere = await prisma.claimResolution.findUnique({ where: { id: firstResolution.id } });
    expect(firstStillThere).not.toBeNull();
    expect(firstStillThere?.rejectedById).toBe(adminId);
  });

  it("changeClaimStatus enforces the transition graph directly (e.g. cannot jump from OPEN to RESOLVED)", async () => {
    if (skipAll) return;
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { changeClaimStatus } = await import("@/lib/invoice-claims/claim-lifecycle");

    const { invoiceId, lineIds } = await createSapInvoice([{ quantityInvoiced: "10.0000", unitPrice: "1.0000" }]);
    const created = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "OTHER",
        categoryDetail: "Miscellaneous complaint",
        description: "Testing status transitions",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "AMOUNT_ONLY", disputedAmount: "5.0000", reason: "Test" }],
      },
      adminId
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdClaimIds.push(created.id);

    const invalid = await changeClaimStatus(created.id, "RESOLVED", "trying to skip ahead", adminId, "SALESPERSON");
    expect(invalid.ok).toBe(false);

    const valid = await changeClaimStatus(created.id, "UNDER_INVESTIGATION", "starting investigation", adminId, "SALESPERSON");
    expect(valid.ok).toBe(true);
  });

  it("financial summary distinguishes claimed value from approved credit exposure and never fabricates an actual SAP-credited amount", async () => {
    if (skipAll) return;
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { computeClaimFinancialSummary } = await import("@/lib/invoice-claims/financial");

    const { invoiceId, lineIds } = await createSapInvoice([{ quantityInvoiced: "40.0000", unitPrice: "2.5000" }]);
    const created = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "WRONG_PRODUCT_SUPPLIED",
        description: "Wrong SKU delivered",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ sapInvoiceLineId: lineIds[0]!, disputeType: "QUANTITY", acceptedQuantity: "0.0000", rejectedQuantity: "40.0000", reason: "Entirely the wrong product" }],
      },
      adminId
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdClaimIds.push(created.id);

    const summary = await computeClaimFinancialSummary(created.id);
    expect(summary).not.toBeNull();
    // 40 units * 2.50 unit price = 100.00 claimed value.
    expect(summary?.claimedValue).toBe("100.0000");
    expect(summary?.approvedCreditExposure).toBe("0.0000");
    // Milestone 6B: actualSapCreditedAmount is now a live sum of real
    // CreditNote rows (never an estimate) -- "0.0000" here because none
    // has been recorded against this claim, not because the capability is
    // unavailable. See tests/returns-credits-db.integration.test.ts for
    // the case where a real CreditNote has been recorded.
    expect(summary?.actualSapCreditedAmount).toBe("0.0000");
    expect(summary?.actualCreditDataAvailable).toBe(true);
    expect(summary?.actualCreditShortfall).toBe("0.0000");
    expect(summary?.actualExceedsApproved).toBe(false);
  });
});
