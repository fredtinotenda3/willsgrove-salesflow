import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 2C. DB-backed acceptance tests for the handover feature --
 * buildHandoverRows' three-way product-match fallback, generateHandover's
 * append-only OrderHandover rows and once-only handedToSapAt marker, and
 * that every format (Excel/CSV/clipboard) really is built from that same
 * row set -- against a REAL database through a REAL generated
 * @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same one reason as
 * tests/matching-review-db.integration.test.ts and
 * tests/orders-db.integration.test.ts: @prisma/client in this sandbox is
 * a stub that THROWS when merely constructed (see
 * docs/milestones/PROGRESS.md's "Sandbox-only blocker"). Every lib
 * touched here (lib/handover/*, lib/storage, lib/prisma) is imported with
 * a dynamic `await import(...)` INSIDE the (skippable) test bodies below,
 * never a static top-of-file import, for the same reason given there.
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

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 2C: handover generation", () => {
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
        "Skipping Milestone 2C handover DB integration test: need an admin user, a DEMO-CUST-* customer, " +
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

  /** A fresh order with three lines exercising buildHandoverRows' full three-way fallback: a live product match, a snapshot-only match (the product has since been removed from the catalogue), and no match at all. */
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
              requestedQuantity: "2.0000",
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

  it("buildHandoverRows applies the three-way fallback and never drops a line", async () => {
    if (skipAll) return;
    const { buildHandoverRows } = await import("@/lib/handover/build-handover-rows");

    const orderId = await createThreeLineOrder();
    const built = await buildHandoverRows(orderId);

    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);
    expect(built.rows).toHaveLength(3);

    const [liveMatch, snapshotOnly, noMatch] = built.rows;
    expect(liveMatch!.matched).toBe(true);
    expect(liveMatch!.sapItemCode).toBe(productASapCode);
    expect(liveMatch!.officialDescription).toBe(productAItemName);

    expect(snapshotOnly!.matched).toBe(true);
    expect(snapshotOnly!.sapItemCode).toBe(`SNAP-${uniqueSuffix}`);
    expect(snapshotOnly!.officialDescription).toBeNull();
    expect(snapshotOnly!.note).not.toBeNull();

    expect(noMatch!.matched).toBe(false);
    expect(noMatch!.sapItemCode).toBeNull();
    expect(noMatch!.officialDescription).toBeNull();
    expect(noMatch!.note).not.toBeNull();
  });

  it("generateHandover(EXCEL) creates a readable .xlsx, an append-only OrderHandover row, and sets handedToSapAt once", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { generateHandover } = await import("@/lib/handover/generate-handover");
    const { getStorageDriver } = await import("@/lib/storage");
    const ExcelJS = (await import("exceljs")).default;

    const orderId = await createThreeLineOrder();

    const firstResult = await generateHandover(orderId, adminId, "EXCEL", { isDemo: true });
    expect(firstResult.ok).toBe(true);
    if (!firstResult.ok) throw new Error(firstResult.message);
    expect(firstResult.handover.lineCount).toBe(3);
    expect(firstResult.handover.matchedLineCount).toBe(2);
    expect(firstResult.handover.unmatchedLineCount).toBe(1);
    expect(firstResult.handover.downloadUrl).toBeTruthy();

    const storedRow = await prisma.orderHandover.findUniqueOrThrow({
      where: { id: firstResult.handover.id },
      select: { format: true, storageKey: true, mimeType: true, fileSize: true },
    });
    expect(storedRow.format).toBe("EXCEL");
    expect(storedRow.storageKey).toBeTruthy();
    expect(storedRow.mimeType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(Number(storedRow.fileSize)).toBeGreaterThan(0);
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
    // 6 header/metadata rows (see buildExcelBuffer) + 1 column-header row + 3 data rows.
    expect(sheet!.rowCount).toBe(10);

    const orderAfterFirst = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId }, select: { handedToSapAt: true } });
    expect(orderAfterFirst.handedToSapAt).not.toBeNull();
    const handedToSapAtAfterFirst = orderAfterFirst.handedToSapAt!.getTime();

    // Regenerating (a different format) must NOT create a second
    // handedToSapAt bump -- the FIRST handover is what's recorded.
    const secondResult = await generateHandover(orderId, adminId, "CSV", { isDemo: true });
    expect(secondResult.ok).toBe(true);
    if (!secondResult.ok) throw new Error(secondResult.message);
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

  it("refuses to generate a handover for a cancelled or rejected order", async () => {
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
});
