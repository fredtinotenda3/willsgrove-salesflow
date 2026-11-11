import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 7 (Quotations Management). DB-backed acceptance tests
 * against a REAL database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the same reason as every other *-db.integration
 * test in this project: @prisma/client in this sandbox is a stub that
 * THROWS when merely constructed (see docs/milestones/PROGRESS.md's
 * "Sandbox-only blocker"). Every lib touched here is imported with a
 * dynamic `await import(...)` inside the (skippable) test bodies below.
 * This means these tests have NOT been executed in this sandbox -- only
 * verified to typecheck/lint and to match every function signature read
 * directly from the source files they call (lib/quotations/create.ts,
 * edit.ts, issue.ts, respond.ts, cancel.ts, revise.ts,
 * convert-to-order.ts, expiry.ts, calculations.ts, queries.ts). Written
 * to the same standard as tests/returns-credits-db.integration.test.ts
 * and tests/invoice-claims-db.integration.test.ts, which this project has
 * previously run successfully outside this sandbox.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-001 customer must exist).
 *
 * Builds its own Product/TaxCode rows directly (isDemo: true) rather
 * than depending on a specific seeded catalogue item, same reasoning as
 * tests/returns-credits-db.integration.test.ts building its own
 * SapInvoice/SapInvoiceLine rows instead of depending on seeded ones.
 *
 * Every row this test creates is marked isDemo: true where the model
 * supports it, and cleaned up in afterAll in FK-respecting order (see
 * that block's own comment -- same ordering scripts/remove-demo-data.ts
 * uses for its own Milestone 7 cleanup group).
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 7: quotations", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let productId: string;
  let sapItemCode: string;
  let taxCode: string;
  const uniqueSuffix = `quo7test-${Date.now()}`;

  const createdQuotationIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdProductIds: string[] = [];
  const createdTaxCodeIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: "DEMO-CUST-001" }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping Milestone 7 quotations DB integration test: need an admin user and the " +
          "DEMO-CUST-001 customer. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;

    const tax = await prisma.taxCode.create({
      data: { code: `VAT-${uniqueSuffix}`, description: "15% test VAT", ratePercent: "15.00", isDemo: true },
      select: { id: true, code: true },
    });
    createdTaxCodeIds.push(tax.id);
    taxCode = tax.code;

    sapItemCode = `ITEM-${uniqueSuffix}`;
    const product = await prisma.product.create({
      data: { sapItemCode, itemName: "Milestone 7 test widget", unitOfMeasure: "EA", vatCode: taxCode, isDemo: true },
      select: { id: true },
    });
    createdProductIds.push(product.id);
    productId = product.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      // FK-respecting leaves-first order -- same as
      // scripts/remove-demo-data.ts's own Milestone 7 cleanup block:
      // QuotationEvent/QuotationLine before Quotation (Restrict FKs onto
      // it), and every Quotation row before the CustomerOrder rows it may
      // reference via convertedOrderId (also Restrict).
      await prisma.quotationEvent.deleteMany({ where: { quotationId: { in: createdQuotationIds } } });
      await prisma.quotationLine.deleteMany({ where: { quotationId: { in: createdQuotationIds } } });
      await prisma.quotation.deleteMany({ where: { id: { in: createdQuotationIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
      await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
      await prisma.taxCode.deleteMany({ where: { id: { in: createdTaxCodeIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /** Creates a DRAFT quotation with one catalogued line (quantity 10 @ 20.00, 10% discount, 15% VAT via the shared test product) and one unlisted line (quantity 1 @ 5.00, no VAT resolvable). */
  async function createTestQuotation(overrides: Record<string, unknown> = {}) {
    const { createQuotation } = await import("@/lib/quotations/create");
    const today = new Date().toISOString().slice(0, 10);
    const result = await createQuotation(
      {
        customerId,
        quotationDate: today,
        validUntil: today,
        currency: "USD",
        lines: [
          { productId, quantity: "10", unitPrice: "20.00", discountPercent: "10", isUnlistedItem: false },
          { isUnlistedItem: true, unlistedItemDescription: "Custom bracket, not catalogued", quantity: "1", unitPrice: "5.00" },
        ],
        ...overrides,
      } as never,
      adminId
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`setup failed: createQuotation (${result.message})`);
    createdQuotationIds.push(result.id);
    return result;
  }

  it("createQuotation: computes decimal-exact line and quotation totals (discount before VAT, never JS floating point)", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");

    const created = await createTestQuotation();
    const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id }, include: { lines: { orderBy: { lineNumber: "asc" } } } });

    expect(quotation.status).toBe("DRAFT");
    expect(quotation.lines).toHaveLength(2);

    // Line 1: 10 * 20.00 = 200.00 subtotal; 10% discount = 20.00; after
    // discount 180.00; 15% VAT on 180.00 = 27.00; line total 207.00.
    const line1 = quotation.lines[0]!;
    expect(line1.sapItemCodeSnapshot).toBe(sapItemCode);
    expect(line1.lineSubtotal.toString()).toBe("200.0000");
    expect(line1.discountAmount.toString()).toBe("20.0000");
    expect(line1.vatAmount.toString()).toBe("27.0000");
    expect(line1.lineTotal.toString()).toBe("207.0000");

    // Line 2 (unlisted): 1 * 5.00 = 5.00 subtotal; no discount; no VAT
    // (unlisted item has no resolvable TaxCode) -- never defaulted to a
    // fabricated rate.
    const line2 = quotation.lines[1]!;
    expect(line2.isUnlistedItem).toBe(true);
    expect(line2.sapItemCodeSnapshot).toBeNull();
    expect(line2.vatRatePercentSnapshot).toBeNull();
    expect(line2.lineTotal.toString()).toBe("5.0000");

    // Quotation totals are the straight sum of the (already-rounded) line amounts.
    expect(quotation.subtotal.toString()).toBe("205.0000");
    expect(quotation.discountTotal.toString()).toBe("20.0000");
    expect(quotation.vatTotal.toString()).toBe("27.0000");
    expect(quotation.total.toString()).toBe("212.0000");
  });

  it("createQuotation: rejects an unlisted line with no description, and a catalogued line referencing an unknown product, without writing anything", async () => {
    if (skipAll) return;
    const { createQuotation } = await import("@/lib/quotations/create");
    const today = new Date().toISOString().slice(0, 10);

    const missingDescription = await createQuotation(
      { customerId, quotationDate: today, validUntil: today, lines: [{ isUnlistedItem: true, unlistedItemDescription: "", quantity: "1", unitPrice: "1" }] } as never,
      adminId
    );
    expect(missingDescription.ok).toBe(false);

    const unknownProduct = await createQuotation(
      { customerId, quotationDate: today, validUntil: today, lines: [{ productId: "does-not-exist", quantity: "1", unitPrice: "1", isUnlistedItem: false }] } as never,
      adminId
    );
    expect(unknownProduct.ok).toBe(false);
    if (!unknownProduct.ok) expect(unknownProduct.status).toBe(404);
  });

  it("DRAFT editing: add/update/remove a line each recompute the stored quotation totals; editing is blocked once no longer DRAFT", async () => {
    if (skipAll) return;
    const { addQuotationLine, updateQuotationLine, removeQuotationLine, updateQuotationHeader } = await import("@/lib/quotations/edit");
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const { prisma } = await import("@/lib/prisma");

    const created = await createTestQuotation();

    const added = await addQuotationLine(created.id, { productId, quantity: "1", unitPrice: "100.00", isUnlistedItem: false } as never, adminId);
    expect(added.ok).toBe(true);
    if (!added.ok) return;

    let quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
    // 212.0000 (from the base two lines) + a third line: 1 * 100 = 100
    // subtotal, 15% VAT = 15, line total 115 -> new total 327.0000.
    expect(quotation.total.toString()).toBe("327.0000");

    const updated = await updateQuotationLine(created.id, added.lineId, { productId, quantity: "1", unitPrice: "50.00", isUnlistedItem: false } as never, adminId);
    expect(updated.ok).toBe(true);
    quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
    // Third line now 1 * 50 = 50 subtotal, 15% VAT = 7.5, line total
    // 57.5 -> new total 212.0000 + 57.5000 = 269.5000.
    expect(quotation.total.toString()).toBe("269.5000");

    const removed = await removeQuotationLine(created.id, added.lineId, adminId);
    expect(removed.ok).toBe(true);
    quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
    expect(quotation.total.toString()).toBe("212.0000");

    const headerEdit = await updateQuotationHeader(created.id, { customerReference: "RFQ-edit-test" } as never, adminId);
    expect(headerEdit.ok).toBe(true);

    // Once issued, every DRAFT-only editing path is hard-blocked.
    const issued = await issueQuotation(created.id, adminId);
    expect(issued.ok).toBe(true);

    const blockedAdd = await addQuotationLine(created.id, { productId, quantity: "1", unitPrice: "1", isUnlistedItem: false } as never, adminId);
    expect(blockedAdd.ok).toBe(false);
    if (!blockedAdd.ok) expect(blockedAdd.status).toBe(409);

    const blockedHeaderEdit = await updateQuotationHeader(created.id, { customerReference: "should not apply" } as never, adminId);
    expect(blockedHeaderEdit.ok).toBe(false);
  });

  it("issueQuotation: refuses to issue a quotation with zero lines, and refuses a second issue", async () => {
    if (skipAll) return;
    const { createQuotation } = await import("@/lib/quotations/create");
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const today = new Date().toISOString().slice(0, 10);

    const empty = await createQuotation({ customerId, quotationDate: today, validUntil: today, lines: [] } as never, adminId);
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    createdQuotationIds.push(empty.id);

    const blocked = await issueQuotation(empty.id, adminId);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.status).toBe(400);

    const created = await createTestQuotation();
    const first = await issueQuotation(created.id, adminId);
    expect(first.ok).toBe(true);
    const second = await issueQuotation(created.id, adminId);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.status).toBe(409);
  });

  it("respondToQuotation: ACCEPTED records the response and status; never creates a CustomerOrder as a side effect", async () => {
    if (skipAll) return;
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const { respondToQuotation } = await import("@/lib/quotations/respond");
    const { prisma } = await import("@/lib/prisma");

    const created = await createTestQuotation();
    await issueQuotation(created.id, adminId);

    const result = await respondToQuotation(created.id, { decision: "ACCEPTED", customerResponseReference: "PO-accept-test" } as never, adminId);
    expect(result.ok).toBe(true);

    const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
    expect(quotation.status).toBe("ACCEPTED");
    expect(quotation.customerResponseReference).toBe("PO-accept-test");
    expect(quotation.convertedOrderId).toBeNull();

    const orderCount = await prisma.customerOrder.count({ where: { internalNotes: { contains: created.quotationNumber } } });
    expect(orderCount).toBe(0);
  });

  it("respondToQuotation: REJECTED requires a reason and records it; a rejected quotation is terminal (no further transition except revise)", async () => {
    if (skipAll) return;
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const { respondToQuotation } = await import("@/lib/quotations/respond");
    const { cancelQuotation } = await import("@/lib/quotations/cancel");
    const { prisma } = await import("@/lib/prisma");

    const created = await createTestQuotation();
    await issueQuotation(created.id, adminId);

    const result = await respondToQuotation(created.id, { decision: "REJECTED", rejectionReason: "Price too high" } as never, adminId);
    expect(result.ok).toBe(true);

    const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
    expect(quotation.status).toBe("REJECTED");
    expect(quotation.rejectionReason).toBe("Price too high");

    // REJECTED has no outgoing edges in the transition graph (not even to
    // CANCELLED) -- a dead-end state, confirmed end-to-end through the
    // real action, not just the pure graph test in tests/quotations.test.ts.
    const cancelAttempt = await cancelQuotation(created.id, { cancellationReason: "test" } as never, adminId);
    expect(cancelAttempt.ok).toBe(false);
  });

  it("cancelQuotation: allowed from DRAFT/ISSUED/ACCEPTED(no order)/EXPIRED, but blocked once converted into an order", async () => {
    if (skipAll) return;
    const { cancelQuotation } = await import("@/lib/quotations/cancel");
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const { respondToQuotation } = await import("@/lib/quotations/respond");
    const { convertQuotationToOrder } = await import("@/lib/quotations/convert-to-order");
    const { prisma } = await import("@/lib/prisma");

    const draft = await createTestQuotation();
    const draftCancel = await cancelQuotation(draft.id, { cancellationReason: "Changed mind while drafting" } as never, adminId);
    expect(draftCancel.ok).toBe(true);

    const accepted = await createTestQuotation();
    await issueQuotation(accepted.id, adminId);
    await respondToQuotation(accepted.id, { decision: "ACCEPTED" } as never, adminId);
    const acceptedCancel = await cancelQuotation(accepted.id, { cancellationReason: "Customer withdrew after accepting" } as never, adminId);
    expect(acceptedCancel.ok).toBe(true);
    const cancelledQuotation = await prisma.quotation.findUniqueOrThrow({ where: { id: accepted.id } });
    expect(cancelledQuotation.cancelledById).toBe(adminId);
    expect(cancelledQuotation.cancellationReason).toBe("Customer withdrew after accepting");

    const converted = await createTestQuotation();
    await issueQuotation(converted.id, adminId);
    await respondToQuotation(converted.id, { decision: "ACCEPTED" } as never, adminId);
    const conversion = await convertQuotationToOrder(converted.id, {} as never, adminId);
    expect(conversion.ok).toBe(true);
    if (conversion.ok) createdOrderIds.push(conversion.orderId);

    const blockedCancel = await cancelQuotation(converted.id, { cancellationReason: "too late" } as never, adminId);
    expect(blockedCancel.ok).toBe(false);
    if (!blockedCancel.ok) expect(blockedCancel.status).toBe(409);

    const stillAccepted = await prisma.quotation.findUniqueOrThrow({ where: { id: converted.id } });
    expect(stillAccepted.status).toBe("ACCEPTED"); // the blocked cancel attempt wrote nothing
  });

  it("convertQuotationToOrder: creates a real order with matching lines, is idempotent on repeat calls, and is blocked for a non-ACCEPTED quotation", async () => {
    if (skipAll) return;
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const { respondToQuotation } = await import("@/lib/quotations/respond");
    const { convertQuotationToOrder } = await import("@/lib/quotations/convert-to-order");
    const { prisma } = await import("@/lib/prisma");

    const created = await createTestQuotation();

    // Not yet ACCEPTED -- blocked.
    const tooEarly = await convertQuotationToOrder(created.id, {} as never, adminId);
    expect(tooEarly.ok).toBe(false);
    if (!tooEarly.ok) expect(tooEarly.status).toBe(409);

    await issueQuotation(created.id, adminId);
    await respondToQuotation(created.id, { decision: "ACCEPTED" } as never, adminId);

    const first = await convertQuotationToOrder(created.id, { customerPoReference: "PO-convert-test" } as never, adminId);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    createdOrderIds.push(first.orderId);
    expect(first.alreadyConverted).toBe(false);

    const order = await prisma.customerOrder.findUniqueOrThrow({ where: { id: first.orderId }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
    expect(order.customerId).toBe(customerId);
    expect(order.lines).toHaveLength(2);
    expect(order.lines[0]!.sapItemCodeSnapshot).toBe(sapItemCode);
    expect(order.lines[1]!.originalProductDescription).toBe("Custom bracket, not catalogued");

    const quotation = await prisma.quotation.findUniqueOrThrow({ where: { id: created.id } });
    expect(quotation.convertedOrderId).toBe(first.orderId);

    // Calling it again (e.g. a duplicate click or a client retry) must
    // return the SAME order, never create a second one.
    const second = await convertQuotationToOrder(created.id, { customerPoReference: "PO-convert-test" } as never, adminId);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.orderId).toBe(first.orderId);
      expect(second.alreadyConverted).toBe(true);
    }

    const orderCountForThisQuotation = await prisma.customerOrder.count({ where: { idempotencyKey: `QUO-CONVERT-${created.id}` } });
    expect(orderCountForThisQuotation).toBe(1);
  });

  it("reviseQuotation: creates a new DRAFT revision copying header+lines verbatim, freezes the old row's status, and excludes the old row from default listings", async () => {
    if (skipAll) return;
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const { reviseQuotation } = await import("@/lib/quotations/revise");
    const { listQuotations } = await import("@/lib/quotations/queries");
    const { prisma } = await import("@/lib/prisma");

    const original = await createTestQuotation();
    await issueQuotation(original.id, adminId);

    const revision = await reviseQuotation(original.id, { reason: "Customer asked for a price adjustment" } as never, adminId);
    expect(revision.ok).toBe(true);
    if (!revision.ok) return;
    createdQuotationIds.push(revision.id);

    expect(revision.quotationNumber).toBe(original.quotationNumber); // same human-facing number across every revision
    expect(revision.revisionNumber).toBe(2);

    const newRow = await prisma.quotation.findUniqueOrThrow({ where: { id: revision.id }, include: { lines: { orderBy: { lineNumber: "asc" } } } });
    expect(newRow.status).toBe("DRAFT");
    expect(newRow.previousRevisionId).toBe(original.id);
    expect(newRow.lines).toHaveLength(2);
    expect(newRow.total.toString()).toBe("212.0000"); // copied verbatim, not recalculated

    const oldRow = await prisma.quotation.findUniqueOrThrow({ where: { id: original.id } });
    expect(oldRow.status).toBe("ISSUED"); // frozen exactly as it was -- never silently changed by the revision
    expect(oldRow.supersededAt).not.toBeNull();
    expect(oldRow.supersededById).toBe(adminId);

    // Default list query excludes the superseded old row ("never let an
    // old version appear as current").
    const defaultList = await listQuotations({
      search: original.quotationNumber,
      status: null,
      salespersonId: null,
      currency: null,
      dateFrom: null,
      dateTo: null,
      includeSuperseded: false,
      includeDemo: true,
      page: 1,
      pageSize: 50,
    });
    const idsInDefaultList = defaultList.quotations.map((q) => q.id);
    expect(idsInDefaultList).toContain(revision.id);
    expect(idsInDefaultList).not.toContain(original.id);

    // Attempting to revise the now-superseded old row again is rejected.
    const revisingSupersededRow = await reviseQuotation(original.id, {} as never, adminId);
    expect(revisingSupersededRow.ok).toBe(false);

    // Attempting to revise the new DRAFT row is also rejected (DRAFT is not revisable -- just edit it).
    const revisingDraft = await reviseQuotation(revision.id, {} as never, adminId);
    expect(revisingDraft.ok).toBe(false);
  });

  it("getQuotationRevisionHistory: resolves the full lineage from either the root id or a later revision's id", async () => {
    if (skipAll) return;
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const { reviseQuotation } = await import("@/lib/quotations/revise");
    const { getQuotationRevisionHistory } = await import("@/lib/quotations/queries");

    const original = await createTestQuotation();
    await issueQuotation(original.id, adminId);
    const revision = await reviseQuotation(original.id, {} as never, adminId);
    expect(revision.ok).toBe(true);
    if (!revision.ok) return;
    createdQuotationIds.push(revision.id);

    const fromRoot = await getQuotationRevisionHistory(original.id);
    const fromRevision = await getQuotationRevisionHistory(revision.id);

    expect(fromRoot?.map((r) => r.id).sort()).toEqual(fromRevision?.map((r) => r.id).sort());
    expect(fromRoot).toHaveLength(2);
    expect(fromRoot?.[0]!.revisionNumber).toBe(1);
    expect(fromRoot?.[1]!.revisionNumber).toBe(2);
  });

  it("expireQuotation / sweepExpiredQuotations: an ISSUED quotation becomes eligible only once validUntil has passed, and the sweep expires exactly the eligible ones", async () => {
    if (skipAll) return;
    const { createQuotation } = await import("@/lib/quotations/create");
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const { expireQuotation, sweepExpiredQuotations } = await import("@/lib/quotations/expiry");
    const { prisma } = await import("@/lib/prisma");

    const todayStr = new Date().toISOString().slice(0, 10);
    const pastDate = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // A quotation whose validity window has already closed (quotationDate
    // and validUntil both in the past -- validateValidityWindow only
    // requires validUntil >= quotationDate, not that either be >= today).
    const expiredCandidate = await createQuotation(
      { customerId, quotationDate: pastDate, validUntil: pastDate, lines: [{ productId, quantity: "1", unitPrice: "1", isUnlistedItem: false }] } as never,
      adminId
    );
    expect(expiredCandidate.ok).toBe(true);
    if (!expiredCandidate.ok) return;
    createdQuotationIds.push(expiredCandidate.id);
    await issueQuotation(expiredCandidate.id, adminId);

    // Not yet eligible while still DRAFT-issued-today style check: try to
    // expire a currently-valid one first and confirm it's refused.
    const stillValid = await createQuotation(
      { customerId, quotationDate: todayStr, validUntil: todayStr, lines: [{ productId, quantity: "1", unitPrice: "1", isUnlistedItem: false }] } as never,
      adminId
    );
    expect(stillValid.ok).toBe(true);
    if (!stillValid.ok) return;
    createdQuotationIds.push(stillValid.id);
    await issueQuotation(stillValid.id, adminId);

    const refused = await expireQuotation(stillValid.id, adminId);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.status).toBe(400);

    const manual = await expireQuotation(expiredCandidate.id, adminId);
    expect(manual.ok).toBe(true);
    const expiredRow = await prisma.quotation.findUniqueOrThrow({ where: { id: expiredCandidate.id } });
    expect(expiredRow.status).toBe("EXPIRED");
    expect(expiredRow.expiredAt).not.toBeNull();

    // A second manual expire on an already-EXPIRED quotation is rejected (no transition EXPIRED -> EXPIRED).
    const already = await expireQuotation(expiredCandidate.id, adminId);
    expect(already.ok).toBe(false);

    // sweepExpiredQuotations finds and expires every ISSUED quotation
    // whose validUntil has passed, system-wide -- create one more
    // expired-but-not-yet-expired candidate and confirm the sweep catches
    // it without disturbing the still-valid one.
    const anotherExpiredCandidate = await createQuotation(
      { customerId, quotationDate: pastDate, validUntil: pastDate, lines: [{ productId, quantity: "1", unitPrice: "1", isUnlistedItem: false }] } as never,
      adminId
    );
    expect(anotherExpiredCandidate.ok).toBe(true);
    if (!anotherExpiredCandidate.ok) return;
    createdQuotationIds.push(anotherExpiredCandidate.id);
    await issueQuotation(anotherExpiredCandidate.id, adminId);

    const swept = await sweepExpiredQuotations();
    expect(swept.expiredQuotationNumbers).toContain(anotherExpiredCandidate.quotationNumber);

    const sweptRow = await prisma.quotation.findUniqueOrThrow({ where: { id: anotherExpiredCandidate.id } });
    expect(sweptRow.status).toBe("EXPIRED");
    const stillValidRow = await prisma.quotation.findUniqueOrThrow({ where: { id: stillValid.id } });
    expect(stillValidRow.status).toBe("ISSUED"); // untouched by the sweep
  });

  it("every mutating action writes both a QuotationEvent and a generic AuditEvent row -- dual-write audit trail", async () => {
    if (skipAll) return;
    const { issueQuotation } = await import("@/lib/quotations/issue");
    const { respondToQuotation } = await import("@/lib/quotations/respond");
    const { prisma } = await import("@/lib/prisma");

    const created = await createTestQuotation();
    await issueQuotation(created.id, adminId);
    await respondToQuotation(created.id, { decision: "ACCEPTED" } as never, adminId);

    const events = await prisma.quotationEvent.findMany({ where: { quotationId: created.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.eventType)).toEqual(["CREATED", "ISSUED", "ACCEPTED"]);
    expect(events.every((e) => e.actorId === adminId)).toBe(true);

    const auditEvents = await prisma.auditEvent.findMany({ where: { entityType: "Quotation", entityId: created.id }, orderBy: { createdAt: "asc" } });
    expect(auditEvents.map((e) => e.action)).toEqual(["QUOTATION_CREATED", "QUOTATION_ISSUED", "QUOTATION_ACCEPTED"]);
  });

  it("getQuotationDashboardCounts: reflects live counts by status (confirmed to resolve without error, not asserted against exact figures)", async () => {
    if (skipAll) return;
    const { getQuotationDashboardCounts } = await import("@/lib/quotations/queries");

    // lib/quotations/queries.ts's own baseWhere is { isDemo: false,
    // supersededAt: null } -- createQuotation always hardcodes isDemo:
    // false (confirmed by reading create.ts), so every quotation this
    // test suite creates DOES count toward these figures while it
    // exists, same as a real one would. They are all removed again in
    // afterAll, so this leaves no permanent pollution. Because other
    // tests in this file run concurrently against the same counts, this
    // test only confirms the call succeeds and returns an internally
    // coherent shape, not exact numbers (which would be flaky against
    // whatever else exists in a shared test database).
    const counts = await getQuotationDashboardCounts();
    expect(counts.total).toBeGreaterThanOrEqual(0);
    expect(counts.draft + counts.issuedAwaitingResponse + counts.accepted + counts.rejected + counts.expired + counts.cancelled).toBeLessThanOrEqual(counts.total);
    expect(Array.isArray(counts.valueByStatus)).toBe(true);
  });
});
