import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { InvoiceColumnMapping } from "@/lib/invoice-reconciliation/csv";

/**
 * Milestone 5 (SAP Invoice Reconciliation). DB-backed acceptance tests
 * for the full invoice-reconciliation lifecycle -- CSV import, customer/
 * order/item-code matching, quantity reconciliation, over-invoicing and
 * cancelled-invoice handling, manual reconciliation, audit history, and
 * reports -- against a REAL database through a REAL generated
 * @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as
 * tests/lost-sales-db.integration.test.ts and
 * tests/picking-db.integration.test.ts: @prisma/client in this sandbox is
 * a stub that THROWS when merely constructed (see docs/milestones/
 * PROGRESS.md's "Sandbox-only blocker"). Every lib touched here is
 * imported with a dynamic `await import(...)` INSIDE the (skippable)
 * test bodies below, never a static top-of-file import -- except the
 * InvoiceColumnMapping *type*, which is erased at compile time and
 * carries no @prisma/client dependency.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-001 customer, sapCustomerCode "DEMO-CUST-001", must exist).
 *
 * Note on role gating (spec test scenario 21): exactly like every other
 * role-gated action in this project, manuallyMatchInvoiceLine /
 * markInvoiceLineCannotLink / reopenInvoiceLineMatch /
 * setInvoiceReconciliationNote are role-agnostic by design --
 * SALES_MANAGER/ADMINISTRATOR-only enforcement lives entirely in
 * app/api/invoice-reconciliation/lines/[id]/*'s and
 * app/api/invoice-reconciliation/[id]/note's requireUserOrResponse(...)
 * calls. This test calls the lib functions directly, so it intentionally
 * does not (and cannot, from here) exercise that 403 -- the same
 * pre-existing, documented, accepted scope boundary noted in
 * tests/lost-sales-db.integration.test.ts (no route handler anywhere in
 * this codebase has its own dedicated unit test).
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

const HEADER =
  "DocEntry,DocNum,CardCode,CardName,DocDate,DocCur,DocStatus,NumAtCard,DocTotalBeforeDisc,VatSum,DocTotal,LineNum,ItemCode,Dscription,Quantity,UomCode,Price,DiscPrcnt,VatGroup,LineTotal";

const MAPPING: InvoiceColumnMapping = {
  docEntry: "DocEntry",
  docNum: "DocNum",
  customerCode: "CardCode",
  customerName: "CardName",
  invoiceDate: "DocDate",
  currency: "DocCur",
  documentStatus: "DocStatus",
  orderReference: "NumAtCard",
  subtotal: "DocTotalBeforeDisc",
  taxTotal: "VatSum",
  total: "DocTotal",
  lineNumber: "LineNum",
  itemCode: "ItemCode",
  itemDescription: "Dscription",
  quantity: "Quantity",
  unitOfMeasure: "UomCode",
  unitPrice: "Price",
  discount: "DiscPrcnt",
  taxCode: "VatGroup",
  lineTotal: "LineTotal",
  docLineNum: "LineNum",
};

function row(fields: Record<string, string>): string {
  return HEADER.split(",").map((h) => fields[h] ?? "").join(",");
}

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 5: SAP invoice reconciliation", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  const uniqueSuffix = `inttest-${Date.now()}`;

  const createdOrderIds: string[] = [];
  const createdImportBatchIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping Milestone 5 invoice-reconciliation DB integration test: need an admin user and the " +
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
      // milestone added -- SapInvoiceLine before SapInvoice before
      // SapInvoiceImportBatch, and all three before orderLines/orders,
      // same ordering as scripts/remove-demo-data.ts.
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoice: { importBatchId: { in: createdImportBatchIds } } } });
      await prisma.sapInvoice.deleteMany({ where: { importBatchId: { in: createdImportBatchIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { id: { in: createdImportBatchIds } } });
      await prisma.pickingSession.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      // AuditEvent is deliberately left alone -- append-only by this
      // project's own convention, same reasoning as
      // tests/lost-sales-db.integration.test.ts's afterAll.
      await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  type LineSpec = { sapItemCode: string; requestedQty: string; foundQty: string };

  /** One authorized order with N lines, each carrying a known SAP item
   * code (via sapItemCodeSnapshot -- no Product row needed, matching
   * only ever needs the code, per spec section 4) and a known authorized
   * (found) quantity. */
  async function createAuthorizedOrder(lines: LineSpec[], customerPoReference?: string) {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        currency: "USD",
        customerPoReference: customerPoReference ?? null,
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: lines.map((line, i) => ({
            lineNumber: i + 1,
            originalProductDescription: `Invoice-reconciliation test item ${line.sapItemCode}`,
            sapItemCodeSnapshot: line.sapItemCode,
            requestedQuantity: line.requestedQty,
            requestedUnitCode: "EA",
            isDemo: true,
          })),
        },
      },
      select: { id: true, reference: true, lines: { select: { id: true, lineNumber: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdOrderIds.push(order.id);

    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);

    for (let i = 0; i < lines.length; i++) {
      const spec = lines[i]!;
      const orderLine = order.lines[i]!;
      const requested = Number(spec.requestedQty);
      const found = Number(spec.foundQty);
      const unavailable = (requested - found).toFixed(4);
      await recordPickedLine(started.session.id, orderLine.id, spec.foundQty, unavailable, undefined, adminId);
    }

    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    return { orderId: order.id, orderReference: order.reference, lineIds: order.lines.map((l) => l.id) };
  }

  async function importCsv(rows: string[]) {
    const { applyColumnMapping, groupIntoInvoices } = await import("@/lib/invoice-reconciliation/csv");
    const { planSapInvoiceImport } = await import("@/lib/invoice-reconciliation/plan-import");
    const { executeSapInvoiceImport } = await import("@/lib/invoice-reconciliation/execute-import");

    const csvText = [HEADER, ...rows].join("\n");
    const { rows: mapped, errors } = applyColumnMapping(csvText, MAPPING);
    const groups = groupIntoInvoices(mapped);
    const plan = await planSapInvoiceImport(groups, errors.length);
    const result = await executeSapInvoiceImport(plan, MAPPING, "test-import.csv", adminId);
    createdImportBatchIds.push(result.importBatchId);
    return { plan, result, invalidRowCount: errors.length };
  }

  it("scenarios 1/5/6/8/16/19: valid import resolves the customer, matches the order by SAP item code, fully reconciles a decimal quantity, and records an audit event", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { getSapInvoiceDetail } = await import("@/lib/invoice-reconciliation/queries");

    const itemCode = `ITEM-${uniqueSuffix}-A`;
    const { orderId, lineIds } = await createAuthorizedOrder([{ sapItemCode: itemCode, requestedQty: "20.1234", foundQty: "20.1234" }]);

    const { plan, result } = await importCsv([
      row({
        DocEntry: `${uniqueSuffix}-1`,
        DocNum: `INV-${uniqueSuffix}-1`,
        CardCode: "DEMO-CUST-001",
        CardName: "TM Supermarket Borrowdale (Demo)",
        DocStatus: "Open",
        ItemCode: itemCode,
        Quantity: "20.1234",
        LineNum: "0",
      }),
    ]);

    expect(plan.newInvoices).toHaveLength(1);
    expect(plan.duplicateInvoices).toHaveLength(0);
    expect(result.importedInvoiceCount).toBe(1);
    expect(result.importedLineCount).toBe(1);
    expect(result.autoMatchedLineCount).toBe(1);
    expect(result.overInvoicingFlaggedCount).toBe(0);

    const invoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-1` } });
    expect(invoice.matchedCustomerId).toBe(customerId);
    expect(invoice.matchedOrderId).toBe(orderId);
    expect(invoice.reconciliationStatus).toBe("MATCHED");

    const detail = await getSapInvoiceDetail(invoice.id);
    expect(detail?.lines).toHaveLength(1);
    expect(detail?.lines[0]?.matchedOrderLineId).toBe(lineIds[0]);
    expect(detail?.lines[0]?.authorizedQuantity).toBe("20.1234");
    expect(detail?.lines[0]?.invoicedQuantity).toBe("20.1234");
    expect(detail?.lines[0]?.remainingQuantity).toBe("0.0000");
    expect(detail?.lines[0]?.orderLineStatus).toBe("FULLY_INVOICED");

    const auditEvents = await prisma.auditEvent.findMany({ where: { action: "SAP_INVOICE_IMPORT", entityId: result.importBatchId } });
    expect(auditEvents).toHaveLength(1);
  });

  it("scenarios 3/4: a second import of the same invoice is detected as a duplicate and never double-imported", async () => {
    if (skipAll) return;
    const itemCode = `ITEM-${uniqueSuffix}-B1`;
    const { orderId } = await createAuthorizedOrder([{ sapItemCode: itemCode, requestedQty: "5.0000", foundQty: "5.0000" }]);
    void orderId;

    const docRow = row({
      DocEntry: `${uniqueSuffix}-dup`,
      DocNum: `INV-${uniqueSuffix}-dup`,
      CardCode: "DEMO-CUST-001",
      ItemCode: itemCode,
      Quantity: "5.0000",
      LineNum: "0",
    });

    const first = await importCsv([docRow]);
    expect(first.result.importedInvoiceCount).toBe(1);

    // Re-plan the exact same file -- never executed, same "preview never
    // writes" shape, so this is a pure duplicate-detection check.
    const { applyColumnMapping, groupIntoInvoices } = await import("@/lib/invoice-reconciliation/csv");
    const { planSapInvoiceImport } = await import("@/lib/invoice-reconciliation/plan-import");
    const { rows: mapped } = applyColumnMapping([HEADER, docRow].join("\n"), MAPPING);
    const secondPlan = await planSapInvoiceImport(groupIntoInvoices(mapped), 0);

    expect(secondPlan.newInvoices).toHaveLength(0);
    expect(secondPlan.duplicateInvoices).toHaveLength(1);
    expect(secondPlan.duplicateInvoices[0]?.reason).toMatch(/already been imported/);

    // executeSapInvoiceImport only ever writes plan.newInvoices, so
    // running it against this (empty) plan creates nothing new.
    const { executeSapInvoiceImport } = await import("@/lib/invoice-reconciliation/execute-import");
    const secondResult = await executeSapInvoiceImport(secondPlan, MAPPING, "dup.csv", adminId);
    createdImportBatchIds.push(secondResult.importBatchId);
    expect(secondResult.importedInvoiceCount).toBe(0);

    const { prisma } = await import("@/lib/prisma");
    const count = await prisma.sapInvoice.count({ where: { sapDocNum: `INV-${uniqueSuffix}-dup` } });
    expect(count).toBe(1);
  });

  it("scenarios 9/10/13: an order line moves from awaiting invoicing, to partially invoiced, to fully invoiced across two separate invoices", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { getSapInvoiceDetail } = await import("@/lib/invoice-reconciliation/queries");

    const itemCode = `ITEM-${uniqueSuffix}-C`;
    const { lineIds } = await createAuthorizedOrder([{ sapItemCode: itemCode, requestedQty: "20.0000", foundQty: "20.0000" }]);

    // Before any invoice, this order line awaits invoicing (scenario 10 --
    // asserted indirectly via the reports test below, which reads this
    // same fixture before its first import would need a separate order;
    // here we assert directly off the two invoices' own effect.)

    const firstImport = await importCsv([
      row({ DocEntry: `${uniqueSuffix}-9a`, DocNum: `INV-${uniqueSuffix}-9a`, CardCode: "DEMO-CUST-001", ItemCode: itemCode, Quantity: "12.0000", LineNum: "0" }),
    ]);
    expect(firstImport.result.autoMatchedLineCount).toBe(1);

    const invoiceA = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-9a` } });
    const detailA = await getSapInvoiceDetail(invoiceA.id);
    expect(detailA?.lines[0]?.matchedOrderLineId).toBe(lineIds[0]);
    expect(detailA?.lines[0]?.invoicedQuantity).toBe("12.0000");
    expect(detailA?.lines[0]?.remainingQuantity).toBe("8.0000");
    expect(detailA?.lines[0]?.orderLineStatus).toBe("PARTIALLY_INVOICED");

    const secondImport = await importCsv([
      row({ DocEntry: `${uniqueSuffix}-9b`, DocNum: `INV-${uniqueSuffix}-9b`, CardCode: "DEMO-CUST-001", ItemCode: itemCode, Quantity: "8.0000", LineNum: "0" }),
    ]);
    expect(secondImport.result.autoMatchedLineCount).toBe(1);
    expect(secondImport.result.overInvoicingFlaggedCount).toBe(0);

    const invoiceB = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-9b` } });
    const detailB = await getSapInvoiceDetail(invoiceB.id);
    expect(detailB?.lines[0]?.invoicedQuantity).toBe("20.0000"); // cumulative across both invoices
    expect(detailB?.lines[0]?.remainingQuantity).toBe("0.0000");
    expect(detailB?.lines[0]?.orderLineStatus).toBe("FULLY_INVOICED");
  });

  it("scenario 11: invoicing more than the authorized quantity is recorded, not refused, and flags the invoice for reconciliation", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { getSapInvoiceDetail } = await import("@/lib/invoice-reconciliation/queries");

    const itemCode = `ITEM-${uniqueSuffix}-D`;
    const { lineIds } = await createAuthorizedOrder([{ sapItemCode: itemCode, requestedQty: "20.0000", foundQty: "20.0000" }]);

    const { result } = await importCsv([
      row({ DocEntry: `${uniqueSuffix}-11`, DocNum: `INV-${uniqueSuffix}-11`, CardCode: "DEMO-CUST-001", ItemCode: itemCode, Quantity: "23.0000", LineNum: "0" }),
    ]);
    expect(result.autoMatchedLineCount).toBe(1);
    expect(result.overInvoicingFlaggedCount).toBe(1);

    const invoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-11` } });
    expect(invoice.reconciliationStatus).toBe("RECONCILIATION_REQUIRED");

    const detail = await getSapInvoiceDetail(invoice.id);
    expect(detail?.lines[0]?.matchedOrderLineId).toBe(lineIds[0]);
    expect(detail?.lines[0]?.invoicedQuantity).toBe("23.0000");
    expect(detail?.lines[0]?.remainingQuantity).toBe("-3.0000"); // never clamped to zero
    expect(detail?.lines[0]?.orderLineStatus).toBe("OVER_INVOICED");
  });

  it("scenario 12: an invoice for an unrecognized customer code, with no matching item, stays an unmatched SAP invoice", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");

    const { result } = await importCsv([
      row({
        DocEntry: `${uniqueSuffix}-12`,
        DocNum: `INV-${uniqueSuffix}-12`,
        CardCode: `NO-SUCH-CODE-${uniqueSuffix}`,
        ItemCode: `ITEM-${uniqueSuffix}-NOPE`,
        Quantity: "1.0000",
        LineNum: "0",
      }),
    ]);
    expect(result.unmatchedCustomerCodes).toContain(`NO-SUCH-CODE-${uniqueSuffix}`);
    expect(result.autoMatchedLineCount).toBe(0);

    const invoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-12` } });
    expect(invoice.matchedCustomerId).toBeNull();
    expect(invoice.reconciliationStatus).toBe("UNMATCHED");
  });

  it("scenario 14 (same order): two lines on one invoice, matching two different order lines of the SAME order", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");

    const itemC = `ITEM-${uniqueSuffix}-E1`;
    const itemD = `ITEM-${uniqueSuffix}-E2`;
    const { orderId } = await createAuthorizedOrder([
      { sapItemCode: itemC, requestedQty: "10.0000", foundQty: "10.0000" },
      { sapItemCode: itemD, requestedQty: "5.0000", foundQty: "5.0000" },
    ]);

    const { result } = await importCsv([
      row({ DocEntry: `${uniqueSuffix}-14a`, DocNum: `INV-${uniqueSuffix}-14a`, CardCode: "DEMO-CUST-001", ItemCode: itemC, Quantity: "10.0000", LineNum: "0" }),
      row({ DocEntry: `${uniqueSuffix}-14a`, DocNum: `INV-${uniqueSuffix}-14a`, CardCode: "DEMO-CUST-001", ItemCode: itemD, Quantity: "5.0000", LineNum: "1" }),
    ]);
    expect(result.autoMatchedLineCount).toBe(2);

    const invoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-14a` } });
    expect(invoice.matchedOrderId).toBe(orderId); // both lines agreed on the same order
    expect(invoice.reconciliationStatus).toBe("MATCHED");
  });

  it("scenario 14 (multiple orders, spec section 4): one invoice's lines can belong to different SalesFlow orders", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");

    const itemE = `ITEM-${uniqueSuffix}-F1`;
    const itemF = `ITEM-${uniqueSuffix}-F2`;
    const orderA = await createAuthorizedOrder([{ sapItemCode: itemE, requestedQty: "10.0000", foundQty: "10.0000" }]);
    const orderB = await createAuthorizedOrder([{ sapItemCode: itemF, requestedQty: "5.0000", foundQty: "5.0000" }]);

    const { result } = await importCsv([
      row({ DocEntry: `${uniqueSuffix}-14b`, DocNum: `INV-${uniqueSuffix}-14b`, CardCode: "DEMO-CUST-001", ItemCode: itemE, Quantity: "10.0000", LineNum: "0" }),
      row({ DocEntry: `${uniqueSuffix}-14b`, DocNum: `INV-${uniqueSuffix}-14b`, CardCode: "DEMO-CUST-001", ItemCode: itemF, Quantity: "5.0000", LineNum: "1" }),
    ]);
    expect(result.autoMatchedLineCount).toBe(2);

    const invoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-14b` } });
    // Lines disagree on the order -> the header-level convenience field
    // stays null; the line-level matches remain the authoritative record.
    expect(invoice.matchedOrderId).toBeNull();

    const lines = await prisma.sapInvoiceLine.findMany({ where: { sapInvoiceId: invoice.id }, orderBy: { lineNumber: "asc" } });
    expect(lines[0]?.matchedOrderId).toBe(orderA.orderId);
    expect(lines[1]?.matchedOrderId).toBe(orderB.orderId);
  });

  it("scenarios 15/16: an ambiguous match is left for manual reconciliation, resolved by hand, reopened, and fully audited", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { manuallyMatchInvoiceLine, reopenInvoiceLineMatch, markInvoiceLineCannotLink, rerunAutoMatchForInvoice } = await import(
      "@/lib/invoice-reconciliation/manual-actions"
    );
    const { getCandidateOrderLinesForCustomer } = await import("@/lib/invoice-reconciliation/queries");

    const ambiguousCode = `ITEM-${uniqueSuffix}-AMBIG`;
    const orderA = await createAuthorizedOrder([{ sapItemCode: ambiguousCode, requestedQty: "10.0000", foundQty: "10.0000" }]);
    // A second order with the same SAP item code is what makes the match
    // ambiguous (two qualifying candidates) -- its id is never referenced
    // again, only its existence matters.
    await createAuthorizedOrder([{ sapItemCode: ambiguousCode, requestedQty: "10.0000", foundQty: "10.0000" }]);

    const { result } = await importCsv([
      row({ DocEntry: `${uniqueSuffix}-15`, DocNum: `INV-${uniqueSuffix}-15`, CardCode: "DEMO-CUST-001", ItemCode: ambiguousCode, Quantity: "5.0000", LineNum: "0" }),
    ]);
    expect(result.autoMatchedLineCount).toBe(0); // ambiguous -- two qualifying order lines, never guessed

    const invoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-15` } });
    expect(invoice.reconciliationStatus).toBe("UNMATCHED");
    const line = await prisma.sapInvoiceLine.findFirstOrThrow({ where: { sapInvoiceId: invoice.id } });
    expect(line.matchStatus).toBe("UNMATCHED");

    // Re-running the automatic matcher does not force a guess either.
    await rerunAutoMatchForInvoice(invoice.id, adminId);
    const stillUnmatched = await prisma.sapInvoiceLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(stillUnmatched.matchStatus).toBe("UNMATCHED");

    // The candidate picker surfaces both outstanding order lines.
    const candidates = await getCandidateOrderLinesForCustomer(customerId);
    const matchingCandidates = candidates.filter((c) => c.sapItemCodeSnapshot === ambiguousCode);
    expect(matchingCandidates.length).toBeGreaterThanOrEqual(2);

    // A human resolves it manually, choosing order A.
    const matchResult = await manuallyMatchInvoiceLine(line.id, orderA.orderId, orderA.lineIds[0]!, adminId, "Confirmed with customer: this is the Borrowdale order.");
    expect(matchResult.ok).toBe(true);

    const afterManualMatch = await prisma.sapInvoiceLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(afterManualMatch.matchStatus).toBe("MANUALLY_MATCHED");
    expect(afterManualMatch.matchedOrderLineId).toBe(orderA.lineIds[0]);
    const invoiceAfterManualMatch = await prisma.sapInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(invoiceAfterManualMatch.reconciliationStatus).toBe("MATCHED");

    // Reopen it -- the undo step before a corrected decision.
    const reopenResult = await reopenInvoiceLineMatch(line.id, adminId, "Wrong order picked -- re-checking with customer.");
    expect(reopenResult.ok).toBe(true);
    const afterReopen = await prisma.sapInvoiceLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(afterReopen.matchStatus).toBe("UNMATCHED");
    expect(afterReopen.matchedOrderLineId).toBeNull();

    // This time, mark it as having nothing to do with SalesFlow.
    const cannotLinkResult = await markInvoiceLineCannotLink(line.id, adminId, "This was a cash walk-in sale, unrelated to any SalesFlow order.");
    expect(cannotLinkResult.ok).toBe(true);
    const afterCannotLink = await prisma.sapInvoiceLine.findUniqueOrThrow({ where: { id: line.id } });
    expect(afterCannotLink.matchStatus).toBe("CANNOT_LINK");
    const invoiceAfterCannotLink = await prisma.sapInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(invoiceAfterCannotLink.reconciliationStatus).toBe("MATCHED"); // resolved (CANNOT_LINK counts as resolved), nothing left open

    // Scenario 16: every manual decision left a full audit trail with
    // before/after snapshots -- never silently overwritten.
    const auditEvents = await prisma.auditEvent.findMany({
      where: { entityType: "SapInvoiceLine", entityId: line.id },
      orderBy: { createdAt: "asc" },
    });
    expect(auditEvents.map((e) => e.action)).toEqual([
      "SAP_INVOICE_LINE_MANUAL_MATCH",
      "SAP_INVOICE_LINE_REOPENED",
      "SAP_INVOICE_LINE_CANNOT_LINK",
    ]);
    expect(auditEvents[0]?.beforeData).toMatchObject({ matchStatus: "UNMATCHED" });
    expect(auditEvents[0]?.afterData).toMatchObject({ matchStatus: "MANUALLY_MATCHED" });
  });

  it("scenario 17: a cancelled/reversed invoice is flagged but its quantity never counts toward a valid invoiced total", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { getSapInvoiceDetail } = await import("@/lib/invoice-reconciliation/queries");

    const itemCode = `ITEM-${uniqueSuffix}-G`;
    const { lineIds } = await createAuthorizedOrder([{ sapItemCode: itemCode, requestedQty: "10.0000", foundQty: "10.0000" }]);

    // A cancelled invoice is still matched for traceability (so a human
    // can see what it would have been), but flagged CANCELLED_REVERSED.
    const cancelledImport = await importCsv([
      row({ DocEntry: `${uniqueSuffix}-17a`, DocNum: `INV-${uniqueSuffix}-17a`, CardCode: "DEMO-CUST-001", DocStatus: "Cancelled", ItemCode: itemCode, Quantity: "10.0000", LineNum: "0" }),
    ]);
    expect(cancelledImport.result.autoMatchedLineCount).toBe(1);
    const cancelledInvoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-17a` } });
    expect(cancelledInvoice.isCancelledOrReversed).toBe(true);
    expect(cancelledInvoice.reconciliationStatus).toBe("CANCELLED_REVERSED");

    // A second, active invoice for the SAME quantity fully invoices the
    // line -- only possible because the cancelled invoice's 10 units were
    // excluded from the running total it was matched against.
    const activeImport = await importCsv([
      row({ DocEntry: `${uniqueSuffix}-17b`, DocNum: `INV-${uniqueSuffix}-17b`, CardCode: "DEMO-CUST-001", DocStatus: "Open", ItemCode: itemCode, Quantity: "10.0000", LineNum: "0" }),
    ]);
    expect(activeImport.result.autoMatchedLineCount).toBe(1);
    expect(activeImport.result.overInvoicingFlaggedCount).toBe(0);

    const activeInvoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-17b` } });
    expect(activeInvoice.reconciliationStatus).toBe("MATCHED");

    const detail = await getSapInvoiceDetail(activeInvoice.id);
    expect(detail?.lines[0]?.matchedOrderLineId).toBe(lineIds[0]);
    expect(detail?.lines[0]?.invoicedQuantity).toBe("10.0000"); // not 20 -- the cancelled invoice's quantity is excluded
    expect(detail?.lines[0]?.orderLineStatus).toBe("FULLY_INVOICED");
  });

  it("scenario 18: invoices in different currencies for the same customer are kept distinct, never summed together", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");

    const itemUsd = `ITEM-${uniqueSuffix}-H1`;
    const itemZwg = `ITEM-${uniqueSuffix}-H2`;
    await createAuthorizedOrder([{ sapItemCode: itemUsd, requestedQty: "1.0000", foundQty: "1.0000" }]);
    await createAuthorizedOrder([{ sapItemCode: itemZwg, requestedQty: "1.0000", foundQty: "1.0000" }]);

    await importCsv([
      row({ DocEntry: `${uniqueSuffix}-18a`, DocNum: `INV-${uniqueSuffix}-18a`, CardCode: "DEMO-CUST-001", DocCur: "USD", ItemCode: itemUsd, Quantity: "1.0000", DocTotal: "100.0000", LineNum: "0" }),
      row({ DocEntry: `${uniqueSuffix}-18b`, DocNum: `INV-${uniqueSuffix}-18b`, CardCode: "DEMO-CUST-001", DocCur: "ZWG", ItemCode: itemZwg, Quantity: "1.0000", DocTotal: "5000.0000", LineNum: "0" }),
    ]);

    const usdInvoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-18a` } });
    const zwgInvoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-18b` } });
    expect(usdInvoice.currencyCode).toBe("USD");
    expect(usdInvoice.total?.toString()).toBe("100.0000");
    expect(zwgInvoice.currencyCode).toBe("ZWG");
    expect(zwgInvoice.total?.toString()).toBe("5000.0000");
    // No function anywhere in this module adds these together -- each
    // invoice's total is read and reported independently (spec section
    // 8: "keep financial amounts separate by currency").
  });

  it("scenario 20: importing and reconciling invoices never modifies the original CustomerOrder/OrderLine/PickingLine rows", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { manuallyMatchInvoiceLine } = await import("@/lib/invoice-reconciliation/manual-actions");

    const itemCode = `ITEM-${uniqueSuffix}-I`;
    const { orderId, lineIds } = await createAuthorizedOrder([{ sapItemCode: itemCode, requestedQty: "4.0000", foundQty: "4.0000" }]);

    const orderBefore = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    const lineBefore = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineIds[0]! } });
    const pickingLineBefore = await prisma.pickingLine.findFirstOrThrow({ where: { orderLineId: lineIds[0]! } });

    // Import a line that will stay ambiguous (two orders, same code) so
    // we can also exercise a manual match without it auto-resolving.
    const otherOrder = await createAuthorizedOrder([{ sapItemCode: itemCode, requestedQty: "4.0000", foundQty: "4.0000" }]);
    await importCsv([
      row({ DocEntry: `${uniqueSuffix}-20`, DocNum: `INV-${uniqueSuffix}-20`, CardCode: "DEMO-CUST-001", ItemCode: itemCode, Quantity: "4.0000", LineNum: "0" }),
    ]);
    const invoice = await prisma.sapInvoice.findFirstOrThrow({ where: { sapDocNum: `INV-${uniqueSuffix}-20` } });
    const line = await prisma.sapInvoiceLine.findFirstOrThrow({ where: { sapInvoiceId: invoice.id } });
    await manuallyMatchInvoiceLine(line.id, orderId, lineIds[0]!, adminId, "Manual resolution for protection-of-original-records test.");
    void otherOrder;

    const orderAfter = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    const lineAfter = await prisma.orderLine.findUniqueOrThrow({ where: { id: lineIds[0]! } });
    const pickingLineAfter = await prisma.pickingLine.findFirstOrThrow({ where: { orderLineId: lineIds[0]! } });

    expect(orderAfter.reference).toBe(orderBefore.reference);
    expect(orderAfter.status).toBe(orderBefore.status);
    expect(lineAfter.requestedQuantity.toString()).toBe(lineBefore.requestedQuantity.toString());
    expect(lineAfter.originalProductDescription).toBe(lineBefore.originalProductDescription);
    expect(lineAfter.sapItemCodeSnapshot).toBe(lineBefore.sapItemCodeSnapshot);
    expect(pickingLineAfter.foundQuantity?.toString()).toBe(pickingLineBefore.foundQuantity?.toString());
    expect(pickingLineAfter.requestedQuantity.toString()).toBe(pickingLineBefore.requestedQuantity.toString());
  });

  it("scenario 22: the reconciliation reports place each order line and invoice in the correct bucket", async () => {
    if (skipAll) return;
    const { getInvoiceReconciliationReports } = await import("@/lib/invoice-reconciliation/queries");

    const awaitingCode = `ITEM-${uniqueSuffix}-J`;
    const { orderId: awaitingOrderId, lineIds: awaitingLineIds } = await createAuthorizedOrder([
      { sapItemCode: awaitingCode, requestedQty: "9.0000", foundQty: "9.0000" },
    ]);

    const overCode = `ITEM-${uniqueSuffix}-K`;
    await createAuthorizedOrder([{ sapItemCode: overCode, requestedQty: "2.0000", foundQty: "2.0000" }]);
    await importCsv([row({ DocEntry: `${uniqueSuffix}-22over`, DocNum: `INV-${uniqueSuffix}-22over`, CardCode: "DEMO-CUST-001", ItemCode: overCode, Quantity: "9.0000", LineNum: "0" })]);

    await importCsv([
      row({ DocEntry: `${uniqueSuffix}-22unmatched`, DocNum: `INV-${uniqueSuffix}-22unmatched`, CardCode: `NOPE-${uniqueSuffix}`, ItemCode: `NOPE-ITEM-${uniqueSuffix}`, Quantity: "1.0000", LineNum: "0" }),
    ]);

    const reports = await getInvoiceReconciliationReports({ includeDemo: true });

    const awaitingRow = reports.awaitingInvoicingLines.find((r) => r.orderLineId === awaitingLineIds[0]);
    expect(awaitingRow).toBeDefined();
    expect(awaitingRow?.orderId).toBe(awaitingOrderId);
    expect(awaitingRow?.status).toBe("NOT_YET_INVOICED");

    const overRow = reports.overInvoicedLines.find((r) => r.sapItemCodeSnapshot === overCode);
    expect(overRow).toBeDefined();
    expect(overRow?.remainingQuantity).toBe("-7.0000");

    const unmatchedInvoice = reports.unmatchedInvoices.find((i) => i.sapDocNum === `INV-${uniqueSuffix}-22unmatched`);
    expect(unmatchedInvoice).toBeDefined();

    const exceptionInvoice = reports.reconciliationExceptions.find((i) => i.sapDocNum === `INV-${uniqueSuffix}-22over`);
    expect(exceptionInvoice).toBeDefined();
  });
});
