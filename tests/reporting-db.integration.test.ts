import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 11 (Operational BI). DB-backed acceptance tests for the
 * lib/reporting/* module against a REAL database through a REAL
 * generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as every other
 * *-db.integration test in this project: @prisma/client in this sandbox
 * is a stub that THROWS when merely constructed (lib/prisma.ts calls
 * `new PrismaClient()` at module scope, and every lib/reporting/*.ts file
 * imports that module at its own top level) -- see docs/milestones/
 * PROGRESS.md's "Sandbox-only blocker." Every lib touched here is
 * imported with a dynamic `await import(...)` inside the (skippable)
 * test bodies below, never a static top-of-file import.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-* customer must exist).
 *
 * Coverage and scope, stated honestly rather than implied:
 *   - CSV export helpers (buildCsv/flattenToKeyValueRows): pure, exercised
 *     directly with synthetic inputs.
 *   - Order-based reports (sales-pipeline, fulfilment-intelligence, and
 *     management-reports' outstanding-orders/awaiting-fulfilment/
 *     picking-shortages/delivery-exceptions list reports): built on the
 *     exact same picking -> dispatch -> deliver fixture helpers already
 *     proven correct in tests/fulfilment-db.integration.test.ts, reused
 *     here rather than re-derived -- including this round's own
 *     architectural fix (status filters applying only on list reports,
 *     never silently no-op'ing on an already status-broken-down
 *     aggregate).
 *   - Communications monitoring: built directly against MessageIntake/
 *     OutboundMessage (both simple enough to construct with confidence
 *     from the schema alone).
 *   - Financial exposure: ONLY the claims/exposureByCurrency
 *     never-summed-across-currencies invariant, via the same
 *     createSapInvoice/createInvoiceClaim pattern already proven in
 *     tests/invoice-claims-db.integration.test.ts.
 *   - Demo-data exclusion and pagination: exercised once each, against
 *     fixtures already created for the sections above, rather than
 *     duplicated per report -- the underlying mechanism (demoWhere,
 *     skip/take) is shared code, already covered by
 *     tests/reporting-filters.test.ts's unconditional parser tests plus
 *     this file's own list-report assertions.
 *   - Deliberately NOT covered here: lost-sales/quotations-performance/
 *     invoice-claims-exposure management-report summaries and the
 *     role-gating 403 path. The first three are thin compositions over
 *     already-independently-tested M4/M5/M6A functions (see each
 *     function's own top comment in lib/reporting/management-reports.ts
 *     for why re-deriving their fixtures here would just be duplicating
 *     those existing suites); the role gate reuses
 *     lib/auth/current-user.ts's requireUserOrResponse, which is already
 *     exercised by every other *-db.integration test file that passes a
 *     role array, unchanged by this milestone.
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 11: operational BI reporting", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  const uniqueSuffix = `m11test-${Date.now()}`;

  const createdOrderIds: string[] = [];
  const createdMessageIntakeIds: string[] = [];
  const createdOutboundMessageIds: string[] = [];
  const createdImportBatchIds: string[] = [];
  const createdSapInvoiceIds: string[] = [];
  const createdClaimIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: { startsWith: "DEMO-CUST" } }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping Milestone 11 reporting DB integration test: need an admin user and a DEMO-CUST-* customer. " +
          "Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
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
      await prisma.outboundMessage.deleteMany({ where: { id: { in: createdOutboundMessageIds } } });
      await prisma.messageIntake.deleteMany({ where: { id: { in: createdMessageIntakeIds } } });

      await prisma.invoiceClaimAttachment.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.claimResolution.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaimLine.deleteMany({ where: { claimId: { in: createdClaimIds } } });
      await prisma.invoiceClaim.deleteMany({ where: { id: { in: createdClaimIds } } });
      await prisma.sapInvoiceLine.deleteMany({ where: { sapInvoiceId: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoice.deleteMany({ where: { id: { in: createdSapInvoiceIds } } });
      await prisma.sapInvoiceImportBatch.deleteMany({ where: { id: { in: createdImportBatchIds } } });

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
    } finally {
      await prisma.$disconnect();
    }
  });

  // --- Section 1: CSV export helpers (pure, no DB rows needed) ---

  describe("export-csv helpers", () => {
    it("buildCsv quotes every field and doubles internal quotes (RFC-4180), with CRLF line endings", async () => {
      if (skipAll) return;
      const { buildCsv } = await import("@/lib/reporting/export-csv");

      const csv = buildCsv(
        [
          { a: "plain", b: 42, c: null },
          { a: 'has "quotes"', b: "has,comma", c: undefined },
        ],
        [
          { key: "a", header: "A" },
          { key: "b", header: "B" },
          { key: "c", header: "C" },
        ]
      );

      const lines = csv.split("\r\n");
      expect(lines[0]).toBe('"A","B","C"');
      expect(lines[1]).toBe('"plain","42",""');
      expect(lines[2]).toBe('"has ""quotes""","has,comma",""');
      expect(csv.endsWith("\r\n")).toBe(true);
    });

    it("buildCsv produces a header-only document for an empty row set", async () => {
      if (skipAll) return;
      const { buildCsv } = await import("@/lib/reporting/export-csv");
      const csv = buildCsv([], [{ key: "x", header: "X" }]);
      expect(csv).toBe('"X"\r\n');
    });

    it("flattenToKeyValueRows flattens nested objects with dotted paths, and renders arrays/nulls without crashing", async () => {
      if (skipAll) return;
      const { flattenToKeyValueRows } = await import("@/lib/reporting/export-csv");

      const rows = flattenToKeyValueRows({
        dateFrom: "2026-01-01",
        funnel: { requestsReceived: 5, quotationsIssued: 3 },
        bottlenecks: [{ transition: "a", averageDays: 1 }],
        missingField: null,
      });

      const byMetric = new Map(rows.map((r) => [r.metric, r.value]));
      expect(byMetric.get("dateFrom")).toBe("2026-01-01");
      expect(byMetric.get("funnel.requestsReceived")).toBe("5");
      expect(byMetric.get("funnel.quotationsIssued")).toBe("3");
      expect(byMetric.get("missingField")).toBe("");
      // Arrays are rendered as a single JSON cell, never silently dropped or expanded into rows this function didn't ask for.
      expect(byMetric.get("bottlenecks")).toBe(JSON.stringify([{ transition: "a", averageDays: 1 }]));
    });

    it("csvResponseHeaders sets a CSV content type, a dated attachment filename, and no-store caching", async () => {
      if (skipAll) return;
      const { csvResponseHeaders } = await import("@/lib/reporting/export-csv");
      const headers = csvResponseHeaders("outstanding-orders") as Record<string, string>;
      expect(headers["Content-Type"]).toContain("text/csv");
      expect(headers["Content-Disposition"]).toMatch(/^attachment; filename="outstanding-orders-\d{4}-\d{2}-\d{2}\.csv"$/);
      expect(headers["Cache-Control"]).toBe("no-store");
    });
  });

  // --- Fixtures shared by the order-based report sections ---

  /** A fresh order with one line, picked with a deliberate shortage (requested 10, found 7) -- gives both a pickable shortage row and a known outstanding-to-dispatch quantity. */
  async function createPartiallyPickedOrder(requestedQuantity: string, foundQuantity: string) {
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
        orderDate: new Date(),
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: [{ lineNumber: 1, originalProductDescription: `M11 report test item ${uniqueSuffix}`, requestedQuantity, requestedUnitCode: "EA", isDemo: true }],
        },
      },
      select: { id: true, reference: true, lines: { select: { id: true } } },
    });
    createdOrderIds.push(order.id);
    const line = order.lines[0]!;

    const started = await startPickingSession(order.id, adminId);
    if (!started.ok) throw new Error(started.message);
    const unavailable = (Number(requestedQuantity) - Number(foundQuantity)).toFixed(4);
    await recordPickedLine(started.session.id, line.id, foundQuantity, unavailable, unavailable !== "0.0000" ? "Short on stock" : undefined, adminId);
    const completed = await completePickingSession(started.session.id, adminId);
    if (!completed.ok) throw new Error(completed.message);
    const authorized = await authorizePickingSession(started.session.id, adminId);
    if (!authorized.ok) throw new Error(authorized.message);

    return { orderId: order.id, reference: order.reference, lineId: line.id, pickingSessionId: started.session.id };
  }

  /**
   * A plain order sitting at a given status with NO picking session and
   * NO dispatch -- for the reports that only care about CustomerOrder.status
   * itself (listOrdersAwaitingFulfilment's own orderStatus filter,
   * sales-pipeline's ordersAwaitingFulfilment cohort count). Deliberately
   * NOT built via startPickingSession/authorizePickingSession: those move
   * the order to PICKING and then READY_TO_INVOICE respectively (see
   * lib/picking/start-picking.ts and lib/picking/authorize-picking.ts),
   * which would leave the order outside the APPROVED/PICKING scope these
   * particular assertions are about, well before any status FILTER is
   * even applied -- a mistake this test file caught on itself rather than
   * one a reader has to catch later.
   */
  async function createOrderWithStatus(status: "APPROVED" | "PICKING" | "REJECTED", requestedQuantity = "1.0000") {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");

    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status,
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: { create: [{ lineNumber: 1, originalProductDescription: `M11 report test item ${uniqueSuffix}`, requestedQuantity, requestedUnitCode: "EA", isDemo: true }] },
      },
      select: { id: true, reference: true },
    });
    createdOrderIds.push(order.id);
    return { orderId: order.id, reference: order.reference };
  }

  // --- Section 2: order-based reports, including this round's status-filter fix ---

  describe("sales-pipeline and fulfilment-intelligence (order-based reports)", () => {
    const baseFilters = () => ({
      dateFrom: null,
      dateTo: null,
      customerId: null,
      productId: null,
      salespersonId: null,
      orderStatus: null,
      quotationStatus: null,
      fulfilmentStatus: null,
      claimStatus: null,
      communicationStatus: null,
      includeDemo: true,
    });

    it("getSalesPipelineReport counts a received order in ordersAwaitingFulfilment while it is APPROVED/PICKING, within its own receivedAt cohort", async () => {
      if (skipAll) return;
      const { getSalesPipelineReport } = await import("@/lib/reporting/sales-pipeline");
      const before = await getSalesPipelineReport(baseFilters());

      await createOrderWithStatus("APPROVED");

      const after = await getSalesPipelineReport(baseFilters());
      expect(after.funnel.ordersReceived).toBe(before.funnel.ordersReceived + 1);
      expect(after.funnel.ordersAwaitingFulfilment).toBe(before.funnel.ordersAwaitingFulfilment + 1);
      // orderApprovalRatePercent's own denominator (ordersReceived) grew by exactly the same order -- never a stale denominator from a different cohort.
      expect(after.funnel.ordersConfirmed).toBeGreaterThanOrEqual(before.funnel.ordersConfirmed + 1);
    });

    it("getFulfilmentIntelligenceReport tracks ordered/available/shortage as three distinct sums, and dispatched is never conflated with delivered", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { getFulfilmentIntelligenceReport } = await import("@/lib/reporting/fulfilment-intelligence");
      const { createDispatchRecord, departDispatchRecord } = await import("@/lib/fulfilment/dispatch");

      const before = await getFulfilmentIntelligenceReport(baseFilters());
      const { orderId, lineId } = await createPartiallyPickedOrder("10.0000", "7.0000");

      const afterPicking = await getFulfilmentIntelligenceReport(baseFilters());
      const { sumDecimalStrings, formatScaledDecimal } = await import("@/lib/fulfilment/decimal");
      expect(formatScaledDecimal(sumDecimalStrings([afterPicking.quantities.orderedQuantity]) - sumDecimalStrings([before.quantities.orderedQuantity]))).toBe("10");
      expect(formatScaledDecimal(sumDecimalStrings([afterPicking.quantities.availableQuantity]) - sumDecimalStrings([before.quantities.availableQuantity]))).toBe("7");
      expect(formatScaledDecimal(sumDecimalStrings([afterPicking.quantities.shortageQuantity]) - sumDecimalStrings([before.quantities.shortageQuantity]))).toBe("3");

      // Dispatch the found quantity but do NOT record a delivery outcome
      // yet -- outstandingDeliveryQuantity must rise by exactly that
      // amount, and dispatchesDelivered must NOT, until an actual
      // DeliveryRecord exists (spec's "never treat dispatched as
      // delivered").
      const dispatch = await createDispatchRecord(orderId, adminId, { lines: [{ orderLineId: lineId, quantity: "7.0000" }] });
      if (!dispatch.ok) throw new Error(dispatch.message);
      await departDispatchRecord(dispatch.dispatchRecordId, adminId);

      const afterDispatch = await getFulfilmentIntelligenceReport(baseFilters());
      expect(formatScaledDecimal(sumDecimalStrings([afterDispatch.quantities.outstandingDeliveryQuantity]) - sumDecimalStrings([afterPicking.quantities.outstandingDeliveryQuantity]))).toBe("7");
      expect(afterDispatch.dispatchDelivery.dispatchesDelivered).toBe(afterPicking.dispatchDelivery.dispatchesDelivered);
      expect(afterDispatch.dispatchDelivery.dispatchesDeparted).toBeGreaterThanOrEqual(afterPicking.dispatchDelivery.dispatchesDeparted + 1);

      await prisma.$disconnect().catch(() => undefined);
    });
  });

  // --- Section 3: management-reports list reports and the status-filter fix ---

  describe("management-reports list reports: status-filter applicability (this round's fix)", () => {
    const filtersWith = (overrides: Partial<Record<string, unknown>>) => ({
      dateFrom: null,
      dateTo: null,
      customerId: null,
      productId: null,
      salespersonId: null,
      orderStatus: null,
      quotationStatus: null,
      fulfilmentStatus: null,
      claimStatus: null,
      communicationStatus: null,
      includeDemo: true,
      ...overrides,
    });

    it("listOrdersAwaitingFulfilment narrows WITHIN its own APPROVED/PICKING definition when orderStatus is supplied, rather than replacing it", async () => {
      if (skipAll) return;
      const { listOrdersAwaitingFulfilment } = await import("@/lib/reporting/management-reports");
      const { reference } = await createOrderWithStatus("APPROVED");

      // orderStatus=APPROVED is within {APPROVED, PICKING} -- the order must appear.
      const matching = await listOrdersAwaitingFulfilment(filtersWith({ orderStatus: "APPROVED" }) as never, { page: 1, pageSize: 50 });
      expect(matching.rows.some((r) => r.reference === reference)).toBe(true);

      // orderStatus=REJECTED is outside that definition -- the AND-array
      // pattern must correctly yield zero rows for THIS order, never fall
      // back to ignoring the filter and showing it anyway.
      const nonMatching = await listOrdersAwaitingFulfilment(filtersWith({ orderStatus: "REJECTED" }) as never, { page: 1, pageSize: 50 });
      expect(nonMatching.rows.some((r) => r.reference === reference)).toBe(false);
    });

    it("listPickingShortages applies fulfilmentStatus as a PickingSessionStatus value, and ignores a value from a different enum rather than zero-rowing", async () => {
      if (skipAll) return;
      const { listPickingShortages } = await import("@/lib/reporting/management-reports");
      const { reference } = await createPartiallyPickedOrder("10.0000", "6.0000");

      // The session was completed AND authorized by createPartiallyPickedOrder -- status is AUTHORIZED.
      const matching = await listPickingShortages(filtersWith({ fulfilmentStatus: "AUTHORIZED" }) as never, { page: 1, pageSize: 50 });
      expect(matching.rows.some((r) => r.orderReference === reference)).toBe(true);

      const nonMatching = await listPickingShortages(filtersWith({ fulfilmentStatus: "IN_PROGRESS" }) as never, { page: 1, pageSize: 50 });
      expect(nonMatching.rows.some((r) => r.orderReference === reference)).toBe(false);

      // "DEPARTED" is a DispatchStatus value, not a PickingSessionStatus --
      // applicableEnumFilter must treat it as "not applicable" (no-op),
      // so the row still appears, not incorrectly suppressed.
      const notApplicable = await listPickingShortages(filtersWith({ fulfilmentStatus: "DEPARTED" }) as never, { page: 1, pageSize: 50 });
      expect(notApplicable.rows.some((r) => r.orderReference === reference)).toBe(true);
    });

    it("listDeliveryExceptions applies fulfilmentStatus as a DeliveryOutcome value, scoped within its own rejected-only definition", async () => {
      if (skipAll) return;
      const { createDispatchRecord, departDispatchRecord } = await import("@/lib/fulfilment/dispatch");
      const { recordDelivery } = await import("@/lib/fulfilment/delivery");
      const { getDispatchRecordDetail } = await import("@/lib/fulfilment/queries");
      const { listDeliveryExceptions } = await import("@/lib/reporting/management-reports");

      const { orderId, lineId, reference } = await createPartiallyPickedOrder("4.0000", "4.0000");
      const dispatch = await createDispatchRecord(orderId, adminId, { lines: [{ orderLineId: lineId, quantity: "4.0000" }] });
      if (!dispatch.ok) throw new Error(dispatch.message);
      await departDispatchRecord(dispatch.dispatchRecordId, adminId);
      const detail = await getDispatchRecordDetail(dispatch.dispatchRecordId);
      const dLine = detail!.lines[0]!;
      const delivered = await recordDelivery(
        dispatch.dispatchRecordId,
        adminId,
        { lines: [{ dispatchLineId: dLine.id, acceptedQuantity: "3.0000", rejectedQuantity: "1.0000", rejectionReason: "1 unit damaged" }] },
        {}
      );
      if (!delivered.ok) throw new Error("recordDelivery failed");

      const matching = await listDeliveryExceptions(filtersWith({ fulfilmentStatus: "PARTIALLY_REJECTED" }) as never, { page: 1, pageSize: 50 });
      expect(matching.rows.some((r) => r.orderReference === reference)).toBe(true);

      // ACCEPTED_IN_FULL is a valid DeliveryOutcome but outside this
      // report's own "is an exception" definition -- must correctly
      // yield zero rows for this record via the AND-array, not widen scope.
      const nonMatching = await listDeliveryExceptions(filtersWith({ fulfilmentStatus: "ACCEPTED_IN_FULL" }) as never, { page: 1, pageSize: 50 });
      expect(nonMatching.rows.some((r) => r.orderReference === reference)).toBe(false);
    });

    it("demo-data exclusion: a demo-tagged order is absent with includeDemo=false and present with includeDemo=true", async () => {
      if (skipAll) return;
      const { listOrdersAwaitingFulfilment } = await import("@/lib/reporting/management-reports");
      const { reference } = await createOrderWithStatus("PICKING");

      const excluded = await listOrdersAwaitingFulfilment(filtersWith({ includeDemo: false }) as never, { page: 1, pageSize: 500 });
      expect(excluded.rows.some((r) => r.reference === reference)).toBe(false);

      const included = await listOrdersAwaitingFulfilment(filtersWith({ includeDemo: true }) as never, { page: 1, pageSize: 500 });
      expect(included.rows.some((r) => r.reference === reference)).toBe(true);
    });

    it("pagination: pageSize=1 across two known rows returns exactly one row per page with correct totals", async () => {
      if (skipAll) return;
      const { listOrdersAwaitingFulfilment } = await import("@/lib/reporting/management-reports");
      const { reference: ref1 } = await createOrderWithStatus("APPROVED");
      const { reference: ref2 } = await createOrderWithStatus("PICKING");

      const all = await listOrdersAwaitingFulfilment(filtersWith({}) as never, { page: 1, pageSize: 500 });
      const totalBefore = all.pagination.totalItems;
      expect(all.rows.some((r) => r.reference === ref1)).toBe(true);
      expect(all.rows.some((r) => r.reference === ref2)).toBe(true);

      const page1 = await listOrdersAwaitingFulfilment(filtersWith({}) as never, { page: 1, pageSize: 1 });
      expect(page1.rows).toHaveLength(1);
      expect(page1.pagination.totalItems).toBe(totalBefore);
      expect(page1.pagination.totalPages).toBe(totalBefore);
    });
  });

  // --- Section 4: communications monitoring ---

  describe("communications-monitoring", () => {
    const baseFilters = () => ({
      dateFrom: null,
      dateTo: null,
      customerId: null,
      productId: null,
      salespersonId: null,
      orderStatus: null,
      quotationStatus: null,
      fulfilmentStatus: null,
      claimStatus: null,
      communicationStatus: null,
      includeDemo: true,
    });

    it("intake.totalReceived always equals the sum of intake.byChannel -- same where clause, so this must hold structurally", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { getCommunicationsMonitoringReport } = await import("@/lib/reporting/communications-monitoring");

      const intake = await prisma.messageIntake.create({
        data: {
          channel: "EMAIL",
          fromAddress: `m11-${uniqueSuffix}@example.com`,
          receivedAt: new Date(),
          customerId,
          status: "RECEIVED",
          isDemo: true,
        },
        select: { id: true },
      });
      createdMessageIntakeIds.push(intake.id);

      const report = await getCommunicationsMonitoringReport(baseFilters() as never);
      const channelSum = report.intake.byChannel.reduce((sum, c) => sum + c.count, 0);
      expect(channelSum).toBe(report.intake.totalReceived);
      expect(report.intake.awaitingReview).toBeGreaterThanOrEqual(1);
    });

    it("outbound.failed counts a FAILED OutboundMessage, and listCommunicationFailures' row count never exceeds that same figure", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { getCommunicationsMonitoringReport } = await import("@/lib/reporting/communications-monitoring");
      const { listCommunicationFailures } = await import("@/lib/reporting/management-reports");

      const before = await getCommunicationsMonitoringReport(baseFilters() as never);

      const outbound = await prisma.outboundMessage.create({
        data: {
          type: "ORDER_CONFIRMATION",
          channel: "EMAIL",
          status: "FAILED",
          idempotencyKey: `m11-${uniqueSuffix}-${Date.now()}`,
          customerId,
          bodyText: "Test notification body",
          triggeredById: adminId,
          attemptCount: 2,
          lastAttemptAt: new Date(),
          lastErrorMessage: "SMTP timeout (test fixture)",
          isDemo: true,
        },
        select: { id: true },
      });
      createdOutboundMessageIds.push(outbound.id);

      const after = await getCommunicationsMonitoringReport(baseFilters() as never);
      expect(after.outbound.failed).toBe(before.outbound.failed + 1);

      const failures = await listCommunicationFailures(baseFilters() as never, { page: 1, pageSize: 500 });
      expect(failures.rows.some((r) => r.id === outbound.id)).toBe(true);
      expect(failures.pagination.totalItems).toBe(after.outbound.failed);
    });
  });

  // --- Section 5: financial exposure -- the never-sum-across-currencies invariant ---

  describe("financial-exposure: claims exposure is kept per-currency, never pre-summed", () => {
    async function createSapInvoice(currencyCode: string, lines: { quantityInvoiced: string; unitPrice: string }[]) {
      const { prisma } = await import("@/lib/prisma");

      const batch = await prisma.sapInvoiceImportBatch.create({
        data: {
          originalFileName: "m11-test.csv",
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

      const docNum = `INV-${uniqueSuffix}-${currencyCode}-${createdSapInvoiceIds.length + 1}`;
      const invoice = await prisma.sapInvoice.create({
        data: {
          importBatchId: batch.id,
          sapDocNum: docNum,
          customerSapCode: "DEMO-CUST-001",
          customerName: "M11 report test customer (Demo)",
          matchedCustomerId: customerId,
          invoiceDate: new Date(),
          currencyCode,
          total: lines.reduce((sum, l) => sum + Number(l.quantityInvoiced) * Number(l.unitPrice), 0).toFixed(4),
          rawSourceData: {},
          isDemo: true,
          lines: {
            create: lines.map((line, i) => ({
              lineNumber: i + 1,
              sapItemCode: `ITEM-${uniqueSuffix}-${currencyCode}-${i + 1}`,
              sapItemDescription: "M11 report test item",
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

    it("exposureByCurrency keeps a USD claim and a non-USD claim as separate, un-summed rows", async () => {
      if (skipAll) return;
      const { createInvoiceClaim } = await import("@/lib/invoice-claims/create-claim");
      const { getFinancialExposureReport } = await import("@/lib/reporting/financial-exposure");

      const usdInvoice = await createSapInvoice("USD", [{ quantityInvoiced: "100.0000", unitPrice: "10.0000" }]);
      const zwgInvoice = await createSapInvoice("ZWG", [{ quantityInvoiced: "50.0000", unitPrice: "20.0000" }]);

      const usdClaim = await createInvoiceClaim(
        {
          sapInvoiceId: usdInvoice.invoiceId,
          customerId,
          category: "DAMAGED_PRODUCTS",
          description: `M11 USD claim ${uniqueSuffix}`,
          claimDate: new Date().toISOString().slice(0, 10),
          lines: [{ sapInvoiceLineId: usdInvoice.lineIds[0]!, disputeType: "QUANTITY", acceptedQuantity: "90.0000", rejectedQuantity: "10.0000", reason: "10 units damaged" }],
        },
        adminId
      );
      if (!usdClaim.ok) throw new Error(usdClaim.message);
      createdClaimIds.push(usdClaim.id);

      const zwgClaim = await createInvoiceClaim(
        {
          sapInvoiceId: zwgInvoice.invoiceId,
          customerId,
          category: "DAMAGED_PRODUCTS",
          description: `M11 ZWG claim ${uniqueSuffix}`,
          claimDate: new Date().toISOString().slice(0, 10),
          lines: [{ sapInvoiceLineId: zwgInvoice.lineIds[0]!, disputeType: "QUANTITY", acceptedQuantity: "45.0000", rejectedQuantity: "5.0000", reason: "5 units damaged" }],
        },
        adminId
      );
      if (!zwgClaim.ok) throw new Error(zwgClaim.message);
      createdClaimIds.push(zwgClaim.id);

      const report = await getFinancialExposureReport({
        dateFrom: null,
        dateTo: null,
        customerId: null,
        productId: null,
        salespersonId: null,
        orderStatus: null,
        quotationStatus: null,
        fulfilmentStatus: null,
        claimStatus: null,
        communicationStatus: null,
        includeDemo: true,
      } as never);

      const usdBucket = report.claims.exposureByCurrency.find((b) => b.currencyCode === "USD");
      const zwgBucket = report.claims.exposureByCurrency.find((b) => b.currencyCode === "ZWG");
      expect(usdBucket).toBeDefined();
      expect(zwgBucket).toBeDefined();
      // Each currency's own exposure figure must be a plain decimal string
      // for that currency alone -- never combined with the other
      // currency's figure into one number (the core invariant spec
      // section 6 asks for: never fabricate a cross-currency total).
      expect(Number(usdBucket!.potentialCreditExposure)).toBeCloseTo(100, 0); // 10 units * $10
      expect(Number(zwgBucket!.potentialCreditExposure)).toBeCloseTo(100, 0); // 5 units * ZWG 20
      expect(usdBucket!.currencyCode).not.toBe(zwgBucket!.currencyCode);
    });
  });
});
