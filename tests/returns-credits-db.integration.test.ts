import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { CreditNoteColumnMapping } from "@/lib/returns-credits/csv";

/**
 * Milestone 6B (Returns & Credit Notes). DB-backed acceptance tests
 * against a REAL database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the same reason as every other *-db.integration
 * test in this project: @prisma/client in this sandbox is a stub that
 * THROWS when merely constructed (see docs/milestones/PROGRESS.md's
 * "Sandbox-only blocker"). Every lib touched here is imported with a
 * dynamic `await import(...)` inside the (skippable) test bodies below.
 * This means these tests have NOT been executed in this sandbox -- only
 * verified to typecheck/lint and to match every function signature read
 * directly from the source files they call. They are written to the same
 * standard as tests/invoice-claims-db.integration.test.ts and
 * tests/invoice-reconciliation-db.integration.test.ts, which this project
 * has previously run successfully outside this sandbox.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-001 customer must exist).
 *
 * Builds its own SapInvoiceImportBatch/SapInvoice/SapInvoiceLine rows
 * directly (same helper shape as tests/invoice-claims-db.integration.test.ts),
 * and drives claims to APPROVED/PARTIALLY_RESOLVED through the real 6A
 * lifecycle (createInvoiceClaim -> recordClaimResolution ->
 * approveClaimResolution) rather than writing InvoiceClaim.status by
 * hand, so every status this file observes is the real validated-graph
 * outcome, not an assumption.
 *
 * Note on role gating (same documented, accepted scope boundary as every
 * prior milestone's DB integration test): recordClaimReturn/
 * recordCreditNoteManually/manuallyMatchCreditNote/markCreditNoteCannotLink/
 * reopenCreditNoteMatch are role-agnostic by design -- the SALES_MANAGER/
 * ADMINISTRATOR-only gate on credit-note actions lives entirely in the
 * route layer (app/api/invoice-claims/[id]/credit-notes/route.ts and
 * app/api/returns-credits/credit-notes/[id]/*). This test calls the lib
 * functions directly and intentionally does not (and cannot, from here)
 * exercise that 403.
 *
 * Every row this test creates is marked isDemo: true where the model
 * supports it.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 6B: returns & credit notes", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  // Real-world fix (native Invoice Claims): fixtures for the order ->
  // pick -> authorize -> dispatch pipeline a native claim's lines
  // require -- same fixtures tests/invoice-claims-db.integration.test.ts
  // already establishes for the identical reason.
  let driverId: string;
  let assistantId: string;
  let vehicleId: string;
  const uniqueSuffix = `rc6btest-${Date.now()}`;
  let invoiceCounter = 0;

  const createdImportBatchIds: string[] = [];
  const createdCreditNoteImportBatchIds: string[] = [];
  const createdSapInvoiceIds: string[] = [];
  const createdClaimIds: string[] = [];
  const createdClaimReturnIds: string[] = [];
  const createdCreditNoteIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdPersonnelIds: string[] = [];
  const createdVehicleIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping Milestone 6B returns-credits DB integration test: need an admin user and the " +
          "DEMO-CUST-001 customer. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;

    const driver = await prisma.personnel.create({
      data: { name: `RC6B Test Driver ${uniqueSuffix}`, role: "DRIVER", createdById: adminId, isDemo: true },
      select: { id: true },
    });
    createdPersonnelIds.push(driver.id);
    const assistant = await prisma.personnel.create({
      data: { name: `RC6B Test Assistant ${uniqueSuffix}`, role: "DRIVER_ASSISTANT", createdById: adminId, isDemo: true },
      select: { id: true },
    });
    createdPersonnelIds.push(assistant.id);
    const vehicle = await prisma.vehicle.create({
      data: { registrationNumber: `RC6BTEST-${uniqueSuffix}`, createdById: adminId, isDemo: true },
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
      // Deletion order respects every onDelete: Restrict FK this
      // milestone added -- same leaves-first order as
      // scripts/remove-demo-data.ts's own Milestone 6B block, run before
      // the Milestone 6A block it precedes there (ClaimReturn and
      // CreditNote both reference InvoiceClaim).
      //
      // Phase 6 (Returned-claim lost sales): ClaimReturnLostSale.
      // claimReturnId is onDelete: Restrict, so any lost-sale row this
      // test created must be deleted before its parent ClaimReturn, not
      // after.
      await prisma.claimReturnLostSale.deleteMany({ where: { claimReturnId: { in: createdClaimReturnIds } } });
      await prisma.claimReturn.deleteMany({ where: { id: { in: createdClaimReturnIds } } });
      await prisma.creditNote.deleteMany({ where: { id: { in: createdCreditNoteIds } } });
      await prisma.creditNoteImportBatch.deleteMany({ where: { id: { in: createdCreditNoteImportBatchIds } } });
      await prisma.invoiceClaimAttachment.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.claimResolution.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaimLine.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaim.deleteMany({ where: { id: { in: createdClaimIds } } });
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoiceId: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoice.deleteMany({ where: { id: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { id: { in: createdImportBatchIds } } });

      // Real-world fix (native Invoice Claims): tear down the order ->
      // pick -> dispatch fixtures, same leaves-first order
      // tests/invoice-claims-db.integration.test.ts's own afterAll
      // already establishes.
      for (const orderId of createdOrderIds) {
        const dispatchRecordIds: { id: string }[] = await prisma.dispatchRecord.findMany({ where: { orderId }, select: { id: true } });
        await prisma.deliveryRecord.deleteMany({ where: { dispatchRecordId: { in: dispatchRecordIds.map((d: { id: string }) => d.id) } } });
        await prisma.dispatchRecord.deleteMany({ where: { orderId } });
        await prisma.pickingSession.deleteMany({ where: { orderId } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
        await prisma.auditEvent.deleteMany({
          where: { entityType: { in: ["CustomerOrder", "PickingSession", "PickingLine", "DispatchRecord", "DeliveryRecord"] } },
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

  /** Real-world fix (native Invoice Claims): a fresh order with one
   * already-dispatched line, carrying a known approvedUnitPrice -- the
   * order-anchored equivalent of createSapInvoice below. Mirrors
   * tests/invoice-claims-db.integration.test.ts's own
   * createDispatchedOrderLine helper. */
  async function createDispatchedOrderLine(requestedQuantity: string, approvedUnitPrice: string) {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");
    const { createDispatchRecord } = await import("@/lib/fulfilment/dispatch");

    invoiceCounter += 1;
    const order = await prisma.customerOrder.create({
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
              originalProductDescription: `6B native claim test item ${uniqueSuffix}-${invoiceCounter}`,
              requestedQuantity,
              requestedUnitCode: "EA",
              approvedUnitPrice,
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
    await recordPickedLine(started.session.id, orderLineId, requestedQuantity, "0.0000", undefined, adminId);
    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    const dispatched = await createDispatchRecord(order.id, adminId, {
      lines: [{ orderLineId, quantity: requestedQuantity }],
      driverId,
      assistantId,
      vehicleId,
    });
    if (!dispatched.ok) throw new Error(dispatched.message);

    return { orderId: order.id, orderLineId };
  }

  /** Real-world fix (native Invoice Claims): the order-anchored
   * equivalent of createApprovedClaim below -- creates a native claim
   * against the given order/order line, records the given resolution,
   * and approves it, driving the claim to APPROVED through the same
   * real 6A lifecycle. */
  async function createApprovedNativeClaim(
    orderId: string,
    orderLineId: string,
    decision: string,
    approvedCreditAmount: string | undefined
  ): Promise<string> {
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { recordClaimResolution, approveClaimResolution } = await import("@/lib/invoice-claims/claim-resolution");

    const created = await createInvoiceClaim(
      {
        orderId,
        customerId,
        category: "QUALITY_ISSUE",
        description: "6B native claim test",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ orderLineId, disputeType: "AMOUNT_ONLY", disputedAmount: "1.0000", reason: "6B native test" }],
      },
      adminId
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("setup failed: createInvoiceClaim (native)");
    createdClaimIds.push(created.id);

    const resolution = await recordClaimResolution(created.id, { decision, findings: "6B native test findings" } as never, adminId);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error("setup failed: recordClaimResolution (native)");

    const approved = await approveClaimResolution(created.id, resolution.id, approvedCreditAmount, adminId);
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("setup failed: approveClaimResolution (native)");
    expect(approved.claimStatus).toBe("APPROVED");

    return created.id;
  }

  /** One SAP invoice with one line -- built directly, same shape as
   * tests/invoice-claims-db.integration.test.ts's own helper, but with
   * sapDocEntry always set (unlike that file) since Milestone 6B's CSV
   * import pipeline resolves a credit note's base invoice by DocEntry
   * preferentially. */
  async function createSapInvoice(quantityInvoiced: string, unitPrice: string) {
    const { prisma } = await import("@/lib/prisma");

    invoiceCounter += 1;
    const batch = await prisma.sapInvoiceImportBatch.create({
      data: {
        originalFileName: "6b-test.csv",
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

    const docEntry = `${uniqueSuffix}-${invoiceCounter}`;
    const docNum = `INV-${uniqueSuffix}-${invoiceCounter}`;
    const invoice = await prisma.sapInvoice.create({
      data: {
        importBatchId: batch.id,
        sapDocEntry: docEntry,
        sapDocNum: docNum,
        customerSapCode: "DEMO-CUST-001",
        customerName: "TM Supermarket Borrowdale (Demo)",
        matchedCustomerId: customerId,
        invoiceDate: new Date(),
        currencyCode: "USD",
        total: (Number(quantityInvoiced) * Number(unitPrice)).toFixed(4),
        rawSourceData: {},
        isDemo: true,
        lines: {
          create: [
            {
              lineNumber: 1,
              sapItemCode: `ITEM-${uniqueSuffix}-${invoiceCounter}`,
              sapItemDescription: "6B test item",
              quantityInvoiced,
              unitPrice,
              lineTotal: (Number(quantityInvoiced) * Number(unitPrice)).toFixed(4),
              rawSourceData: {},
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true, sapDocEntry: true, sapDocNum: true, lines: { select: { id: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdSapInvoiceIds.push(invoice.id);

    return { invoiceId: invoice.id, sapDocEntry: invoice.sapDocEntry!, sapDocNum: invoice.sapDocNum, lineId: invoice.lines[0]!.id };
  }

  /** Creates a claim against the given invoice line, records a resolution
   * with the given decision/amount, and approves it -- driving the claim
   * to APPROVED through the real 6A lifecycle, never by writing
   * InvoiceClaim.status directly. Returns the claim id once APPROVED. */
  async function createApprovedClaim(
    invoiceId: string,
    lineId: string,
    decision: string,
    approvedCreditAmount: string | undefined
  ): Promise<string> {
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { recordClaimResolution, approveClaimResolution } = await import("@/lib/invoice-claims/claim-resolution");

    const created = await createInvoiceClaim(
      {
        sapInvoiceId: invoiceId,
        customerId,
        category: "QUALITY_ISSUE",
        description: "6B test claim",
        claimDate: new Date().toISOString().slice(0, 10),
        lines: [{ sapInvoiceLineId: lineId, disputeType: "AMOUNT_ONLY", disputedAmount: "1.0000", reason: "6B test" }],
      },
      adminId
    );
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error("setup failed: createInvoiceClaim");
    createdClaimIds.push(created.id);

    const resolution = await recordClaimResolution(created.id, { decision, findings: "6B test findings" } as never, adminId);
    expect(resolution.ok).toBe(true);
    if (!resolution.ok) throw new Error("setup failed: recordClaimResolution");

    const approved = await approveClaimResolution(created.id, resolution.id, approvedCreditAmount, adminId);
    expect(approved.ok).toBe(true);
    if (!approved.ok) throw new Error("setup failed: approveClaimResolution");
    expect(approved.claimStatus).toBe("APPROVED");

    return created.id;
  }

  it("PHYSICAL_RETURN_REQUIRED: recording a received physical return auto-resolves the claim, with no credit note involved at all", async () => {
    if (skipAll) return;
    const { recordClaimReturn } = await import("@/lib/returns-credits/returns");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineId } = await createSapInvoice("10.0000", "5.0000");
    const claimId = await createApprovedClaim(invoiceId, lineId, "PHYSICAL_RETURN_REQUIRED", undefined);

    const result = await recordClaimReturn(
      claimId,
      { receivedQuantity: "10.0000", condition: "DAMAGED", receivedDate: new Date().toISOString().slice(0, 10) } as never,
      adminId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdClaimReturnIds.push(result.id);
    expect(result.returnReference).toMatch(/^RET-\d{8}-[A-F0-9]{8}$/i);

    const claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("RESOLVED");

    // Phase 6 (Returned-claim lost sales): DAMAGED is a genuine loss, so
    // a ClaimReturnLostSale row is created automatically -- but no
    // claimLineId was supplied above, so the price genuinely cannot be
    // resolved (never guessed): both estimate fields stay null.
    const lostSale = await prisma.claimReturnLostSale.findUnique({ where: { claimReturnId: result.id } });
    expect(lostSale).not.toBeNull();
    expect(lostSale?.claimLineId).toBeNull();
    expect(lostSale?.estimatedUnitPrice).toBeNull();
    expect(lostSale?.estimatedValue).toBeNull();
    expect(lostSale?.decisionSource).toBe("AUTOMATIC_SYSTEM_RECORDED");
  });

  it("Phase 6 (Returned-claim lost sales): a return scoped to a specific disputed line resolves its real invoiced unit price and computes an estimated loss", async () => {
    if (skipAll) return;
    const { recordClaimReturn } = await import("@/lib/returns-credits/returns");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineId } = await createSapInvoice("10.0000", "4.5000");
    const claimId = await createApprovedClaim(invoiceId, lineId, "PHYSICAL_RETURN_REQUIRED", undefined);
    const claimLine = await prisma.invoiceClaimLine.findFirstOrThrow({ where: { claimId, sapInvoiceLineId: lineId } });

    // Received quantity (6.0000) deliberately differs from the claim
    // line's own disputedAmount-based dispute -- the lost-sale estimate
    // must be driven by what was ACTUALLY received back, not by
    // whatever the original dispute claimed.
    const result = await recordClaimReturn(
      claimId,
      { claimLineId: claimLine.id, receivedQuantity: "6.0000", condition: "EXPIRED", receivedDate: new Date().toISOString().slice(0, 10) } as never,
      adminId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdClaimReturnIds.push(result.id);

    const lostSale = await prisma.claimReturnLostSale.findUnique({ where: { claimReturnId: result.id } });
    expect(lostSale).not.toBeNull();
    expect(lostSale?.claimLineId).toBe(claimLine.id);
    expect(lostSale?.estimatedUnitPrice?.toString()).toBe("4.5000");
    // 6.0000 * 4.5000 = 27.0000, exactly -- real SAP-invoiced price times
    // the actual returned quantity, rounded to this project's money
    // scale.
    expect(lostSale?.estimatedValue?.toString()).toBe("27.0000");
    expect(lostSale?.currencyCode).toBe("USD");
  });

  it("Real-world fix (native Invoice Claims): a return against a native (order-anchored) claim line resolves its real price via the order line's approved unit price, and its currency from the order rather than a non-existent SapInvoice", async () => {
    if (skipAll) return;
    const { recordClaimReturn } = await import("@/lib/returns-credits/returns");
    const { prisma } = await import("@/lib/prisma");

    const { orderId, orderLineId } = await createDispatchedOrderLine("10.0000", "4.5000");
    const claimId = await createApprovedNativeClaim(orderId, orderLineId, "PHYSICAL_RETURN_REQUIRED", undefined);
    const claimLine = await prisma.invoiceClaimLine.findFirstOrThrow({ where: { claimId, orderLineId } });

    // Same "actually received, not originally disputed" distinction the
    // SAP-anchored test above makes: 6.0000 received back, independent
    // of whatever the original dispute claimed.
    const result = await recordClaimReturn(
      claimId,
      { claimLineId: claimLine.id, receivedQuantity: "6.0000", condition: "EXPIRED", receivedDate: new Date().toISOString().slice(0, 10) } as never,
      adminId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdClaimReturnIds.push(result.id);

    const lostSale = await prisma.claimReturnLostSale.findUnique({ where: { claimReturnId: result.id } });
    expect(lostSale).not.toBeNull();
    expect(lostSale?.claimLineId).toBe(claimLine.id);
    // No SapInvoiceLine exists for a native claim line -- the order
    // line's own approvedUnitPrice is the real price source instead.
    expect(lostSale?.estimatedUnitPrice?.toString()).toBe("4.5000");
    // 6.0000 * 4.5000 = 27.0000, exactly -- same computation as the
    // SAP-anchored path, just priced from the order line instead of a
    // SapInvoiceLine.
    expect(lostSale?.estimatedValue?.toString()).toBe("27.0000");
    // Currency comes from CustomerOrder.currency, never left null just
    // because there's no SapInvoice.
    expect(lostSale?.currencyCode).toBe("USD");
  });

  it("Phase 6 (Returned-claim lost sales): a GOOD_RESALABLE return never creates a lost-sale row -- the goods are not a business loss", async () => {
    if (skipAll) return;
    const { recordClaimReturn } = await import("@/lib/returns-credits/returns");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineId } = await createSapInvoice("10.0000", "5.0000");
    const claimId = await createApprovedClaim(invoiceId, lineId, "PHYSICAL_RETURN_REQUIRED", undefined);

    const result = await recordClaimReturn(
      claimId,
      { receivedQuantity: "10.0000", condition: "GOOD_RESALABLE", receivedDate: new Date().toISOString().slice(0, 10) } as never,
      adminId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdClaimReturnIds.push(result.id);

    const lostSale = await prisma.claimReturnLostSale.findUnique({ where: { claimReturnId: result.id } });
    expect(lostSale).toBeNull();
  });

  it("FULL_CREDIT_RECOMMENDED: a manually-recorded credit note matching the approved amount auto-resolves the claim, and the financial summary reflects it live", async () => {
    if (skipAll) return;
    const { recordCreditNoteManually } = await import("@/lib/returns-credits/credit-notes");
    const { computeClaimFinancialSummary } = await import("@/lib/invoice-claims/financial");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineId } = await createSapInvoice("20.0000", "5.0000");
    const claimId = await createApprovedClaim(invoiceId, lineId, "FULL_CREDIT_RECOMMENDED", "100.0000");

    const result = await recordCreditNoteManually(
      { claimId, sapCreditNoteDocNum: `CN-${uniqueSuffix}-1`, amount: "100.0000", currencyCode: "USD" } as never,
      adminId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdCreditNoteIds.push(result.id);

    const claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("RESOLVED");

    const summary = await computeClaimFinancialSummary(claimId);
    expect(summary?.actualSapCreditedAmount).toBe("100.0000");
    expect(summary?.actualCreditShortfall).toBe("0.0000");
    expect(summary?.actualExceedsApproved).toBe(false);
  });

  it("PARTIAL_CREDIT_RECOMMENDED: any real credit note moves the claim to PARTIALLY_RESOLVED, and it never silently escalates to RESOLVED even once the full approved amount has been credited", async () => {
    if (skipAll) return;
    const { recordCreditNoteManually } = await import("@/lib/returns-credits/credit-notes");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineId } = await createSapInvoice("10.0000", "5.0000");
    const claimId = await createApprovedClaim(invoiceId, lineId, "PARTIAL_CREDIT_RECOMMENDED", "50.0000");

    const first = await recordCreditNoteManually(
      { claimId, sapCreditNoteDocNum: `CN-${uniqueSuffix}-2a`, amount: "20.0000", currencyCode: "USD" } as never,
      adminId
    );
    expect(first.ok).toBe(true);
    if (first.ok) createdCreditNoteIds.push(first.id);

    let claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("PARTIALLY_RESOLVED");

    // A second credit note brings the actual total to exactly the
    // approved amount -- the claim stays PARTIALLY_RESOLVED, never
    // auto-escalated to RESOLVED, since a manager explicitly classified
    // this resolution as "partial."
    const second = await recordCreditNoteManually(
      { claimId, sapCreditNoteDocNum: `CN-${uniqueSuffix}-2b`, amount: "30.0000", currencyCode: "USD" } as never,
      adminId
    );
    expect(second.ok).toBe(true);
    if (second.ok) createdCreditNoteIds.push(second.id);

    claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("PARTIALLY_RESOLVED");
  });

  it("PRICING_CORRECTION_REQUIRED: SAP crediting MORE than was approved still auto-resolves the claim, and the excess is flagged (never clamped)", async () => {
    if (skipAll) return;
    const { recordCreditNoteManually } = await import("@/lib/returns-credits/credit-notes");
    const { computeClaimFinancialSummary } = await import("@/lib/invoice-claims/financial");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineId } = await createSapInvoice("5.0000", "10.0000");
    const claimId = await createApprovedClaim(invoiceId, lineId, "PRICING_CORRECTION_REQUIRED", "50.0000");

    const result = await recordCreditNoteManually(
      { claimId, sapCreditNoteDocNum: `CN-${uniqueSuffix}-3`, amount: "70.0000", currencyCode: "USD" } as never,
      adminId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdCreditNoteIds.push(result.id);

    const claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("RESOLVED");

    const summary = await computeClaimFinancialSummary(claimId);
    expect(summary?.actualSapCreditedAmount).toBe("70.0000");
    expect(summary?.actualExceedsApproved).toBe(true);
    // Never clamped to the approved amount -- the real, larger figure is
    // reported as-is.
    expect(summary?.actualCreditShortfall).toBe("0.0000");
  });

  it("CSV import auto-matches a credit note to the single outstanding candidate claim against its resolved base invoice", async () => {
    if (skipAll) return;
    const { applyCreditNoteColumnMapping, groupIntoCreditNotes } = await import("@/lib/returns-credits/csv");
    const { planCreditNoteImport } = await import("@/lib/returns-credits/plan-import");
    const { executeCreditNoteImport } = await import("@/lib/returns-credits/execute-import");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineId, sapDocEntry } = await createSapInvoice("8.0000", "12.5000");
    const claimId = await createApprovedClaim(invoiceId, lineId, "FULL_CREDIT_RECOMMENDED", "100.0000");

    const mapping: CreditNoteColumnMapping = {
      docEntry: "DocEntry",
      docNum: "DocNum",
      baseInvoiceDocEntry: "BaseDocEntry",
      baseInvoiceDocNum: null,
      creditNoteDate: null,
      currency: "Currency",
      amount: "Amount",
      notes: null,
    };
    const csv = ["DocEntry,DocNum,BaseDocEntry,Currency,Amount", `CNE-${uniqueSuffix},CN-${uniqueSuffix}-import,${sapDocEntry},USD,100.0000`].join("\n");

    const { rows, errors } = applyCreditNoteColumnMapping(csv, mapping);
    expect(errors).toHaveLength(0);
    const groups = groupIntoCreditNotes(rows);
    const plan = await planCreditNoteImport(groups, 0);
    expect(plan.newCreditNotes).toHaveLength(1);
    expect(plan.newCreditNotes[0]!.resolvedSapInvoiceId).toBe(invoiceId);

    const result = await executeCreditNoteImport(plan, mapping, "6b-import-test.csv", adminId);
    createdCreditNoteImportBatchIds.push(result.importBatchId);
    expect(result.importedCreditNoteCount).toBe(1);
    expect(result.autoMatchedCount).toBe(1);

    const creditNote = await prisma.creditNote.findFirstOrThrow({ where: { importBatchId: result.importBatchId } });
    createdCreditNoteIds.push(creditNote.id);
    expect(creditNote.matchStatus).toBe("AUTO_MATCHED");
    expect(creditNote.claimId).toBe(claimId);

    // Auto-matching also recomputed the newly-linked claim's status.
    const claim = await prisma.invoiceClaim.findUniqueOrThrow({ where: { id: claimId } });
    expect(claim.status).toBe("RESOLVED");
  });

  it("CSV import leaves a credit note UNMATCHED when two claims against the same base invoice both qualify -- never a guess", async () => {
    if (skipAll) return;
    const { applyCreditNoteColumnMapping, groupIntoCreditNotes } = await import("@/lib/returns-credits/csv");
    const { planCreditNoteImport } = await import("@/lib/returns-credits/plan-import");
    const { executeCreditNoteImport } = await import("@/lib/returns-credits/execute-import");
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
    const { recordClaimResolution, approveClaimResolution } = await import("@/lib/invoice-claims/claim-resolution");
    const { prisma } = await import("@/lib/prisma");

    // One invoice, two separate claims against two different lines (so
    // the quantity-remaining guard doesn't block the second claim), each
    // approved with its own outstanding credit-bearing decision.
    const { prisma: p2 } = await import("@/lib/prisma");
    const batch = await p2.sapInvoiceImportBatch.create({
      data: { originalFileName: "6b-ambig-test.csv", uploadedById: adminId, columnMapping: {}, totalRows: 2, importedInvoiceCount: 1, importedLineCount: 2, duplicateRowCount: 0, invalidRowCount: 0, isDemo: true },
      select: { id: true },
    });
    createdImportBatchIds.push(batch.id);
    invoiceCounter += 1;
    const docEntry = `${uniqueSuffix}-ambig-${invoiceCounter}`;
    const invoice = await p2.sapInvoice.create({
      data: {
        importBatchId: batch.id,
        sapDocEntry: docEntry,
        sapDocNum: `INV-${uniqueSuffix}-ambig-${invoiceCounter}`,
        customerSapCode: "DEMO-CUST-001",
        matchedCustomerId: customerId,
        invoiceDate: new Date(),
        currencyCode: "USD",
        total: "200.0000",
        rawSourceData: {},
        isDemo: true,
        lines: {
          create: [
            { lineNumber: 1, sapItemCode: `ITEM-${uniqueSuffix}-a1`, quantityInvoiced: "10.0000", unitPrice: "10.0000", lineTotal: "100.0000", rawSourceData: {}, isDemo: true },
            { lineNumber: 2, sapItemCode: `ITEM-${uniqueSuffix}-a2`, quantityInvoiced: "10.0000", unitPrice: "10.0000", lineTotal: "100.0000", rawSourceData: {}, isDemo: true },
          ],
        },
      },
      select: { id: true, sapDocEntry: true, lines: { select: { id: true }, orderBy: { lineNumber: "asc" } } },
    });
    createdSapInvoiceIds.push(invoice.id);

    async function approvedClaimOnLine(lineId: string, amount: string): Promise<string> {
      const created = await createInvoiceClaim(
        { sapInvoiceId: invoice.id, customerId, category: "QUALITY_ISSUE", description: "ambiguous-match test", claimDate: new Date().toISOString().slice(0, 10), lines: [{ sapInvoiceLineId: lineId, disputeType: "AMOUNT_ONLY", disputedAmount: "1.0000", reason: "test" }] },
        adminId
      );
      if (!created.ok) throw new Error("setup failed");
      createdClaimIds.push(created.id);
      const resolution = await recordClaimResolution(created.id, { decision: "FULL_CREDIT_RECOMMENDED", findings: "test" } as never, adminId);
      if (!resolution.ok) throw new Error("setup failed");
      const approved = await approveClaimResolution(created.id, resolution.id, amount, adminId);
      if (!approved.ok) throw new Error("setup failed");
      return created.id;
    }

    await approvedClaimOnLine(invoice.lines[0]!.id, "50.0000");
    await approvedClaimOnLine(invoice.lines[1]!.id, "50.0000");

    const mapping: CreditNoteColumnMapping = {
      docEntry: "DocEntry",
      docNum: "DocNum",
      baseInvoiceDocEntry: "BaseDocEntry",
      baseInvoiceDocNum: null,
      creditNoteDate: null,
      currency: null,
      amount: "Amount",
      notes: null,
    };
    const csv = ["DocEntry,DocNum,BaseDocEntry,Amount", `CNE-${uniqueSuffix}-ambig,CN-${uniqueSuffix}-ambig,${invoice.sapDocEntry},40.0000`].join("\n");
    const { rows } = applyCreditNoteColumnMapping(csv, mapping);
    const groups = groupIntoCreditNotes(rows);
    const plan = await planCreditNoteImport(groups, 0);

    const result = await executeCreditNoteImport(plan, mapping, "6b-ambig-test.csv", adminId);
    createdCreditNoteImportBatchIds.push(result.importBatchId);
    expect(result.autoMatchedCount).toBe(0);

    const creditNote = await prisma.creditNote.findFirstOrThrow({ where: { importBatchId: result.importBatchId } });
    createdCreditNoteIds.push(creditNote.id);
    expect(creditNote.matchStatus).toBe("UNMATCHED");
    expect(creditNote.claimId).toBeNull();
  });

  it("manual reconciliation cycle: match an UNMATCHED credit note to a claim by hand, mark a different one cannot-link, then reopen it back to UNMATCHED", async () => {
    if (skipAll) return;
    const { recordCreditNoteManually, manuallyMatchCreditNote, markCreditNoteCannotLink, reopenCreditNoteMatch } = await import("@/lib/returns-credits/credit-notes");
    const { prisma } = await import("@/lib/prisma");

    const { invoiceId, lineId } = await createSapInvoice("4.0000", "25.0000");
    const claimId = await createApprovedClaim(invoiceId, lineId, "FULL_CREDIT_RECOMMENDED", "100.0000");

    // Create a credit note already matched (manual entry is always
    // created MANUALLY_MATCHED), then exercise cannot-link and reopen on
    // it directly -- both actions are allowed from any status, not just
    // UNMATCHED/CANNOT_LINK.
    const recorded = await recordCreditNoteManually(
      { claimId, sapCreditNoteDocNum: `CN-${uniqueSuffix}-cycle`, amount: "100.0000", currencyCode: "USD" } as never,
      adminId
    );
    expect(recorded.ok).toBe(true);
    if (!recorded.ok) return;
    createdCreditNoteIds.push(recorded.id);

    const cannotLink = await markCreditNoteCannotLink(recorded.id, "Found to be unrelated to any claim after all", adminId);
    expect(cannotLink.ok).toBe(true);

    let note = await prisma.creditNote.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(note.matchStatus).toBe("CANNOT_LINK");
    expect(note.claimId).toBeNull();

    // Reopening an already-UNMATCHED note is rejected.
    const cannotReopenTwice = await reopenCreditNoteMatch(recorded.id, "test", adminId);
    expect(cannotReopenTwice.ok).toBe(true); // CANNOT_LINK -> reopen is allowed (only already-UNMATCHED is rejected)

    note = await prisma.creditNote.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(note.matchStatus).toBe("UNMATCHED");

    const alreadyUnmatched = await reopenCreditNoteMatch(recorded.id, "test again", adminId);
    expect(alreadyUnmatched.ok).toBe(false);

    // Now manually match it back to the same claim.
    const matched = await manuallyMatchCreditNote(recorded.id, { claimId, note: "Confirmed correct after all" } as never, adminId);
    expect(matched.ok).toBe(true);

    note = await prisma.creditNote.findUniqueOrThrow({ where: { id: recorded.id } });
    expect(note.matchStatus).toBe("MANUALLY_MATCHED");
    expect(note.claimId).toBe(claimId);
  });

  it("recordClaimReturn and recordCreditNoteManually both refuse to act on a claim that has no approved resolution yet", async () => {
    if (skipAll) return;
    const { recordClaimReturn } = await import("@/lib/returns-credits/returns");
    const { recordCreditNoteManually } = await import("@/lib/returns-credits/credit-notes");
    const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");

    const { invoiceId, lineId } = await createSapInvoice("3.0000", "10.0000");
    const created = await createInvoiceClaim(
      { sapInvoiceId: invoiceId, customerId, category: "OTHER", categoryDetail: "test", description: "no resolution yet", claimDate: new Date().toISOString().slice(0, 10), lines: [{ sapInvoiceLineId: lineId, disputeType: "AMOUNT_ONLY", disputedAmount: "1.0000", reason: "test" }] },
      adminId
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    createdClaimIds.push(created.id);

    const returnResult = await recordClaimReturn(
      created.id,
      { receivedQuantity: "1.0000", condition: "GOOD_RESALABLE", receivedDate: new Date().toISOString().slice(0, 10) } as never,
      adminId
    );
    expect(returnResult.ok).toBe(false);

    const creditResult = await recordCreditNoteManually(
      { claimId: created.id, sapCreditNoteDocNum: `CN-${uniqueSuffix}-blocked`, amount: "10.0000" } as never,
      adminId
    );
    expect(creditResult.ok).toBe(false);
  });

  it("Phase 7 (Claims analytics) Source C: getReturnedGoodsLostSalesValue sums estimatedValue across ClaimReturnLostSale rows, by currency, excluding (and counting separately) those with no resolvable price", async () => {
    if (skipAll) return;
    const { recordClaimReturn } = await import("@/lib/returns-credits/returns");
    const { getReturnedGoodsLostSalesValue } = await import("@/lib/returns-credits/lost-sale-analytics");
    const { prisma } = await import("@/lib/prisma");

    const before = await getReturnedGoodsLostSalesValue({ includeDemo: true });

    // Priced, genuine-loss return: 3.0000 received back, invoice line
    // unitPrice "6.2500" -> a known, exact estimatedValue of 18.7500
    // (3.0000 * 6.2500), in USD (createSapInvoice's own fixed currency).
    const { invoiceId: invoiceId1, lineId: lineId1 } = await createSapInvoice("10.0000", "6.2500");
    const claimId1 = await createApprovedClaim(invoiceId1, lineId1, "PHYSICAL_RETURN_REQUIRED", undefined);
    const claimLine1 = await prisma.invoiceClaimLine.findFirstOrThrow({ where: { claimId: claimId1, sapInvoiceLineId: lineId1 } });
    const result1 = await recordClaimReturn(
      claimId1,
      { claimLineId: claimLine1.id, receivedQuantity: "3.0000", condition: "DAMAGED", receivedDate: new Date().toISOString().slice(0, 10) } as never,
      adminId
    );
    expect(result1.ok).toBe(true);
    if (result1.ok) createdClaimReturnIds.push(result1.id);

    // Unpriced, genuine-loss return (no claimLineId -- same shape as the
    // PHYSICAL_RETURN_REQUIRED test above): must still count toward
    // totalLossRecords/recordsWithoutEstimate, but contribute nothing to
    // any currency's summed estimatedValue.
    const { invoiceId: invoiceId2, lineId: lineId2 } = await createSapInvoice("5.0000", "9.0000");
    const claimId2 = await createApprovedClaim(invoiceId2, lineId2, "PHYSICAL_RETURN_REQUIRED", undefined);
    const result2 = await recordClaimReturn(
      claimId2,
      { receivedQuantity: "5.0000", condition: "EXPIRED", receivedDate: new Date().toISOString().slice(0, 10) } as never,
      adminId
    );
    expect(result2.ok).toBe(true);
    if (result2.ok) createdClaimReturnIds.push(result2.id);

    // GOOD_RESALABLE: must contribute nothing at all -- no row is even
    // created (see the earlier GOOD_RESALABLE test above).
    const { invoiceId: invoiceId3, lineId: lineId3 } = await createSapInvoice("4.0000", "2.0000");
    const claimId3 = await createApprovedClaim(invoiceId3, lineId3, "PHYSICAL_RETURN_REQUIRED", undefined);
    const result3 = await recordClaimReturn(
      claimId3,
      { receivedQuantity: "4.0000", condition: "GOOD_RESALABLE", receivedDate: new Date().toISOString().slice(0, 10) } as never,
      adminId
    );
    expect(result3.ok).toBe(true);
    if (result3.ok) createdClaimReturnIds.push(result3.id);

    const after = await getReturnedGoodsLostSalesValue({ includeDemo: true });

    // Exactly 2 new confirmed-loss rows (the GOOD_RESALABLE return never
    // created one) -- 1 priced, 1 not.
    expect(after.totalLossRecords - before.totalLossRecords).toBe(2);
    expect(after.recordsWithEstimate - before.recordsWithEstimate).toBe(1);
    expect(after.recordsWithoutEstimate - before.recordsWithoutEstimate).toBe(1);

    const usdBefore = before.byCurrency.find((b) => b.currencyCode === "USD")?.estimatedValue ?? "0";
    const usdAfter = after.byCurrency.find((b) => b.currencyCode === "USD")?.estimatedValue ?? "0";
    expect(Number(usdAfter) - Number(usdBefore)).toBeCloseTo(18.75, 4);
  });
});
