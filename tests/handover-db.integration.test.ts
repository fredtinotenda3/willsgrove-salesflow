import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 2C, substantially reworked in Milestone 3C (SAP Invoice
 * Handover Specification). DB-backed acceptance tests for the handover
 * feature -- buildHandoverRows' three-way product-match fallback (now
 * sourced from an AUTHORIZED PickingSession's picked quantities, never
 * OrderLine.requestedQuantity), the hard gate on OrderStatus.READY_TO_INVOICE,
 * the "omit a fully-unavailable line entirely" rule, Handover Reference
 * generation, generateHandover's append-only OrderHandover rows and
 * once-only handedToSapAt marker, and that every format (Excel/CSV/
 * clipboard) really is built from that same row set -- against a REAL
 * database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same one reason as
 * tests/matching-review-db.integration.test.ts, tests/orders-db.integration.test.ts,
 * and tests/picking-db.integration.test.ts: @prisma/client in this sandbox is
 * a stub that THROWS when merely constructed (see
 * docs/milestones/PROGRESS.md's "Sandbox-only blocker"). Every lib
 * touched here (lib/handover/*, lib/picking/*, lib/storage, lib/prisma)
 * is imported with a dynamic `await import(...)` INSIDE the (skippable)
 * test bodies below, never a static top-of-file import, for the same
 * reason given there.
 *
 * On your machine, where `prisma generate` has actually run against a
 * real schema, set RUN_DB_INTEGRATION_TESTS=1 to include it
 * (DATABASE_URL is already required for every other command you run):
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` at least once first, so an admin
 * user, at least one DEMO-CUST-* customer, and at least one real, active,
 * imported SAP product already exist -- this test looks them up rather
 * than creating its own catalogue/customer data, and skips itself with a
 * console message (not a failure) if any are missing.
 *
 * Every row this test creates is marked isDemo: true, and every stored
 * file (an Excel/CSV handover's bytes) is deleted via the real storage
 * driver in afterAll -- nothing here ever touches real, non-demo data or
 * leaves orphaned files on disk.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 3C: handover generation (authorized picking -> SAP handover)", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let productAId: string;
  let productAItemName: string;
  let productASapCode: string;

  const createdOrderIds: string[] = [];
  const createdStorageKeys: string[] = [];
  const uniqueSuffix = `inttest-${Date.now()}`;

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({
      where: { sapCustomerCode: { startsWith: "DEMO-CUST" } },
      select: { id: true },
    });
    const product = await prisma.product.findFirst({
      where: { isDemo: false, status: "ACTIVE" },
      orderBy: { sapItemCode: "asc" },
      select: { id: true, itemName: true, sapItemCode: true },
    });

    if (!admin || !customer || !product) {
      console.log(
        "Skipping Milestone 3C handover DB integration test: need an admin user, a DEMO-CUST-* customer, " +
          "and at least one active product. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;
    productAId = product.id;
    productAItemName = product.itemName;
    productASapCode = product.sapItemCode;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    const { getStorageDriver } = await import("@/lib/storage");
    try {
      const storage = getStorageDriver();
      for (const key of createdStorageKeys) {
        await storage.delete(key).catch(() => undefined);
      }
      for (const orderId of createdOrderIds) {
        await prisma.orderHandover.deleteMany({ where: { orderId } });
        // PickingSession.order is onDelete: Restrict, so every session
        // for this order must go before the order itself can -- its
        // PickingLines cascade automatically (onDelete: Cascade).
        await prisma.pickingSession.deleteMany({ where: { orderId } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
        await prisma.orderLine.deleteMany({ where: { orderId } });
        await prisma.auditEvent.deleteMany({ where: { entityType: { in: ["CustomerOrder", "OrderHandover"] }, entityId: orderId } });
      }
      for (const orderId of createdOrderIds) {
        await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => undefined);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  /**
   * A fresh order with three lines exercising buildHandoverRows' full
   * three-way product-match fallback: a live product match, a
   * snapshot-only match (the product has since been removed from the
   * catalogue), and no match at all. Quantities are deliberately chosen
   * so the picked (found) quantity differs from the requested quantity
   * on two of the three lines, so a test asserting the handover sources
   * from the PICKED quantity can't accidentally pass by coincidence:
   *   - Line 1 (live match):      requested 10, found 10, unavailable 0.
   *   - Line 2 (snapshot-only):   requested 5,  found 3,  unavailable 2.
   *   - Line 3 (no match at all): requested 1,  found 0,  unavailable 1
   *     -- 100% unavailable, so per your confirmed Milestone 3A decision
   *     this line must be entirely OMITTED from the handover.
   */
  async function createThreeLineOrder() {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");

    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        orderDate: new Date("2026-11-01T00:00:00.000Z"),
        requestedDeliveryDate: new Date("2026-11-05T00:00:00.000Z"),
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [
            {
              lineNumber: 1,
              originalProductDescription: `Live match ${uniqueSuffix}`,
              productId: productAId,
              requestedQuantity: "10.0000",
              requestedUnitCode: "EA",
              isDemo: true,
            },
            {
              lineNumber: 2,
              originalProductDescription: `Snapshot-only match ${uniqueSuffix}`,
              productId: null,
              sapItemCodeSnapshot: `SNAP-${uniqueSuffix}`,
              requestedQuantity: "5.0000",
              requestedUnitCode: "KG",
              isDemo: true,
            },
            {
              lineNumber: 3,
              originalProductDescription: `No match at all ${uniqueSuffix}`,
              productId: null,
              sapItemCodeSnapshot: null,
              requestedQuantity: "1.0000",
              requestedUnitCode: "BOX",
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  /**
   * Drives the real Milestone 3A lifecycle (start -> record each line ->
   * complete -> authorize) through the actual lib/picking/* functions
   * rather than hand-inserting PickingSession/PickingLine rows -- this
   * exercises the real pipeline end to end and stays correct even if
   * that module's internal shape changes later. `picks` maps each
   * OrderLine's lineNumber to its found/unavailable split. Returns the
   * authorized session's id. Leaves the order at OrderStatus.READY_TO_INVOICE.
   */
  async function pickAndAuthorizeFully(orderId: string, picks: Record<number, { found: string; unavailable: string }>) {
    const { prisma } = await import("@/lib/prisma");
    const { startPickingSession } = await import("@/lib/picking/start-picking");
    const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
    const { completePickingSession } = await import("@/lib/picking/complete-picking");
    const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

    const orderLines = await prisma.orderLine.findMany({
      where: { orderId },
      orderBy: { lineNumber: "asc" },
      select: { id: true, lineNumber: true },
    });

    const started = await startPickingSession(orderId, adminId);
    if (!started.ok) throw new Error(started.message);

    for (const orderLine of orderLines) {
      const pick = picks[orderLine.lineNumber];
      if (!pick) continue;
      const recorded = await recordPickedLine(started.session.id, orderLine.id, pick.found, pick.unavailable, undefined, adminId);
      if (!recorded.ok) throw new Error(recorded.message);
    }

    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);

    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    return started.session.id;
  }

  const THREE_LINE_PICKS = {
    1: { found: "10.0000", unavailable: "0.0000" },
    2: { found: "3.0000", unavailable: "2.0000" },
    3: { found: "0.0000", unavailable: "1.0000" },
  };

  it("buildHandoverRows sources the PICKED quantity (not requested), applies the three-way fallback, omits a fully-unavailable line, and refuses before picking is authorized", async () => {
    if (skipAll) return;
    const { buildHandoverRows } = await import("@/lib/handover/build-handover-rows");

    const orderId = await createThreeLineOrder();

    // Before any picking has happened at all, generation must be refused.
    const beforePicking = await buildHandoverRows(orderId);
    expect(beforePicking.ok).toBe(false);
    if (beforePicking.ok) throw new Error("expected refusal before picking");
    expect(beforePicking.status).toBe(409);

    const sessionId = await pickAndAuthorizeFully(orderId, THREE_LINE_PICKS);

    const built = await buildHandoverRows(orderId);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);

    // Line 3 (100% unavailable) never becomes a row -- omitted, not
    // silently dropped: it's counted instead.
    expect(built.rows).toHaveLength(2);
    expect(built.omittedLineCount).toBe(1);
    expect(built.order.pickingSessionId).toBe(sessionId);
    expect(built.order.authorizedByName).toBeTruthy();

    const [liveMatch, snapshotOnly] = built.rows;

    // The PICKED quantity, not the requested one -- 10 for line 1 (picked
    // in full) and 3 for line 2 (partially unavailable; requested was 5).
    expect(liveMatch!.quantity).toBe("10.0000");
    expect(liveMatch!.matched).toBe(true);
    expect(liveMatch!.sapItemCode).toBe(productASapCode);
    expect(liveMatch!.officialDescription).toBe(productAItemName);
    expect(liveMatch!.note).toBeNull();

    expect(snapshotOnly!.quantity).toBe("3.0000");
    expect(snapshotOnly!.matched).toBe(true);
    expect(snapshotOnly!.sapItemCode).toBe(`SNAP-${uniqueSuffix}`);
    expect(snapshotOnly!.officialDescription).toBeNull();
    expect(snapshotOnly!.note).not.toBeNull();
  });

  it("generateHandover(EXCEL) creates a readable .xlsx with the richer header and 4-column table, an append-only OrderHandover row, a generated Handover Reference, and sets handedToSapAt once", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateHandover } = await import("@/lib/handover/generate-handover");
    const { getStorageDriver } = await import("@/lib/storage");
    const ExcelJS = (await import("exceljs")).default;

    const orderId = await createThreeLineOrder();
    await pickAndAuthorizeFully(orderId, THREE_LINE_PICKS);

    const firstResult = await generateHandover(orderId, adminId, "EXCEL", { isDemo: true });
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) throw new Error(firstResult.message);
    expect(firstResult.handover.lineCount).toBe(2);
    expect(firstResult.handover.matchedLineCount).toBe(2);
    expect(firstResult.handover.unmatchedLineCount).toBe(0);
    expect(firstResult.handover.omittedLineCount).toBe(1);
    expect(firstResult.handover.reference).toMatch(/^HND-\d{8}-[0-9A-F]{8}$/);
    expect(firstResult.handover.downloadUrl).toBeTruthy();

    const storedRow = await prisma.orderHandover.findUniqueOrThrow({
      where: { id: firstResult.handover.id },
      select: { format: true, storageKey: true, mimeType: true, fileSize: true, reference: true, pickingSessionId: true },
    });
    expect(storedRow.format).toBe("EXCEL");
    expect(storedRow.storageKey).toBeTruthy();
    expect(storedRow.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(Number(storedRow.fileSize)).toBeGreaterThan(0);
    expect(storedRow.reference).toBe(firstResult.handover.reference);
    expect(storedRow.pickingSessionId).toBeTruthy();
    createdStorageKeys.push(storedRow.storageKey!);

    // The stored bytes must be a real, readable .xlsx with the expected
    // structure -- not just "some bytes were written."
    const storage = getStorageDriver();
    const fileBytes = await storage.get(storedRow.storageKey!);
    expect(fileBytes).not.toBeNull();
    const workbook = new ExcelJS.Workbook();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(fileBytes as any);
    const sheet = workbook.getWorksheet("Handover");
    expect(sheet).toBeDefined();
    // 8 header/metadata rows + 1 blank + 1 column-header row + 2 data
    // rows + (one line is flagged: the snapshot-only match) 1 blank +
    // 1 "needing attention" header + 1 column-header row + 1 flagged row.
    expect(sheet!.rowCount).toBe(16);

    const orderAfterFirst = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId }, select: { handedToSapAt: true } });
    expect(orderAfterFirst.handedToSapAt).not.toBeNull();
    const handedToSapAtAfterFirst = orderAfterFirst.handedToSapAt!.getTime();

    // Regenerating (a different format) must NOT create a second
    // handedToSapAt bump -- the FIRST handover is what's recorded.
    const secondResult = await generateHandover(orderId, adminId, "CSV", { isDemo: true });
    expect(secondResult.ok).toBe(true);
    if (!secondResult.ok) throw new Error(secondResult.message);
    // A fresh Handover Reference every time, even for the same order.
    expect(secondResult.handover.reference).not.toBe(firstResult.handover.reference);
    const secondStoredRow = await prisma.orderHandover.findUniqueOrThrow({
      where: { id: secondResult.handover.id },
      select: { storageKey: true },
    });
    createdStorageKeys.push(secondStoredRow.storageKey!);

    const orderAfterSecond = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId }, select: { handedToSapAt: true } });
    expect(orderAfterSecond.handedToSapAt!.getTime()).toBe(handedToSapAtAfterFirst);

    // Append-only: both generations are real, separate rows.
    const allHandovers = await prisma.orderHandover.findMany({ where: { orderId } });
    expect(allHandovers).toHaveLength(2);
  });

  it("generateHandover(CSV) stores a file whose content matches buildHandoverRows' rows", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateHandover } = await import("@/lib/handover/generate-handover");
    const { buildHandoverRows } = await import("@/lib/handover/build-handover-rows");
    const { rowsToCsvText } = await import("@/lib/handover/format-rows");
    const { getStorageDriver } = await import("@/lib/storage");

    const orderId = await createThreeLineOrder();
    await pickAndAuthorizeFully(orderId, THREE_LINE_PICKS);

    const built = await buildHandoverRows(orderId);
    if (!built.ok) throw new Error(built.message);
    const expectedCsv = rowsToCsvText(built.rows);

    const result = await generateHandover(orderId, adminId, "CSV", { isDemo: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);

    const storedRow = await prisma.orderHandover.findUniqueOrThrow({
      where: { id: result.handover.id },
      select: { storageKey: true, mimeType: true },
    });
    createdStorageKeys.push(storedRow.storageKey!);
    expect(storedRow.mimeType).toBe("text/csv; charset=utf-8");

    const storage = getStorageDriver();
    const fileBytes = await storage.get(storedRow.storageKey!);
    expect(fileBytes?.toString("utf-8")).toBe(expectedCsv);
  });

  it("generateHandover(CLIPBOARD) stores nothing and returns the clipboard text directly", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateHandover } = await import("@/lib/handover/generate-handover");
    const { buildHandoverRows } = await import("@/lib/handover/build-handover-rows");
    const { rowsToClipboardText } = await import("@/lib/handover/format-rows");

    const orderId = await createThreeLineOrder();
    await pickAndAuthorizeFully(orderId, THREE_LINE_PICKS);

    const built = await buildHandoverRows(orderId);
    if (!built.ok) throw new Error(built.message);
    const expectedClipboardText = rowsToClipboardText(built.rows);

    const result = await generateHandover(orderId, adminId, "CLIPBOARD", { isDemo: true });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.handover.clipboardText).toBe(expectedClipboardText);
    expect(result.handover.downloadUrl).toBeUndefined();

    const storedRow = await prisma.orderHandover.findUniqueOrThrow({
      where: { id: result.handover.id },
      select: { storageKey: true, originalFileName: true, mimeType: true, fileSize: true },
    });
    expect(storedRow.storageKey).toBeNull();
    expect(storedRow.originalFileName).toBeNull();
    expect(storedRow.mimeType).toBeNull();
    expect(storedRow.fileSize).toBeNull();
  });

  it("refuses to generate a handover for a cancelled order", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateHandover } = await import("@/lib/handover/generate-handover");
    const { generateOrderReference } = await import("@/lib/orders");

    const cancelledOrder = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "CANCELLED",
        orderDate: new Date("2026-11-01T00:00:00.000Z"),
        requestedDeliveryDate: new Date("2026-11-05T00:00:00.000Z"),
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [
            {
              lineNumber: 1,
              originalProductDescription: `Cancelled order line ${uniqueSuffix}`,
              productId: productAId,
              requestedQuantity: "1.0000",
              requestedUnitCode: "EA",
              isDemo: true,
            },
          ],
        },
      },
      select: { id: true },
    });
    createdOrderIds.push(cancelledOrder.id);

    const result = await generateHandover(cancelledOrder.id, adminId, "EXCEL", { isDemo: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(409);
  });

  it("refuses to generate a handover for an order that hasn't completed and authorized picking yet, even mid-pick", async () => {
    if (skipAll) return;
    const { generateHandover } = await import("@/lib/handover/generate-handover");
    const { startPickingSession } = await import("@/lib/picking/start-picking");

    const orderId = await createThreeLineOrder();

    // Freshly received, picking not even started.
    const beforeStart = await generateHandover(orderId, adminId, "CLIPBOARD", { isDemo: true });
    expect(beforeStart.ok).toBe(false);
    if (!beforeStart.ok) expect(beforeStart.status).toBe(409);

    // Picking started but not completed/authorized -- OrderStatus.PICKING,
    // still not READY_TO_INVOICE.
    const started = await startPickingSession(orderId, adminId);
    if (!started.ok) throw new Error(started.message);

    const midPick = await generateHandover(orderId, adminId, "CLIPBOARD", { isDemo: true });
    expect(midPick.ok).toBe(false);
    if (!midPick.ok) expect(midPick.status).toBe(409);
  });

  it("listOrderHandovers surfaces each handover's reference and a download link only for stored formats (Milestone 3D coverage gap)", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateHandover } = await import("@/lib/handover/generate-handover");
    const { listOrderHandovers } = await import("@/lib/handover/queries");

    const orderId = await createThreeLineOrder();
    await pickAndAuthorizeFully(orderId, THREE_LINE_PICKS);

    const excelResult = await generateHandover(orderId, adminId, "EXCEL", { isDemo: true });
    if (!excelResult.ok) throw new Error(excelResult.message);
    const excelStoredRow = await prisma.orderHandover.findUniqueOrThrow({
      where: { id: excelResult.handover.id },
      select: { storageKey: true },
    });
    createdStorageKeys.push(excelStoredRow.storageKey!);

    const clipboardResult = await generateHandover(orderId, adminId, "CLIPBOARD", { isDemo: true });
    if (!clipboardResult.ok) throw new Error(clipboardResult.message);

    const list = await listOrderHandovers(orderId);
    expect(list).toHaveLength(2);

    const excelEntry = list.find((h) => h.id === excelResult.handover.id);
    expect(excelEntry).toBeDefined();
    expect(excelEntry!.reference).toBe(excelResult.handover.reference);
    expect(excelEntry!.downloadUrl).toBe(`/api/orders/${orderId}/handover/${excelResult.handover.id}/download`);

    const clipboardEntry = list.find((h) => h.id === clipboardResult.handover.id);
    expect(clipboardEntry).toBeDefined();
    expect(clipboardEntry!.reference).toBe(clipboardResult.handover.reference);
    // No file is ever stored for CLIPBOARD -- no download link either.
    expect(clipboardEntry!.downloadUrl).toBeNull();
  });

  /**
   * Milestone 3 completion (Warehouse Assembly Form & Partial
   * Availability). Reproduces the spec's own section 3 "Example D"
   * worked example verbatim -- five cake products, mixed fully/
   * partially/completely-unavailable outcomes on the same order -- and
   * asserts the exact invoiceable-quantity table the spec's section 6
   * gives for it. This is the one test that exercises mixed availability
   * (requirement 4), the handover's found-quantity-only sourcing
   * (requirement 11), exclusion of fully-unavailable lines (requirement
   * 12), AND -- new here -- an explicit assertion that the original
   * OrderLine.requestedQuantity rows are never touched by picking at all
   * (requirement 13: "preserve the original customer-requested
   * quantities"), all in one place, matching the spec literally rather
   * than via five separate ad hoc tests.
   */
  it("Example D (spec section 3/6): five lines, mixed availability, matches the spec's exact expected invoice table and preserves original requested quantities", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");
    const { buildHandoverRows } = await import("@/lib/handover/build-handover-rows");
    const { classifyAvailability } = await import("@/lib/picking/validation");

    const exampleDOrder = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "RECEIVED",
        orderDate: new Date("2026-11-01T00:00:00.000Z"),
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [
            { lineNumber: 1, originalProductDescription: `10 Inch Blackforest Cake ${uniqueSuffix}`, productId: productAId, requestedQuantity: "10.0000", requestedUnitCode: "EA", isDemo: true },
            { lineNumber: 2, originalProductDescription: `10 Inch Chocolate Cake ${uniqueSuffix}`, productId: productAId, requestedQuantity: "15.0000", requestedUnitCode: "EA", isDemo: true },
            { lineNumber: 3, originalProductDescription: `10 Inch Strawberry Cake ${uniqueSuffix}`, productId: productAId, requestedQuantity: "12.0000", requestedUnitCode: "EA", isDemo: true },
            { lineNumber: 4, originalProductDescription: `10 Inch Vanilla Cake ${uniqueSuffix}`, productId: productAId, requestedQuantity: "8.0000", requestedUnitCode: "EA", isDemo: true },
            { lineNumber: 5, originalProductDescription: `12 Inch Blackforest Cake ${uniqueSuffix}`, productId: productAId, requestedQuantity: "6.0000", requestedUnitCode: "EA", isDemo: true },
          ],
        },
      },
      select: { id: true },
    });
    createdOrderIds.push(exampleDOrder.id);
    const orderId = exampleDOrder.id;

    const originalRequestedQuantities = await prisma.orderLine.findMany({
      where: { orderId },
      orderBy: { lineNumber: "asc" },
      select: { lineNumber: true, requestedQuantity: true },
    });

    // The spec's exact warehouse report for Example D.
    const EXAMPLE_D_PICKS = {
      1: { found: "10.0000", unavailable: "0.0000" }, // fully available
      2: { found: "0.0000", unavailable: "15.0000" }, // unavailable
      3: { found: "5.0000", unavailable: "7.0000" }, // partially available
      4: { found: "8.0000", unavailable: "0.0000" }, // fully available
      5: { found: "0.0000", unavailable: "6.0000" }, // unavailable
    };

    await pickAndAuthorizeFully(orderId, EXAMPLE_D_PICKS);

    // Requirement 13: original OrderLine.requestedQuantity rows must be
    // byte-identical to what was submitted -- picking records its own
    // found/unavailable split on a separate PickingLine row entirely
    // (see that model's schema comment); it never writes back to
    // OrderLine at all.
    const afterPickingRequestedQuantities = await prisma.orderLine.findMany({
      where: { orderId },
      orderBy: { lineNumber: "asc" },
      select: { lineNumber: true, requestedQuantity: true },
    });
    expect(afterPickingRequestedQuantities.map((l) => l.requestedQuantity.toString())).toEqual(
      originalRequestedQuantities.map((l) => l.requestedQuantity.toString())
    );

    // Requirement 5: the three-way classification matches the spec's
    // own "Result" column exactly for every one of the five lines.
    expect(classifyAvailability("10.0000", "0.0000", "10.0000")).toBe("FULLY_AVAILABLE"); // Blackforest 10"
    expect(classifyAvailability("0.0000", "15.0000", "15.0000")).toBe("COMPLETELY_UNAVAILABLE"); // Chocolate
    expect(classifyAvailability("5.0000", "7.0000", "12.0000")).toBe("PARTIALLY_AVAILABLE"); // Strawberry
    expect(classifyAvailability("8.0000", "0.0000", "8.0000")).toBe("FULLY_AVAILABLE"); // Vanilla
    expect(classifyAvailability("0.0000", "6.0000", "6.0000")).toBe("COMPLETELY_UNAVAILABLE"); // Blackforest 12"

    // Requirements 4/11/12: the spec's section 6 expected handover --
    // Blackforest 10" (10), Strawberry (5, partial -- found only, not the
    // requested 12), Vanilla (8); Chocolate and 12" Blackforest excluded
    // entirely because their found quantity is zero.
    const built = await buildHandoverRows(orderId);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);

    expect(built.omittedLineCount).toBe(2);
    expect(built.rows.map((row) => ({ lineNumber: row.lineNumber, quantity: row.quantity }))).toEqual([
      { lineNumber: 1, quantity: "10.0000" },
      { lineNumber: 3, quantity: "5.0000" },
      { lineNumber: 4, quantity: "8.0000" },
    ]);
    expect(built.rows.some((row) => row.lineNumber === 2)).toBe(false);
    expect(built.rows.some((row) => row.lineNumber === 5)).toBe(false);
  });
});
