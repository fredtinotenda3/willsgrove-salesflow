import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Real Business Data Onboarding round (spec PART A, Phase 4). DB-backed
 * acceptance tests for the two Phase 4 additions -- importing the real
 * multi-sheet Prices.xlsx (lib/sap-price-list-xlsx.ts) through the
 * EXISTING, unmodified plan/execute engine (lib/price-list-import.ts),
 * and assigning a customer's price list (lib/customer-validation.ts's/
 * lib/customers.ts's new priceListId handling, driving the new Customer
 * Pricing page) -- against a REAL database through a REAL generated
 * @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as every other
 * *-db.integration test in this project (@prisma/client-stub sandbox
 * limitation -- see docs/milestones/PROGRESS.md's "Sandbox-only
 * blocker"). Every lib touched here is imported with a dynamic
 * `await import(...)` inside the (skippable) test bodies below. This
 * means these tests have NOT been executed in this sandbox -- only
 * verified to typecheck/lint and to match every function signature read
 * directly from the source files they call.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user, a
 * DEMO-CUST-* customer, and at least one real, active product must
 * already exist).
 *
 * Also exercises the one real connection point between this phase and
 * the prior one: lib/lost-sales/estimate-value.ts's PRICE_LIST_ENTRY
 * fallback (Milestone 4) only ever resolves to a real price once a
 * customer actually has a priceListId AND that list has a priced entry
 * for the product -- neither was reachable through any UI before this
 * phase. That is proven here directly rather than assumed.
 *
 * Every row this test creates is isDemo: true where the model supports
 * it, and cleaned up in afterAll in FK-respecting order. PriceList/
 * PriceListEntry rows this test creates use a unique, per-run code
 * (uniqueSuffix) so re-runs never collide with a prior run's leftovers
 * or with the real imported SPARUSD/THEFRESHPLUG/etc. lists.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Real Business Data Onboarding Phase 4: price lists and customer pricing", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let productId: string;
  let productSapCode: string;
  const uniqueSuffix = `p4test-${Date.now()}`;
  const priceListCode = `TESTLIST-${uniqueSuffix}`;

  const createdPriceListIds: string[] = [];
  const createdOrderIds: string[] = [];
  let originalCustomerPriceListId: string | null = null;

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({
      where: { sapCustomerCode: { startsWith: "DEMO-CUST" } },
      select: { id: true, priceListId: true },
    });
    const products = await prisma.product.findMany({
      where: { isDemo: false, status: "ACTIVE" },
      orderBy: { sapItemCode: "asc" },
      take: 1,
      select: { id: true, sapItemCode: true },
    });

    if (!admin || !customer || products.length < 1) {
      console.log(
        "Skipping Phase 4 price-list/customer-pricing DB integration test: need an admin user, a " +
          "DEMO-CUST-* customer, and at least one active product. Run `npm run db:seed` first, then " +
          "re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;
    originalCustomerPriceListId = customer.priceListId;
    productId = products[0]!.id;
    productSapCode = products[0]!.sapItemCode;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      await prisma.lostSaleRecord.deleteMany({ where: { unfulfilledDemand: { orderId: { in: createdOrderIds } } } });
      await prisma.unfulfilledDemand.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.orderLine.deleteMany({ where: { orderId: { in: createdOrderIds } } });
      await prisma.customerOrder.deleteMany({ where: { id: { in: createdOrderIds } } });

      // Restore the customer's original assignment before dropping the
      // test PriceList (its onDelete: SetNull would otherwise leave the
      // customer's priceListId silently nulled instead of back to what
      // it was before this test ran).
      if (!skipAll) {
        await prisma.customer.update({ where: { id: customerId }, data: { priceListId: originalCustomerPriceListId } });
      }

      await prisma.priceListEntry.deleteMany({ where: { priceListId: { in: createdPriceListIds } } });
      await prisma.priceList.deleteMany({ where: { id: { in: createdPriceListIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  it("imports the real multi-sheet Prices.xlsx shape end-to-end: parse -> plan -> execute, then idempotently re-imports with no changes", async () => {
    if (skipAll) return;

    const ExcelJS = (await import("exceljs")).default;
    const { parseSapPriceListXlsxBuffer } = await import("@/lib/sap-price-list-xlsx");
    const { planPriceListImport, executePriceListImport } = await import("@/lib/price-list-import");
    const { prisma } = await import("@/lib/prisma");

    async function buildWorkbookBuffer(price: string): Promise<Buffer> {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("TESTLIST");
      worksheet.addRow(["Item No.", "Item Description", "Base Price List", "Factor", "Base Price", "Price", "Manual", "Stock UoM", "Pricing Unit"]);
      // Passed as the real Product.sapItemCode string directly (e.g.
      // "0228") rather than reverse-engineering what numeric Item No.
      // would zero-pad back to it -- canonicalItemCode's numeric-string
      // branch (lib/sap-price-list-xlsx.ts) padStarts a digit string to 4
      // chars, which is a no-op when it's already 4, so this round-trips
      // correctly whether the real seeded product's code is numeric or
      // one of the 5 real alphanumeric codes.
      worksheet.addRow([productSapCode, "Test item", priceListCode, 1, price, price, "N", "Manual", "Manual"]);
      const arrayBuffer = await workbook.xlsx.writeBuffer();
      return Buffer.from(arrayBuffer as ArrayBuffer);
    }

    // First import: USD 1.23.
    const firstBuffer = await buildWorkbookBuffer("USD 1.23");
    const firstParsed = await parseSapPriceListXlsxBuffer(firstBuffer, "2026-01-01");
    expect(firstParsed.success).toBe(true);
    expect(firstParsed.rows).toHaveLength(1);
    expect(firstParsed.rows[0]!.priceListCode).toBe(priceListCode);
    expect(firstParsed.rows[0]!.itemCode).toBe(productSapCode);

    const firstPlan = await planPriceListImport(firstParsed.rows);
    expect(firstPlan.newLists.map((l) => l.code)).toContain(priceListCode);
    expect(firstPlan.newEntries).toHaveLength(1);
    expect(firstPlan.unmatchedItemCodes).not.toContain(productSapCode); // the real product exists

    const firstResult = await executePriceListImport(firstPlan, "test-prices.xlsx");
    expect(firstResult.listsCreated).toBe(1);
    expect(firstResult.entriesCreated).toBe(1);

    const createdList = await prisma.priceList.findUnique({ where: { code: priceListCode }, select: { id: true } });
    expect(createdList).not.toBeNull();
    createdPriceListIds.push(createdList!.id);

    const entry = await prisma.priceListEntry.findFirst({ where: { priceListId: createdList!.id } });
    expect(entry?.unitPrice.toString()).toBe("1.23");
    expect(entry?.productId).toBe(productId); // resolved by zero-padded sapItemCode match

    const auditEvent = await prisma.auditEvent.findUnique({ where: { id: firstResult.auditEventId } });
    expect(auditEvent?.action).toBe("PRICE_LIST_IMPORT");

    // Re-importing the identical data (same validFrom) reports nothing to
    // change -- proves the plan step's unitPrice/validTo comparison, not
    // just that executePriceListImport can run twice.
    const secondParsed = await parseSapPriceListXlsxBuffer(firstBuffer, "2026-01-01");
    const secondPlan = await planPriceListImport(secondParsed.rows);
    expect(secondPlan.newEntries).toHaveLength(0);
    expect(secondPlan.changedEntries).toHaveLength(0);
    expect(secondPlan.unchangedEntryCount).toBe(1);

    // A price change on the SAME validFrom updates the existing entry
    // rather than creating a second row for that date.
    const changedBuffer = await buildWorkbookBuffer("USD 4.56");
    const changedParsed = await parseSapPriceListXlsxBuffer(changedBuffer, "2026-01-01");
    const changedPlan = await planPriceListImport(changedParsed.rows);
    expect(changedPlan.newEntries).toHaveLength(0);
    expect(changedPlan.changedEntries).toHaveLength(1);

    await executePriceListImport(changedPlan, "test-prices-updated.xlsx");
    const entriesAfterChange = await prisma.priceListEntry.findMany({ where: { priceListId: createdList!.id } });
    expect(entriesAfterChange).toHaveLength(1); // updated in place, not duplicated
    expect(entriesAfterChange[0]!.unitPrice.toString()).toBe("4.56");
  });

  it("assigns, rejects an unknown, and unassigns a customer's price list via updateCustomer", async () => {
    if (skipAll) return;

    const { updateCustomer } = await import("@/lib/customers");
    const { prisma } = await import("@/lib/prisma");

    const list = createdPriceListIds[0];
    if (!list) {
      throw new Error("Expected the first test to have created a PriceList already.");
    }

    const assignResult = await updateCustomer(customerId, { priceListId: list });
    expect(assignResult.ok).toBe(true);
    if (assignResult.ok) expect(assignResult.changed).toBe(true);

    const afterAssign = await prisma.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });
    expect(afterAssign?.priceListId).toBe(list);

    const auditAfterAssign = await prisma.auditEvent.findFirst({
      where: { entityType: "Customer", entityId: customerId, action: "CUSTOMER_UPDATE" },
      orderBy: { createdAt: "desc" },
    });
    expect((auditAfterAssign?.afterData as Record<string, unknown> | null)?.priceListId).toBe(list);

    const rejectResult = await updateCustomer(customerId, { priceListId: "this-id-does-not-exist" });
    expect(rejectResult.ok).toBe(false);
    if (!rejectResult.ok) {
      expect(rejectResult.status).toBe(400);
      expect(rejectResult.fieldErrors?.priceListId).toBeDefined();
    }
    // The rejected update must not have changed anything.
    const afterReject = await prisma.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });
    expect(afterReject?.priceListId).toBe(list);

    const unassignResult = await updateCustomer(customerId, { priceListId: null });
    expect(unassignResult.ok).toBe(true);
    const afterUnassign = await prisma.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });
    expect(afterUnassign?.priceListId).toBeNull();
  });

  /**
   * Real-world fix (bulk price-list assignment): the real customer-master
   * export has no price-list column at all, so this is the only
   * realistic way to assign a price list to more than a handful of
   * customers. Scoped with search: "DEMO-CUST" -- the fixture customer's
   * own sapCustomerCode prefix (beforeAll) -- so this never touches any
   * of the real, non-demo customers already imported into this database.
   */
  it("bulkAssignPriceList assigns every customer matching the filter, rejects an unknown target, and unassigns", async () => {
    if (skipAll) return;

    const { bulkAssignPriceList } = await import("@/lib/customers");
    const { prisma } = await import("@/lib/prisma");

    const list = createdPriceListIds[0];
    if (!list) {
      throw new Error("Expected the first test to have created a PriceList already.");
    }

    const filter = { search: "DEMO-CUST", category: null, status: null, priceListId: null };

    const assignResult = await bulkAssignPriceList(filter, list, false);
    expect(assignResult.ok).toBe(true);
    if (assignResult.ok) expect(assignResult.matchedCount).toBeGreaterThanOrEqual(1);

    const afterAssign = await prisma.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });
    expect(afterAssign?.priceListId).toBe(list);

    const auditAfterAssign = await prisma.auditEvent.findFirst({
      where: { entityType: "Customer", entityId: "bulk", action: "CUSTOMER_BULK_PRICE_LIST_ASSIGN" },
      orderBy: { createdAt: "desc" },
    });
    const afterData = auditAfterAssign?.afterData as Record<string, unknown> | null;
    expect(afterData?.targetPriceListId).toBe(list);
    // Incident follow-up: beforeData must capture what the matched
    // customers' priceListId distribution was BEFORE this overwrote it,
    // so a mistaken bulk-assign (like the production incident) can be
    // diagnosed from the audit log, not just detected after the fact.
    const beforeData = auditAfterAssign?.beforeData as { byPreviousPriceListId?: { priceListId: string | null; count: number }[] } | null;
    expect(beforeData?.byPreviousPriceListId).toBeDefined();
    expect(beforeData!.byPreviousPriceListId!.reduce((sum, g) => sum + g.count, 0)).toBe(assignResult.ok ? assignResult.matchedCount : -1);

    const rejectResult = await bulkAssignPriceList(filter, "this-id-does-not-exist", false);
    expect(rejectResult.ok).toBe(false);
    if (!rejectResult.ok) {
      expect(rejectResult.status).toBe(400);
      expect(rejectResult.fieldErrors?.priceListId).toBeDefined();
    }
    // The rejected bulk assignment must not have changed anything.
    const afterReject = await prisma.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });
    expect(afterReject?.priceListId).toBe(list);

    const unassignResult = await bulkAssignPriceList(filter, null, false);
    expect(unassignResult.ok).toBe(true);
    const afterUnassign = await prisma.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });
    expect(afterUnassign?.priceListId).toBeNull();
  });

  /**
   * Incident follow-up: in production, a scoped TM-USD bulk-assign was
   * immediately overwritten by a SECOND bulk-assign whose search box had
   * been cleared -- an empty filter matches every customer, and nothing
   * stopped that from running. This is the regression test for the fix:
   * bulkAssignPriceList must refuse an effectively-empty filter unless
   * the caller explicitly passes confirmedUnfiltered: true, and must
   * leave data untouched when it refuses.
   */
  it("bulkAssignPriceList refuses an effectively-empty filter unless confirmedUnfiltered is true", async () => {
    if (skipAll) return;

    const { bulkAssignPriceList } = await import("@/lib/customers");
    const { prisma } = await import("@/lib/prisma");

    const list = createdPriceListIds[0];
    if (!list) {
      throw new Error("Expected the first test to have created a PriceList already.");
    }

    const beforeState = await prisma.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });

    const emptyFilter = { search: "", category: null, status: null, priceListId: null };

    const refused = await bulkAssignPriceList(emptyFilter, list, false);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.status).toBe(400);
      expect(refused.fieldErrors?.filter).toBeDefined();
    }

    // Refused: the fixture customer (and by extension every other real
    // customer this filter would otherwise have matched) must be
    // untouched.
    const afterRefused = await prisma.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });
    expect(afterRefused?.priceListId).toBe(beforeState?.priceListId ?? null);

    // Deliberately NOT tested here: actually running bulkAssignPriceList
    // with confirmedUnfiltered: true against this empty filter. That
    // would, correctly, reassign EVERY customer in whatever database
    // this test runs against -- exactly the blast radius that caused the
    // production incident. There is no way to "clean up" after that in a
    // shared/seeded database without assuming every customer shared the
    // same prior priceListId, which isn't true here and wouldn't be true
    // against real data either. The guard's happy path (confirmed: true
    // simply skips the early return and falls through to the same
    // updateMany/transaction the "assigns every customer matching the
    // filter" test above already exercises with a safely scoped filter)
    // is covered by code review and the isFilterEffectivelyEmpty checks
    // below, not by actually running the unscoped case.
  });

  it("isFilterEffectivelyEmpty treats any search/category/status/priceListId as scoping, and only a fully bare filter as empty", async () => {
    if (skipAll) return;

    const { isFilterEffectivelyEmpty } = await import("@/lib/customer-queries");
    const { RecordStatus } = await import("@prisma/client");

    expect(isFilterEffectivelyEmpty({ search: "", category: null, status: null, priceListId: null })).toBe(true);
    expect(isFilterEffectivelyEmpty({ search: "TM Supermarkets", category: null, status: null, priceListId: null })).toBe(false);
    expect(isFilterEffectivelyEmpty({ search: "", category: "Retail", status: null, priceListId: null })).toBe(false);
    expect(isFilterEffectivelyEmpty({ search: "", category: null, status: RecordStatus.ACTIVE, priceListId: null })).toBe(false);
    expect(isFilterEffectivelyEmpty({ search: "", category: null, status: null, priceListId: "UNASSIGNED" })).toBe(false);
  });

  it("connects the two phases: resolveEstimatedLostSaleValue falls back to the customer's assigned PriceList entry", async () => {
    if (skipAll) return;

    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { updateCustomer } = await import("@/lib/customers");
    const { resolveEstimatedLostSaleValue } = await import("@/lib/lost-sales/estimate-value");

    const list = createdPriceListIds[0];
    if (!list) {
      throw new Error("Expected the first test to have created a PriceList already.");
    }

    const assign = await updateCustomer(customerId, { priceListId: list });
    expect(assign.ok).toBe(true);

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
              originalProductDescription: `Phase 4 estimate-value test item ${uniqueSuffix}`,
              productId,
              sapItemCodeSnapshot: productSapCode,
              requestedQuantity: "5.0000",
              requestedUnitCode: "EA",
              approvedUnitPrice: null, // forces the PRICE_LIST_ENTRY fallback, not ORDER_LINE_APPROVED_PRICE
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    createdOrderIds.push(order.id);
    const lineId = order.lines[0]!.id;

    const estimate = await prisma.$transaction(async (tx) =>
      resolveEstimatedLostSaleValue(tx, {
        orderLineId: lineId,
        customerId,
        productId,
        sapItemCodeSnapshot: productSapCode,
        quantity: "5.0000",
        asOf: new Date("2026-06-01"), // after the "2026-01-01" validFrom, no validTo -- still in effect
      })
    );

    expect(estimate).not.toBeNull();
    expect(estimate?.source).toBe("PRICE_LIST_ENTRY");
    expect(estimate?.unitPrice).toBe("4.56"); // the changed price from the first test
    // multiplyDecimalStrings (lib/lost-sales/validation.ts) always formats
    // to exactly 4 fractional digits via formatScaledDecimal -- "22.8000",
    // not "22.80" -- see that function's own module comment.
    expect(estimate?.value).toBe("22.8000"); // 5 x 4.56
  });

  it("Follow-up fix: resolveCustomerPriceListUnitPrice (quotation-line price prefill) returns the same real price, and null for an unassigned customer or unpriced product", async () => {
    if (skipAll) return;

    const { resolveCustomerPriceListUnitPrice } = await import("@/lib/price-list-queries");
    const { updateCustomer } = await import("@/lib/customers");

    // customerId is still assigned to createdPriceListIds[0] from the
    // prior test, at the changed price "4.56" effective from
    // "2026-01-01" with no validTo.
    const found = await resolveCustomerPriceListUnitPrice(customerId, productId, new Date("2026-06-01"));
    expect(found).not.toBeNull();
    expect(found?.unitPrice).toBe("4.56");
    expect(found?.priceListCode).toBeTruthy();

    // A date before this price's validFrom -- no entry is in effect yet,
    // never fall back to a guessed/older price that wasn't actually
    // valid on that date.
    const tooEarly = await resolveCustomerPriceListUnitPrice(customerId, productId, new Date("2020-01-01"));
    expect(tooEarly).toBeNull();

    const unassign = await updateCustomer(customerId, { priceListId: null });
    expect(unassign.ok).toBe(true);
    const noList = await resolveCustomerPriceListUnitPrice(customerId, productId, new Date("2026-06-01"));
    expect(noList).toBeNull();
  });
});
