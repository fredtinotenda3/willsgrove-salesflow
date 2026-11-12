import "server-only";
import { Prisma, OrderStatus, PickingSessionStatus, DeliveryOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReportFilters, PaginationParams, PaginatedResult } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter } from "@/lib/reporting/filters";
import { getSalesPipelineReport } from "@/lib/reporting/sales-pipeline";
import { getFulfilmentIntelligenceReport } from "@/lib/reporting/fulfilment-intelligence";
import { getFinancialExposureReport } from "@/lib/reporting/financial-exposure";
import { getCommunicationsMonitoringReport } from "@/lib/reporting/communications-monitoring";
import { getLostSalesReportSummary } from "@/lib/lost-sales/queries";
import { getQuotationDashboardCounts } from "@/lib/quotations/queries";
import { utcDateToDateOnlyString } from "@/lib/dates";

/**
 * Milestone 11 (Operational BI), spec section 9: the 9 named management
 * reports. Restricted to SALES_MANAGER/ADMINISTRATOR (see
 * lib/reporting/access.ts) -- the decision this round's architecture
 * review settled on, distinct from the open-to-everyone operational
 * views in the other lib/reporting/*.ts files.
 *
 * Two shapes:
 *   - SUMMARY reports (operational-summary, quotations-performance,
 *     lost-sales, invoice-claims-exposure, communication-failures'
 *     headline figures) are thin compositions over the already-built
 *     aggregate functions above -- no business logic is re-derived here.
 *   - LIST reports (outstanding-orders, awaiting-fulfilment,
 *     picking-shortages, delivery-exceptions, communication-failures'
 *     own failed-message list) are genuinely new paginated queries --
 *     nothing in M0-M10 already exposes these specific cuts as a bulk,
 *     filterable list, so this file is their one home (spec section 2:
 *     "reusable reporting services... avoid duplicating business logic
 *     across individual dashboard pages" -- these are the shared
 *     service, not a tenth place that re-queries CustomerOrder by hand).
 *
 * "Daily operational summary" / "Weekly operational summary" / "Monthly
 * operational summary" are deliberately ONE report (operational-summary)
 * parameterized by `period`, not three near-duplicate functions --
 * they ask the identical question ("summarize activity over period X")
 * at three different granularities, and the underlying computation
 * (today ± N days, fed into the same sales-pipeline/fulfilment/
 * financial/communications modules every other report already uses)
 * does not change with the granularity.
 */

export type ManagementReportId =
  | "operational-summary"
  | "outstanding-orders"
  | "awaiting-fulfilment"
  | "picking-shortages"
  | "delivery-exceptions"
  | "quotations-performance"
  | "lost-sales"
  | "invoice-claims-exposure"
  | "communication-failures";

export const MANAGEMENT_REPORT_CATALOGUE: { id: ManagementReportId; name: string; description: string; kind: "summary" | "list" }[] = [
  { id: "operational-summary", name: "Operational summary", description: "Daily, weekly, or monthly rollup of sales-pipeline, fulfilment, financial, and communications activity.", kind: "summary" },
  { id: "outstanding-orders", name: "Outstanding orders", description: "Orders not yet cancelled, rejected, or confirmed fully delivered.", kind: "list" },
  { id: "awaiting-fulfilment", name: "Orders awaiting fulfilment", description: "Approved orders with no dispatch that has departed yet.", kind: "list" },
  { id: "picking-shortages", name: "Picking shortages", description: "Order lines where the picked quantity fell short of what was requested.", kind: "list" },
  { id: "delivery-exceptions", name: "Delivery exceptions", description: "Deliveries the customer partially or fully rejected.", kind: "list" },
  { id: "quotations-performance", name: "Quotations performance", description: "Quotation funnel counts, value, and acceptance rate for the selected period.", kind: "summary" },
  { id: "lost-sales", name: "Lost-sales report", description: "Distinct, non-blended lost-sales figures by cause and product.", kind: "summary" },
  { id: "invoice-claims-exposure", name: "Invoice claims and exposure", description: "Consolidated reconciliation, claims, and financial-exposure figures.", kind: "summary" },
  { id: "communication-failures", name: "Communication failures", description: "Outbound messages that failed to send, with retry counts.", kind: "list" },
];

export type OperationalSummaryPeriod = "daily" | "weekly" | "monthly";

function periodToDateRange(period: OperationalSummaryPeriod): { dateFrom: string; dateTo: string } {
  const today = new Date();
  const from = new Date(today);
  const daysBack = period === "daily" ? 0 : period === "weekly" ? 6 : 29;
  from.setUTCDate(from.getUTCDate() - daysBack);
  return { dateFrom: utcDateToDateOnlyString(from)!, dateTo: utcDateToDateOnlyString(today)! };
}

export async function getOperationalSummaryReport(filters: ReportFilters, period: OperationalSummaryPeriod) {
  const { dateFrom, dateTo } = periodToDateRange(period);
  const periodFilters: ReportFilters = { ...filters, dateFrom, dateTo };
  const [pipeline, fulfilment, financial, communications] = await Promise.all([
    getSalesPipelineReport(periodFilters),
    getFulfilmentIntelligenceReport(periodFilters),
    getFinancialExposureReport(periodFilters),
    getCommunicationsMonitoringReport(periodFilters),
  ]);
  return { period, dateFrom, dateTo, pipeline, fulfilment, financial, communications };
}

export async function getQuotationsPerformanceReport(filters: ReportFilters) {
  const [dashboard, pipeline] = await Promise.all([getQuotationDashboardCounts(), getSalesPipelineReport(filters)]);
  return { allTime: dashboard, period: { dateFrom: pipeline.dateFrom, dateTo: pipeline.dateTo, funnel: pipeline.funnel } };
}

/**
 * Reuses the pre-existing M4 lost-sales summary as-is (spec section 2:
 * reuse, don't re-derive). That function is a whole-business "right now"
 * total by its own original design -- the same "current state, not a
 * date-ranged report" shape operational-dashboard.ts's snapshot already
 * documents -- so only `includeDemo` carries through here; dateFrom/
 * dateTo/customerId/productId are accepted by the shared filter bar but
 * have no effect on this particular report. Changing that function's
 * signature to accept them is out of scope for this milestone (spec
 * section 15: don't modify an established M0-M10 workflow without need).
 */
export async function getLostSalesManagementReport(filters: ReportFilters) {
  return getLostSalesReportSummary({ includeDemo: filters.includeDemo });
}

export async function getInvoiceClaimsExposureManagementReport(filters: ReportFilters) {
  // See lib/reporting/financial-exposure.ts's own top comment: the
  // `claims`/`reconciliation` sections of this composed report are
  // likewise "right now" totals from the pre-existing M5/M6A dashboards,
  // not date/customer filtered -- only `returnsAndCreditNotes` is.
  return getFinancialExposureReport(filters);
}

// --- List reports ---

/**
 * fulfilmentStatus/communicationStatus in ReportFilters each map onto
 * more than one schema enum depending on which table a given list report
 * queries (see lib/reporting/filters.ts's own comment on readEnumFilter
 * for why that means they can't be validated centrally). This helper is
 * the per-report-function validation: a value is applied only when it is
 * actually a member of THIS report's own relevant enum; a value that is
 * well-formed but belongs to a DIFFERENT report's enum (e.g. a
 * DispatchStatus value arriving here, where this report's own entity is
 * PickingSession) is treated as "not applicable to this report" and
 * simply not applied -- never a thrown error, and never forced into an
 * always-false filter either, since "not applicable" and "no rows match"
 * are different things and only one of them is true here.
 */
function applicableEnumFilter<T extends string>(fieldName: string, value: string | null, validValues: readonly T[]): Record<string, T> {
  if (value && (validValues as readonly string[]).includes(value)) {
    return { [fieldName]: value as T };
  }
  return {};
}

/** Wraps applicableEnumFilter's result for use inside an `AND: [...]` array (see the AND-array pattern comments on listOutstandingOrders et al.) -- `[]` when the filter doesn't apply, so spreading it is always safe. */
function asAndClauses<T extends object>(filter: T): T[] {
  return Object.keys(filter).length > 0 ? [filter] : [];
}

const PICKING_SESSION_STATUSES: PickingSessionStatus[] = [PickingSessionStatus.IN_PROGRESS, PickingSessionStatus.COMPLETED, PickingSessionStatus.AUTHORIZED];
const DELIVERY_OUTCOMES: DeliveryOutcome[] = [DeliveryOutcome.ACCEPTED_IN_FULL, DeliveryOutcome.PARTIALLY_REJECTED, DeliveryOutcome.FULLY_REJECTED];

const orderListRowSelect = {
  id: true,
  reference: true,
  status: true,
  customer: { select: { id: true, name: true } },
  salesperson: { select: { id: true, name: true } },
  total: true,
  currency: true,
  receivedAt: true,
  approvedAt: true,
} satisfies Prisma.CustomerOrderSelect;

export type OutstandingOrderRow = {
  id: string;
  reference: string;
  status: string;
  customerName: string;
  salespersonName: string | null;
  total: string | null;
  currency: string;
  receivedAt: string | null;
  daysOutstanding: number | null;
};

function toOutstandingOrderRow(order: Prisma.CustomerOrderGetPayload<{ select: typeof orderListRowSelect }>): OutstandingOrderRow {
  const receivedAt = order.receivedAt;
  return {
    id: order.id,
    reference: order.reference,
    status: order.status,
    customerName: order.customer.name,
    salespersonName: order.salesperson?.name ?? null,
    total: order.total?.toString() ?? null,
    currency: order.currency,
    receivedAt: receivedAt?.toISOString() ?? null,
    daysOutstanding: receivedAt ? Math.floor((Date.now() - receivedAt.getTime()) / (1000 * 60 * 60 * 24)) : null,
  };
}

/**
 * "Outstanding orders" -- not cancelled or rejected, and not yet
 * confirmed fully delivered (no dispatch of this order has a
 * DeliveryRecord with outcome ACCEPTED_IN_FULL). Documented
 * approximation: a order delivered across SEVERAL partial dispatches
 * that together cover its full requested quantity, with none of those
 * individual deliveries itself marked ACCEPTED_IN_FULL, would still
 * show here -- exact per-line quantity reconciliation across multiple
 * dispatches is lib/reporting/fulfilment-intelligence.ts's job at the
 * aggregate level, not this list report's. See docs/milestones/
 * m11-metric-definitions.md.
 */
export async function listOutstandingOrders(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<OutstandingOrderRow>> {
  // "status" is built via AND, never a later spread overwriting an earlier
  // one in the same object literal -- an orderStatus filter narrows WITHIN
  // the not-cancelled/not-rejected/not-fully-delivered definition, it never
  // replaces it (a naive `...{status: filters.orderStatus}` spread after
  // the base `status: {notIn:...}` key would silently discard that
  // constraint on the one line that actually defines "outstanding").
  const where: Prisma.CustomerOrderWhereInput = {
    ...demoWhere(filters),
    dispatchRecords: { none: { deliveryRecord: { outcome: "ACCEPTED_IN_FULL" } } },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
    AND: [{ status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] } }, ...(filters.orderStatus ? [{ status: filters.orderStatus as OrderStatus }] : [])],
  };
  const [totalItems, rows] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({ where, select: orderListRowSelect, orderBy: { receivedAt: "asc" }, skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize }),
  ]);
  return { rows: rows.map(toOutstandingOrderRow), pagination: { ...pagination, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) } };
}

/** Orders APPROVED or PICKING with no dispatch that has actually departed yet. */
export async function listOrdersAwaitingFulfilment(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<OutstandingOrderRow>> {
  // Same AND-array pattern as listOutstandingOrders above, and for the
  // same reason: a later `status` key in the same object literal would
  // silently replace this report's own defining `status: {in: [...]}`
  // constraint rather than narrow within it. An orderStatus value outside
  // {APPROVED, PICKING} (e.g. "REJECTED") correctly yields zero rows here
  // via the AND, rather than needing its own validation -- it's not
  // "awaiting fulfilment" by definition, which is the right answer.
  const where: Prisma.CustomerOrderWhereInput = {
    ...demoWhere(filters),
    dispatchRecords: { none: { status: { in: ["DEPARTED", "DELIVERED"] } } },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
    AND: [{ status: { in: [OrderStatus.APPROVED, OrderStatus.PICKING] } }, ...(filters.orderStatus ? [{ status: filters.orderStatus as OrderStatus }] : [])],
  };
  const [totalItems, rows] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({ where, select: orderListRowSelect, orderBy: { approvedAt: "asc" }, skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize }),
  ]);
  return { rows: rows.map(toOutstandingOrderRow), pagination: { ...pagination, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) } };
}

export type PickingShortageRow = {
  pickingLineId: string;
  orderId: string;
  orderReference: string;
  customerName: string;
  productDescription: string;
  requestedQuantity: string;
  foundQuantity: string | null;
  unavailableQuantity: string | null;
  pickedAt: string | null;
};

export async function listPickingShortages(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<PickingShortageRow>> {
  const range = dateRangeToTimestampFilter(filters);
  // fulfilmentStatus applies here as a PickingSessionStatus value (this
  // report's own entity) -- see applicableStatusFilter's comment above
  // for why a value belonging to a different fulfilment-stage enum
  // (DispatchStatus/DeliveryOutcome) is simply not applied rather than
  // forced into a zero-row filter.
  const where: Prisma.PickingLineWhereInput = {
    unavailableQuantity: { not: null, gt: 0 },
    pickingSession: {
      ...demoWhere(filters),
      startedAt: range,
      ...applicableEnumFilter("status", filters.fulfilmentStatus, PICKING_SESSION_STATUSES),
      order: {
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
        ...(filters.productId ? { lines: { some: { productId: filters.productId } } } : {}),
      },
    },
  };
  const [totalItems, rows] = await Promise.all([
    prisma.pickingLine.count({ where }),
    prisma.pickingLine.findMany({
      where,
      select: {
        id: true,
        requestedQuantity: true,
        foundQuantity: true,
        unavailableQuantity: true,
        pickedAt: true,
        orderLine: { select: { originalProductDescription: true, product: { select: { itemName: true } }, order: { select: { id: true, reference: true, customer: { select: { name: true } } } } } },
      },
      orderBy: { pickedAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
  ]);
  return {
    rows: rows.map((line) => ({
      pickingLineId: line.id,
      orderId: line.orderLine.order.id,
      orderReference: line.orderLine.order.reference,
      customerName: line.orderLine.order.customer.name,
      productDescription: line.orderLine.product?.itemName ?? line.orderLine.originalProductDescription,
      requestedQuantity: line.requestedQuantity.toString(),
      foundQuantity: line.foundQuantity?.toString() ?? null,
      unavailableQuantity: line.unavailableQuantity?.toString() ?? null,
      pickedAt: line.pickedAt?.toISOString() ?? null,
    })),
    pagination: { ...pagination, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) },
  };
}

export type DeliveryExceptionRow = {
  deliveryRecordId: string;
  orderId: string;
  orderReference: string;
  customerName: string;
  outcome: string;
  recordedAt: string;
  rejectionNotes: string[];
};

export async function listDeliveryExceptions(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<DeliveryExceptionRow>> {
  const range = dateRangeToTimestampFilter(filters);
  // Same AND-array pattern as listOutstandingOrders/listOrdersAwaitingFulfilment
  // above: narrows WITHIN "is an exception" rather than replacing that
  // definition. fulfilmentStatus applies here as a DeliveryOutcome value
  // (this report's own entity); ACCEPTED_IN_FULL is a valid DeliveryOutcome
  // but not an exception, so passing it here correctly yields zero rows via
  // the AND rather than needing special-case rejection.
  const where: Prisma.DeliveryRecordWhereInput = {
    ...demoWhere(filters),
    recordedAt: range,
    AND: [{ outcome: { in: [DeliveryOutcome.PARTIALLY_REJECTED, DeliveryOutcome.FULLY_REJECTED] } }, ...asAndClauses(applicableEnumFilter("outcome", filters.fulfilmentStatus, DELIVERY_OUTCOMES))],
    dispatchRecord: {
      order: {
        ...(filters.customerId ? { customerId: filters.customerId } : {}),
        ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
      },
    },
  };
  const [totalItems, rows] = await Promise.all([
    prisma.deliveryRecord.count({ where }),
    prisma.deliveryRecord.findMany({
      where,
      select: {
        id: true,
        outcome: true,
        recordedAt: true,
        dispatchRecord: { select: { order: { select: { id: true, reference: true, customer: { select: { name: true } } } } } },
        lines: { select: { rejectionReason: true }, where: { rejectionReason: { not: null } } },
      },
      orderBy: { recordedAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
  ]);
  return {
    rows: rows.map((record) => ({
      deliveryRecordId: record.id,
      orderId: record.dispatchRecord.order.id,
      orderReference: record.dispatchRecord.order.reference,
      customerName: record.dispatchRecord.order.customer.name,
      outcome: record.outcome,
      recordedAt: record.recordedAt.toISOString(),
      rejectionNotes: record.lines.map((l) => l.rejectionReason).filter((r): r is string => r !== null),
    })),
    pagination: { ...pagination, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) },
  };
}

/** CSV column layout for each list-kind report's own row shape -- used by GET /api/reports/management/[reportId]/export so that file doesn't need its own knowledge of each report's fields. */
export const LIST_REPORT_CSV_COLUMNS: Record<string, { key: string; header: string }[]> = {
  "outstanding-orders": [
    { key: "reference", header: "Order reference" },
    { key: "status", header: "Status" },
    { key: "customerName", header: "Customer" },
    { key: "salespersonName", header: "Salesperson" },
    { key: "total", header: "Total" },
    { key: "currency", header: "Currency" },
    { key: "receivedAt", header: "Received at" },
    { key: "daysOutstanding", header: "Days outstanding" },
  ],
  "awaiting-fulfilment": [
    { key: "reference", header: "Order reference" },
    { key: "status", header: "Status" },
    { key: "customerName", header: "Customer" },
    { key: "salespersonName", header: "Salesperson" },
    { key: "total", header: "Total" },
    { key: "currency", header: "Currency" },
    { key: "receivedAt", header: "Received at" },
    { key: "daysOutstanding", header: "Days outstanding" },
  ],
  "picking-shortages": [
    { key: "orderReference", header: "Order reference" },
    { key: "customerName", header: "Customer" },
    { key: "productDescription", header: "Product" },
    { key: "requestedQuantity", header: "Requested quantity" },
    { key: "foundQuantity", header: "Found quantity" },
    { key: "unavailableQuantity", header: "Unavailable quantity" },
    { key: "pickedAt", header: "Picked at" },
  ],
  "delivery-exceptions": [
    { key: "orderReference", header: "Order reference" },
    { key: "customerName", header: "Customer" },
    { key: "outcome", header: "Outcome" },
    { key: "recordedAt", header: "Recorded at" },
    { key: "rejectionNotes", header: "Rejection notes" },
  ],
  "communication-failures": [
    { key: "type", header: "Message type" },
    { key: "channel", header: "Channel" },
    { key: "customerName", header: "Customer" },
    { key: "attemptCount", header: "Attempt count" },
    { key: "lastAttemptAt", header: "Last attempt at" },
    { key: "lastErrorMessage", header: "Last error" },
  ],
};

// --- Dispatcher ---

export function isManagementReportId(value: string): value is ManagementReportId {
  return MANAGEMENT_REPORT_CATALOGUE.some((r) => r.id === value);
}

export type ManagementReportResult =
  | { kind: "summary"; data: unknown }
  | { kind: "list"; data: PaginatedResult<unknown> };

/**
 * One switch, used by both the view route and the export route, so
 * neither can drift from "which report id maps to which function" --
 * see this file's own top comment on why operational-summary is a
 * single parameterized function rather than three.
 */
export async function runManagementReport(
  reportId: ManagementReportId,
  filters: ReportFilters,
  pagination: PaginationParams,
  period: OperationalSummaryPeriod = "daily"
): Promise<ManagementReportResult> {
  switch (reportId) {
    case "operational-summary":
      return { kind: "summary", data: await getOperationalSummaryReport(filters, period) };
    case "quotations-performance":
      return { kind: "summary", data: await getQuotationsPerformanceReport(filters) };
    case "lost-sales":
      return { kind: "summary", data: await getLostSalesManagementReport(filters) };
    case "invoice-claims-exposure":
      return { kind: "summary", data: await getInvoiceClaimsExposureManagementReport(filters) };
    case "outstanding-orders":
      return { kind: "list", data: await listOutstandingOrders(filters, pagination) };
    case "awaiting-fulfilment":
      return { kind: "list", data: await listOrdersAwaitingFulfilment(filters, pagination) };
    case "picking-shortages":
      return { kind: "list", data: await listPickingShortages(filters, pagination) };
    case "delivery-exceptions":
      return { kind: "list", data: await listDeliveryExceptions(filters, pagination) };
    case "communication-failures":
      return { kind: "list", data: await listCommunicationFailures(filters, pagination) };
  }
}

export type CommunicationFailureRow = {
  id: string;
  type: string;
  channel: string;
  customerName: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastErrorMessage: string | null;
};

/**
 * communicationStatus is deliberately NOT applied here: this report's own
 * identity already IS "OutboundMessage rows with status FAILED" -- a
 * communicationStatus value of FAILED would be a no-op and anything else
 * would just zero the list, neither of which is useful filtering. The
 * filter dimension has real effect on the shared /reports filter bar's
 * other users (the communications monitoring view's channel breakdown
 * already shows this exact count), not on this already-fixed-status list.
 */
export async function listCommunicationFailures(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<CommunicationFailureRow>> {
  const range = dateRangeToTimestampFilter(filters);
  const where: Prisma.OutboundMessageWhereInput = {
    ...demoWhere(filters),
    status: "FAILED",
    createdAt: range,
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
  };
  const [totalItems, rows] = await Promise.all([
    prisma.outboundMessage.count({ where }),
    prisma.outboundMessage.findMany({
      where,
      select: { id: true, type: true, channel: true, attemptCount: true, lastAttemptAt: true, lastErrorMessage: true, customer: { select: { name: true } } },
      orderBy: { lastAttemptAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
  ]);
  return {
    rows: rows.map((m) => ({
      id: m.id,
      type: m.type,
      channel: m.channel,
      customerName: m.customer.name,
      attemptCount: m.attemptCount,
      lastAttemptAt: m.lastAttemptAt?.toISOString() ?? null,
      lastErrorMessage: m.lastErrorMessage,
    })),
    pagination: { ...pagination, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) },
  };
}
