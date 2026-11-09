import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 2B. The acceptance-level test for this milestone: chains
 * 2A's extraction output shape through matching, alias-learning,
 * duplicate detection, and the review/confirm action into real
 * CustomerOrder/OrderLine rows -- against a REAL database through a
 * REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same one reason as
 * tests/orders-db.integration.test.ts: @prisma/client in this sandbox
 * is a stub that THROWS when merely constructed (see
 * docs/milestones/PROGRESS.md's "Sandbox-only blocker"). Every lib
 * touched here imports lib/prisma.ts transitively
 * (lib/matching/aliases.ts, lib/matching/product-matcher.ts,
 * lib/matching/customer-matcher.ts, lib/review/duplicate-check.ts,
 * lib/review/build-review-session.ts, lib/review/confirm-review.ts,
 * lib/orders.ts), so every import of any of them is a dynamic
 * `await import(...)` INSIDE the (skippable) test bodies below, never
 * a static top-of-file import -- a static import would construct the
 * stub and crash `npm test` here even when this suite is skipped,
 * since Vitest still evaluates a test file's top-level imports before
 * deciding what to skip. lib/matching/normalize.ts has NO such
 * dependency and is fully covered, unconditionally, by
 * tests/matching-normalize.test.ts instead.
 *
 * On your machine, where `prisma generate` has actually run against a
 * real schema, set RUN_DB_INTEGRATION_TESTS=1 to include it
 * (DATABASE_URL is already required for every other command you run):
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` at least once first, so an admin
 * user, at least one DEMO-CUST-* customer, and at least two real,
 * active, imported SAP products already exist -- this test looks them
 * up rather than creating its own catalogue/customer data (the same
 * convention prisma/seed.ts itself follows for demo orders), and skips
 * itself with a console message (not a failure) if any are missing.
 *
 * Every row this test creates is marked isDemo: true (or, for rows
 * with no isDemo column, is deleted in this test's own afterAll) --
 * nothing here ever touches real, non-demo data.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 2B: matching, aliases, duplicate detection, review/confirm", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  let customerName: string;
  let productAId: string;
  let productAItemName: string;
  let productBId: string;

  // Tracks every row this test creates, oldest-first, for a
  // children-first cleanup in afterAll regardless of pass/fail --
  // same FK-ordering rule as scripts/remove-demo-data.ts.
  const createdOrderIds: string[] = [];
  const createdDocumentIds: string[] = [];
  const createdExtractionRunIds: string[] = [];
  const createdProductAliasRawTexts: string[] = [];
  const createdCustomerAliasRawTexts: string[] = [];
  // Milestone 2C: multi-store splitting -- a second, ad-hoc customer this
  // test creates itself (CustomerOrder.customerId is onDelete: Restrict,
  // so every order referencing it must be deleted first in afterAll,
  // before this customer).
  const createdCustomerIds: string[] = [];

  const uniqueSuffix = `inttest-${Date.now()}`;
  const unmatchedDescription = `Totally unmatched mystery item ${uniqueSuffix}`;

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({
      where: { sapCustomerCode: { startsWith: "DEMO-CUST" } },
      select: { id: true, name: true },
    });
    const products = await prisma.product.findMany({
      where: { isDemo: false, status: "ACTIVE" },
      orderBy: [{ sapItemCode: "asc" }],
      take: 2,
      select: { id: true, itemName: true },
    });

    if (!admin || !customer || products.length < 2) {
      console.log(
        "Skipping Milestone 2B DB integration test: need an admin user, a DEMO-CUST-* customer, and at least " +
          "two active products. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;
    customerName = customer.name;
    productAId = products[0]!.id;
    productAItemName = products[0]!.itemName;
    productBId = products[1]!.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      for (const orderId of createdOrderIds) {
        await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
        await prisma.orderLine.deleteMany({ where: { orderId } });
      }
      for (const runId of createdExtractionRunIds) {
        await prisma.extractedOrderLine.deleteMany({ where: { extractionRunId: runId } });
      }
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: createdDocumentIds } } });
      for (const documentId of createdDocumentIds) {
        // Clear the orderId FK before deleting the order it points to.
        await prisma.orderDocument.update({ where: { id: documentId }, data: { orderId: null } }).catch(() => undefined);
      }
      for (const orderId of createdOrderIds) {
        await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => undefined);
      }
      for (const runId of createdExtractionRunIds) {
        await prisma.extractionRun.delete({ where: { id: runId } }).catch(() => undefined);
      }
      for (const documentId of createdDocumentIds) {
        await prisma.orderDocument.delete({ where: { id: documentId } }).catch(() => undefined);
      }
      if (createdProductAliasRawTexts.length > 0) {
        const { normalizeMatchText } = await import("@/lib/matching/normalize");
        await prisma.productAlias.deleteMany({
          where: { normalizedText: { in: createdProductAliasRawTexts.map(normalizeMatchText) } },
        });
      }
      if (createdCustomerAliasRawTexts.length > 0) {
        const { normalizeMatchText } = await import("@/lib/matching/normalize");
        await prisma.customerAlias.deleteMany({
          where: { normalizedText: { in: createdCustomerAliasRawTexts.map(normalizeMatchText) } },
        });
      }
      for (const id of createdCustomerIds) {
        await prisma.customer.delete({ where: { id } }).catch(() => undefined);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  it("records and looks up a ProductAlias, with find-or-create-or-repoint behavior", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { recordProductAlias, lookupProductAlias } = await import("@/lib/matching/aliases");

    const rawText = `Product alias test ${uniqueSuffix}`;
    createdProductAliasRawTexts.push(rawText);

    await prisma.$transaction((tx) =>
      recordProductAlias(tx, { rawText, productId: productAId, customerId: null, createdById: adminId, isDemo: true })
    );

    const firstLookup = await lookupProductAlias(rawText, null);
    expect(firstLookup?.productId).toBe(productAId);

    // Re-pointing: a human now confirms this same text means a
    // DIFFERENT product -- timesConfirmed must reset to 1, not
    // increment, since the previous confirmation no longer applies.
    await prisma.$transaction((tx) =>
      recordProductAlias(tx, { rawText, productId: productBId, customerId: null, createdById: adminId, isDemo: true })
    );

    const afterRepoint = await lookupProductAlias(rawText, null);
    expect(afterRepoint?.productId).toBe(productBId);

    const stored = await prisma.productAlias.findFirst({ where: { rawText } });
    expect(stored?.timesConfirmed).toBe(1);
  });

  it("records and looks up a CustomerAlias", async () => {
    if (skipAll) return;
    const { recordCustomerAlias, lookupCustomerAlias } = await import("@/lib/matching/aliases");
    const { prisma } = await import("@/lib/prisma");

    const rawText = `Customer alias test ${uniqueSuffix}`;
    createdCustomerAliasRawTexts.push(rawText);

    await prisma.$transaction((tx) => recordCustomerAlias(tx, { rawText, customerId, createdById: adminId, isDemo: true }));

    const lookup = await lookupCustomerAlias(rawText);
    expect(lookup?.customerId).toBe(customerId);
  });

  it("matchProductDescription never confidently matches the wrong product, and alias lookup takes priority over fuzzy scoring", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { matchProductDescription } = await import("@/lib/matching/product-matcher");
    const { recordProductAlias } = await import("@/lib/matching/aliases");

    // Fuzzy: scoring the product's own name against itself must always
    // produce the top candidate pointing at that same product, however
    // ambiguous the real catalogue turns out to be.
    const fuzzyResult = await matchProductDescription(productAItemName, null);
    expect(fuzzyResult.candidates[0]?.productId).toBe(productAId);
    expect(fuzzyResult.candidates[0]?.score).toBe(1);
    if (fuzzyResult.matchedProductId) {
      expect(fuzzyResult.matchedProductId).toBe(productAId);
    }

    // Alias: an exact confirmed alias must be used verbatim, confidence
    // 1.0, even though it points at a DIFFERENT product than fuzzy
    // scoring alone would ever pick for this text.
    const aliasRawText = `Alias priority test ${uniqueSuffix}`;
    createdProductAliasRawTexts.push(aliasRawText);
    await prisma.$transaction((tx) =>
      recordProductAlias(tx, { rawText: aliasRawText, productId: productBId, customerId: null, createdById: adminId, isDemo: true })
    );

    const aliasResult = await matchProductDescription(aliasRawText, null);
    expect(aliasResult.matchedProductId).toBe(productBId);
    expect(aliasResult.matchConfidence).toBe(1);
    expect(aliasResult.matchSource).toBe("ALIAS");
  });

  it("checkForDuplicates flags a repeated customer PO reference and a repeated document checksum", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { checkForDuplicates } = await import("@/lib/review/duplicate-check");
    const { generateOrderReference } = await import("@/lib/orders");

    const checksum = `checksum-${uniqueSuffix}`;
    const poReference = `PO-${uniqueSuffix}`;

    const existingOrder = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        customerPoReference: poReference,
        source: "MANUAL",
        status: "RECEIVED",
        orderDate: new Date("2026-11-01T00:00:00.000Z"),
        requestedDeliveryDate: new Date("2026-11-03T00:00:00.000Z"),
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
      },
      select: { id: true },
    });
    createdOrderIds.push(existingOrder.id);

    const existingDocument = await prisma.orderDocument.create({
      data: {
        orderId: existingOrder.id,
        uploadedById: adminId,
        originalFileName: "existing.txt",
        storageKey: `storage-${uniqueSuffix}-existing`,
        mimeType: "text/plain",
        fileSize: BigInt(10),
        checksum,
        sourceChannel: "WHATSAPP",
        status: "CONFIRMED",
      },
      select: { id: true },
    });
    createdDocumentIds.push(existingDocument.id);

    const newDocument = await prisma.orderDocument.create({
      data: {
        uploadedById: adminId,
        originalFileName: "new.txt",
        storageKey: `storage-${uniqueSuffix}-new`,
        mimeType: "text/plain",
        fileSize: BigInt(10),
        checksum,
        sourceChannel: "WHATSAPP",
        status: "RECEIVED",
      },
      select: { id: true },
    });
    createdDocumentIds.push(newDocument.id);

    const warnings = await checkForDuplicates({
      documentId: newDocument.id,
      documentChecksum: checksum,
      customerId,
      customerPoReference: poReference,
    });

    expect(warnings).toHaveLength(2);
    expect(warnings.map((w) => w.kind).sort()).toEqual(["SAME_CUSTOMER_PO_REFERENCE", "SAME_DOCUMENT_CHECKSUM"]);
    for (const warning of warnings) {
      expect(warning.existingOrderId).toBe(existingOrder.id);
    }
  });

  it("builds a review session, is idempotent on a second open, and confirms it into a real order with alias learning", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { getOrBuildReviewSession } = await import("@/lib/review/build-review-session");
    const { confirmReviewSession } = await import("@/lib/review/confirm-review");
    const { lookupProductAlias, lookupCustomerAlias } = await import("@/lib/matching/aliases");
    const { PO_EXTRACTION_SCHEMA_VERSION } = await import("@/lib/extraction/schema");

    const document = await prisma.orderDocument.create({
      data: {
        uploadedById: adminId,
        originalFileName: "review-flow.txt",
        storageKey: `storage-${uniqueSuffix}-review`,
        mimeType: "text/plain",
        fileSize: BigInt(20),
        checksum: `checksum-${uniqueSuffix}-review`,
        sourceChannel: "WHATSAPP",
        status: "EXTRACTED",
      },
      select: { id: true },
    });
    createdDocumentIds.push(document.id);

    const customerPoNumber = `REVIEW-PO-${uniqueSuffix}`;

    const extractionRun = await prisma.extractionRun.create({
      data: {
        documentId: document.id,
        provider: "MOCK",
        promptVersion: PO_EXTRACTION_SCHEMA_VERSION,
        status: "SUCCEEDED",
        completedAt: new Date(),
        extractedHeader: {
          customerNameRaw: customerName,
          storeOrBranchRaw: null,
          customerPoNumber,
          poDate: "2026-11-09",
          requestedDeliveryDate: "2026-11-12",
          deliveryAddressRaw: null,
          currencyRaw: "USD",
          senderInfoRaw: null,
        },
        extractedLines: [
          {
            lineNumber: 1,
            originalDescription: productAItemName,
            extractedQuantity: "3",
            extractedUnit: "EA",
            customerProvidedUnitPrice: null,
            sourcePageOrImageRef: null,
            confidence: 0.9,
            warnings: [],
          },
          {
            lineNumber: 2,
            originalDescription: unmatchedDescription,
            extractedQuantity: null,
            extractedUnit: null,
            customerProvidedUnitPrice: null,
            sourcePageOrImageRef: null,
            confidence: 0.2,
            warnings: ["Could not determine quantity or unit."],
          },
        ],
      },
      select: { id: true },
    });
    createdExtractionRunIds.push(extractionRun.id);

    const firstBuild = await getOrBuildReviewSession(document.id);
    expect(firstBuild.ok).toBe(true);
    if (!firstBuild.ok) throw new Error(firstBuild.message);
    expect(firstBuild.session.lines).toHaveLength(2);
    expect(firstBuild.session.alreadyConfirmed).toBe(false);

    const [line1, line2] = firstBuild.session.lines;
    expect(line1).toBeDefined();
    expect(line2).toBeDefined();
    // Line 2's description matches nothing in the catalogue -- must
    // never be confidently matched to an arbitrary product.
    expect(line2!.matchedProductId).toBeNull();

    // Idempotency: opening the same review session again must return
    // the SAME materialized rows, never recreate them.
    const secondBuild = await getOrBuildReviewSession(document.id);
    expect(secondBuild.ok).toBe(true);
    if (!secondBuild.ok) throw new Error(secondBuild.message);
    expect(secondBuild.session.lines.map((l) => l.id).sort()).toEqual(firstBuild.session.lines.map((l) => l.id).sort());

    const confirmResult = await confirmReviewSession(
      document.id,
      adminId,
      {
        customerId,
        customerLocationId: null,
        customerAliasText: null,
        header: undefined,
        lines: [
          { extractedOrderLineId: line1!.id, decision: "ACCEPTED" },
          {
            extractedOrderLineId: line2!.id,
            decision: "ACCEPTED",
            productId: productBId,
            requestedQuantity: "5",
            requestedUnitCode: "EA",
          },
        ],
        acknowledgeDuplicate: false,
      },
      { isDemo: true }
    );

    expect(confirmResult.ok).toBe(true);
    if (!confirmResult.ok) throw new Error(`confirmReviewSession failed: ${confirmResult.message}`);
    createdOrderIds.push(confirmResult.orderId);
    expect(confirmResult.acceptedLineCount).toBe(2);
    expect(confirmResult.excludedLineCount).toBe(0);

    const updatedDocument = await prisma.orderDocument.findUniqueOrThrow({
      where: { id: document.id },
      select: { orderId: true, status: true },
    });
    expect(updatedDocument.orderId).toBe(confirmResult.orderId);
    expect(updatedDocument.status).toBe("CONFIRMED");

    const order = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: confirmResult.orderId },
      select: { customerId: true, customerPoReference: true, source: true, lines: { orderBy: { lineNumber: "asc" } } },
    });
    expect(order.customerId).toBe(customerId);
    expect(order.customerPoReference).toBe(customerPoNumber);
    expect(order.source).toBe("WHATSAPP");
    expect(order.lines).toHaveLength(2);
    expect(order.lines[0]?.productId).toBe(productAId);
    expect(order.lines[0]?.requestedQuantity.toString()).toBe("3.0000");
    expect(order.lines[1]?.productId).toBe(productBId);
    expect(order.lines[1]?.requestedQuantity.toString()).toBe("5.0000");

    const updatedExtractedLines = await prisma.extractedOrderLine.findMany({
      where: { extractionRunId: extractionRun.id },
      orderBy: { lineNumber: "asc" },
    });
    expect(updatedExtractedLines.every((l) => l.status === "ACCEPTED")).toBe(true);
    expect(updatedExtractedLines.every((l) => l.resultingOrderLineId !== null)).toBe(true);
    expect(updatedExtractedLines.every((l) => l.reviewedById === adminId)).toBe(true);

    // Alias learning: both lines' final product choices must now be
    // looked-up-able by their original free text (line 1 strengthens an
    // alias that may already exist from matching, line 2 LEARNS a new
    // one from the human's manual override), and the resolved customer
    // must now be alias-looked-up-able by the header's own raw name.
    createdProductAliasRawTexts.push(productAItemName, unmatchedDescription);
    createdCustomerAliasRawTexts.push(customerName);

    const productAAlias = await lookupProductAlias(productAItemName, customerId);
    expect(productAAlias?.productId).toBe(productAId);

    const productBAlias = await lookupProductAlias(unmatchedDescription, customerId);
    expect(productBAlias?.productId).toBe(productBId);

    const customerAlias = await lookupCustomerAlias(customerName);
    expect(customerAlias?.customerId).toBe(customerId);

    const auditEvent = await prisma.auditEvent.findFirst({
      where: { entityType: "OrderDocument", entityId: document.id, action: "PO_REVIEW_CONFIRMED" },
    });
    expect(auditEvent).not.toBeNull();

    // Already-confirmed guard: confirming the same document again must
    // be rejected, not silently create a second order.
    const secondConfirmAttempt = await confirmReviewSession(
      document.id,
      adminId,
      {
        customerId,
        customerLocationId: null,
        customerAliasText: null,
        header: undefined,
        lines: [{ extractedOrderLineId: line1!.id, decision: "ACCEPTED" }],
        acknowledgeDuplicate: true,
      },
      { isDemo: true }
    );
    expect(secondConfirmAttempt.ok).toBe(false);
    if (!secondConfirmAttempt.ok) expect(secondConfirmAttempt.status).toBe(409);
  });

  it("requires acknowledgeDuplicate before confirming a document whose customer PO reference repeats an existing order", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { getOrBuildReviewSession } = await import("@/lib/review/build-review-session");
    const { confirmReviewSession } = await import("@/lib/review/confirm-review");
    const { generateOrderReference } = await import("@/lib/orders");
    const { PO_EXTRACTION_SCHEMA_VERSION } = await import("@/lib/extraction/schema");

    const duplicatePoReference = `DUPTEST-PO-${uniqueSuffix}`;

    const existingOrder = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        customerPoReference: duplicatePoReference,
        source: "MANUAL",
        status: "RECEIVED",
        orderDate: new Date("2026-11-01T00:00:00.000Z"),
        requestedDeliveryDate: new Date("2026-11-03T00:00:00.000Z"),
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
      },
      select: { id: true },
    });
    createdOrderIds.push(existingOrder.id);

    const document = await prisma.orderDocument.create({
      data: {
        uploadedById: adminId,
        originalFileName: "duplicate-flow.txt",
        storageKey: `storage-${uniqueSuffix}-dup`,
        mimeType: "text/plain",
        fileSize: BigInt(20),
        checksum: `checksum-${uniqueSuffix}-dup`,
        sourceChannel: "WHATSAPP",
        status: "EXTRACTED",
      },
      select: { id: true },
    });
    createdDocumentIds.push(document.id);

    const extractionRun = await prisma.extractionRun.create({
      data: {
        documentId: document.id,
        provider: "MOCK",
        promptVersion: PO_EXTRACTION_SCHEMA_VERSION,
        status: "SUCCEEDED",
        completedAt: new Date(),
        extractedHeader: {
          customerNameRaw: customerName,
          storeOrBranchRaw: null,
          customerPoNumber: duplicatePoReference,
          poDate: "2026-11-09",
          requestedDeliveryDate: "2026-11-12",
          deliveryAddressRaw: null,
          currencyRaw: "USD",
          senderInfoRaw: null,
        },
        extractedLines: [
          {
            lineNumber: 1,
            originalDescription: productAItemName,
            extractedQuantity: "1",
            extractedUnit: "EA",
            customerProvidedUnitPrice: null,
            sourcePageOrImageRef: null,
            confidence: 0.9,
            warnings: [],
          },
        ],
      },
      select: { id: true },
    });
    createdExtractionRunIds.push(extractionRun.id);

    const built = await getOrBuildReviewSession(document.id);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);
    expect(built.session.duplicateWarnings.some((w) => w.kind === "SAME_CUSTOMER_PO_REFERENCE")).toBe(true);

    const line = built.session.lines[0]!;

    const withoutAcknowledgement = await confirmReviewSession(
      document.id,
      adminId,
      {
        customerId,
        customerLocationId: null,
        customerAliasText: null,
        header: undefined,
        lines: [{ extractedOrderLineId: line.id, decision: "ACCEPTED" }],
        acknowledgeDuplicate: false,
      },
      { isDemo: true }
    );
    expect(withoutAcknowledgement.ok).toBe(false);
    if (!withoutAcknowledgement.ok) {
      expect(withoutAcknowledgement.status).toBe(409);
      expect(withoutAcknowledgement.duplicateWarnings?.length).toBeGreaterThan(0);
    }

    const withAcknowledgement = await confirmReviewSession(
      document.id,
      adminId,
      {
        customerId,
        customerLocationId: null,
        customerAliasText: null,
        header: undefined,
        lines: [{ extractedOrderLineId: line.id, decision: "ACCEPTED" }],
        acknowledgeDuplicate: true,
      },
      { isDemo: true }
    );
    expect(withAcknowledgement.ok).toBe(true);
    if (withAcknowledgement.ok) createdOrderIds.push(withAcknowledgement.orderId);
  });

  it("rejects a confirm request that excludes every line (at least one acceptance is required)", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { getOrBuildReviewSession } = await import("@/lib/review/build-review-session");
    const { confirmReviewSession } = await import("@/lib/review/confirm-review");
    const { PO_EXTRACTION_SCHEMA_VERSION } = await import("@/lib/extraction/schema");

    const document = await prisma.orderDocument.create({
      data: {
        uploadedById: adminId,
        originalFileName: "all-excluded.txt",
        storageKey: `storage-${uniqueSuffix}-excluded`,
        mimeType: "text/plain",
        fileSize: BigInt(20),
        checksum: `checksum-${uniqueSuffix}-excluded`,
        sourceChannel: "WHATSAPP",
        status: "EXTRACTED",
      },
      select: { id: true },
    });
    createdDocumentIds.push(document.id);

    const extractionRun = await prisma.extractionRun.create({
      data: {
        documentId: document.id,
        provider: "MOCK",
        promptVersion: PO_EXTRACTION_SCHEMA_VERSION,
        status: "SUCCEEDED",
        completedAt: new Date(),
        extractedHeader: {
          customerNameRaw: customerName,
          storeOrBranchRaw: null,
          customerPoNumber: null,
          poDate: null,
          requestedDeliveryDate: null,
          deliveryAddressRaw: null,
          currencyRaw: null,
          senderInfoRaw: null,
        },
        extractedLines: [
          {
            lineNumber: 1,
            originalDescription: "A line nobody wants to keep",
            extractedQuantity: null,
            extractedUnit: null,
            customerProvidedUnitPrice: null,
            sourcePageOrImageRef: null,
            confidence: null,
            warnings: [],
          },
        ],
      },
      select: { id: true },
    });
    createdExtractionRunIds.push(extractionRun.id);

    const built = await getOrBuildReviewSession(document.id);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);
    const line = built.session.lines[0]!;

    const result = await confirmReviewSession(
      document.id,
      adminId,
      {
        customerId,
        customerLocationId: null,
        customerAliasText: null,
        header: undefined,
        lines: [{ extractedOrderLineId: line.id, decision: "EXCLUDED" }],
        acknowledgeDuplicate: false,
      },
      { isDemo: true }
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
  });

  it("Milestone 2C: splits one document into several orders when a line is tagged with a different store", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { getOrBuildReviewSession } = await import("@/lib/review/build-review-session");
    const { confirmReviewSession } = await import("@/lib/review/confirm-review");
    const { lookupProductAlias } = await import("@/lib/matching/aliases");
    const { PO_EXTRACTION_SCHEMA_VERSION } = await import("@/lib/extraction/schema");

    const splitCustomer = await prisma.customer.create({
      data: { name: `Split-store test ${uniqueSuffix}`, isDemo: true },
      select: { id: true },
    });
    createdCustomerIds.push(splitCustomer.id);

    const line1Description = `Split line 1 ${uniqueSuffix}`;
    const line2Description = `Split line 2 ${uniqueSuffix}`;

    const document = await prisma.orderDocument.create({
      data: {
        uploadedById: adminId,
        originalFileName: "multi-store-split.txt",
        storageKey: `storage-${uniqueSuffix}-split`,
        mimeType: "text/plain",
        fileSize: BigInt(20),
        checksum: `checksum-${uniqueSuffix}-split`,
        sourceChannel: "WHATSAPP",
        status: "EXTRACTED",
      },
      select: { id: true },
    });
    createdDocumentIds.push(document.id);

    const extractionRun = await prisma.extractionRun.create({
      data: {
        documentId: document.id,
        provider: "MOCK",
        promptVersion: PO_EXTRACTION_SCHEMA_VERSION,
        status: "SUCCEEDED",
        completedAt: new Date(),
        extractedHeader: {
          customerNameRaw: customerName,
          storeOrBranchRaw: null,
          customerPoNumber: null,
          poDate: "2026-11-09",
          requestedDeliveryDate: "2026-11-12",
          deliveryAddressRaw: null,
          currencyRaw: "USD",
          senderInfoRaw: null,
        },
        // A single pasted message naming two different stores at once --
        // exactly the real-world shape this feature exists for.
        extractedLines: [
          {
            lineNumber: 1,
            originalDescription: line1Description,
            extractedQuantity: "2",
            extractedUnit: "EA",
            customerProvidedUnitPrice: null,
            sourcePageOrImageRef: null,
            confidence: 0.9,
            warnings: [],
          },
          {
            lineNumber: 2,
            originalDescription: line2Description,
            extractedQuantity: "4",
            extractedUnit: "EA",
            customerProvidedUnitPrice: null,
            sourcePageOrImageRef: null,
            confidence: 0.9,
            warnings: [],
          },
        ],
      },
      select: { id: true },
    });
    createdExtractionRunIds.push(extractionRun.id);

    const built = await getOrBuildReviewSession(document.id);
    expect(built.ok).toBe(true);
    if (!built.ok) throw new Error(built.message);
    const [line1, line2] = built.session.lines;
    expect(line1).toBeDefined();
    expect(line2).toBeDefined();

    const confirmResult = await confirmReviewSession(
      document.id,
      adminId,
      {
        customerId, // the document-level default -- line 1 uses it implicitly
        customerLocationId: null,
        customerAliasText: null,
        header: undefined,
        lines: [
          { extractedOrderLineId: line1!.id, decision: "ACCEPTED", productId: productAId, requestedQuantity: "2", requestedUnitCode: "EA" },
          {
            // Milestone 2C: this one line is reassigned to a DIFFERENT
            // store than the rest of the document.
            extractedOrderLineId: line2!.id,
            decision: "ACCEPTED",
            productId: productBId,
            requestedQuantity: "4",
            requestedUnitCode: "EA",
            customerId: splitCustomer.id,
          },
        ],
        acknowledgeDuplicate: false,
      },
      { isDemo: true }
    );

    expect(confirmResult.ok).toBe(true);
    if (!confirmResult.ok) throw new Error(`confirmReviewSession failed: ${confirmResult.message}`);
    createdProductAliasRawTexts.push(line1Description, line2Description);

    // Two distinct orders, one per store, created atomically.
    expect(confirmResult.orders).toHaveLength(2);
    for (const order of confirmResult.orders) createdOrderIds.push(order.orderId);

    // Backward compatibility: the top-level orderId/orderReference stay
    // the PRIMARY (document-level default customer's) order.
    const primaryEntry = confirmResult.orders.find((o) => o.customerId === customerId);
    const splitEntry = confirmResult.orders.find((o) => o.customerId === splitCustomer.id);
    expect(primaryEntry).toBeDefined();
    expect(splitEntry).toBeDefined();
    expect(confirmResult.orderId).toBe(primaryEntry!.orderId);
    expect(confirmResult.orderReference).toBe(primaryEntry!.orderReference);
    expect(primaryEntry!.orderId).not.toBe(splitEntry!.orderId);

    // OrderDocument.orderId keeps pointing ONLY at the primary order.
    const updatedDocument = await prisma.orderDocument.findUniqueOrThrow({
      where: { id: document.id },
      select: { orderId: true, status: true },
    });
    expect(updatedDocument.orderId).toBe(primaryEntry!.orderId);
    expect(updatedDocument.status).toBe("CONFIRMED");

    const primaryOrder = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: primaryEntry!.orderId },
      select: { customerId: true, lines: { orderBy: { lineNumber: "asc" } } },
    });
    expect(primaryOrder.customerId).toBe(customerId);
    expect(primaryOrder.lines).toHaveLength(1);
    expect(primaryOrder.lines[0]?.productId).toBe(productAId);

    const splitOrder = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: splitEntry!.orderId },
      select: { customerId: true, lines: { orderBy: { lineNumber: "asc" } } },
    });
    expect(splitOrder.customerId).toBe(splitCustomer.id);
    expect(splitOrder.lines).toHaveLength(1);
    expect(splitOrder.lines[0]?.productId).toBe(productBId);

    // Both ExtractedOrderLine rows must be linked to their OWN resulting
    // order line, not both pointing at the same order.
    const updatedExtractedLines = await prisma.extractedOrderLine.findMany({
      where: { extractionRunId: extractionRun.id },
      orderBy: { lineNumber: "asc" },
    });
    expect(updatedExtractedLines.every((l) => l.status === "ACCEPTED")).toBe(true);
    const resultingOrderLine1 = await prisma.orderLine.findUniqueOrThrow({
      where: { id: updatedExtractedLines[0]!.resultingOrderLineId! },
      select: { orderId: true },
    });
    const resultingOrderLine2 = await prisma.orderLine.findUniqueOrThrow({
      where: { id: updatedExtractedLines[1]!.resultingOrderLineId! },
      select: { orderId: true },
    });
    expect(resultingOrderLine1.orderId).toBe(primaryEntry!.orderId);
    expect(resultingOrderLine2.orderId).toBe(splitEntry!.orderId);

    // Product alias for the reassigned line is learned against the LINE's
    // own effective customer (the split store), never the document's
    // default customer.
    const splitLineAlias = await lookupProductAlias(line2Description, splitCustomer.id);
    expect(splitLineAlias?.productId).toBe(productBId);
    const splitLineAliasUnderDefaultCustomer = await lookupProductAlias(line2Description, customerId);
    expect(splitLineAliasUnderDefaultCustomer).toBeNull();
  });
});
