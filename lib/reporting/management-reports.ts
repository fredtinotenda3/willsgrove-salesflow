import "server-only";
import { Prisma, OrderStatus, PickingSessionStatus, DeliveryOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReportFilters, PaginationParams, PaginatedResult } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter } from "@/lib/reporting/filters";
import { getSalesPipelineReport } from "@/lib/reporting/sales-pipeline";
import { getFulfilmentIntelligenceReport } from "@/lib/reporting/fulfilment-intelligence";
import { getFinancialExposureReport } from "@/lib/reporting/financial-exposure";
import { getCommunicationsMonitoringReport } from "@/lib/reporting/communications-monitoring";
import { getLostSalesReportSummary, getAutomaticLostSalesValue, type LostSalesReportSummary } from "@/lib/lost-sales/queries";
import { getQuotationDashboardCounts } from "@/lib/quotations/queries";
import { utcDateToDateOnlyString } from "@/lib/dates";
import { getEffectiveOrderStatus } from "@/lib/order-display";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { multiplyDecimalStrings } from "@/lib/lost-sales/validation";

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

export type LostSalesManagementReport = LostSalesReportSummary & {
  /** Follow-up fix: "since now we have prices, the graphs should now have prices too... the quantity should be associated with its price" -- lib/lost-sales/queries.ts's getAutomaticLostSalesValue, the SAME current/non-superseded scope getLostSalesReportSummary's own totalUnavailableQuantity already uses, composed alongside it rather than folded into that established function (see this function's own comment on why it is reused as-is, unmodified). */
  estimatedValue: string;
  /** How many of the demands behind totalUnavailableQuantity had no resolvable price and are excluded from estimatedValue above -- never silently dropped from view. */
  demandsWithoutEstimate: number;
};

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
 *
 * Follow-up fix: composed with getAutomaticLostSalesValue (same reuse
 * discipline as getInvoiceClaimsExposureManagementReport's own composed
 * figures above) so this summary's quantity totals gain a price-derived
 * value alongside them, without touching getLostSalesReportSummary
 * itself.
 */
export async function getLostSalesManagementReport(filters: ReportFilters): Promise<LostSalesManagementReport> {
  const [summary, value] = await Promise.all([
    getLostSalesReportSummary({ includeDemo: filters.includeDemo }),
    getAutomaticLostSalesValue({ includeDemo: filters.includeDemo }),
  ]);
  return { ...summary, estimatedValue: value.estimatedValue, demandsWithoutEstimate: value.demandsWithoutEstimate };
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
  // Final completion phase, section 7: non-CANCELLED DispatchRecord.status
  // values, so this report's own "status" column can show the same
  // derived label (e.g. "Departed"/"Delivered") as every other order
  // surface instead of the raw, permanently-stuck OrderStatus enum value
  // -- see lib/order-display.ts's getEffectiveOrderStatus.
  dispatchRecords: { where: { status: { not: "CANCELLED" } }, select: { status: true } },
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
  const { label: statusLabel } = getEffectiveOrderStatus({
    status: order.status,
    dispatchStatuses: order.dispatchRecords.map((d) => d.status),
  });
  return {
    id: order.id,
    reference: order.reference,
    status: statusLabel,
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
// "status" is built via AND, never a later spread overwriting an earlier
// one in the same object literal -- an orderStatus filter narrows WITHIN
// the not-cancelled/not-rejected/not-fully-delivered definition, it never
// replaces it (a naive `...{status: filters.orderStatus}` spread after
// the base `status: {notIn:...}` key would silently discard that
// constraint on the one line that actually defines "outstanding"). Pulled
// out into its own function (Management Analytics spec Part 2) so the
// paginated list and its breakdown-by-status aggregate below are
// guaranteed to never disagree about which rows are "outstanding."
function buildOutstandingOrdersWhere(filters: ReportFilters): Prisma.CustomerOrderWhereInput {
  return {
    ...demoWhere(filters),
    dispatchRecords: { none: { deliveryRecord: { outcome: "ACCEPTED_IN_FULL" } } },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
    AND: [{ status: { notIn: [OrderStatus.CANCELLED, OrderStatus.REJECTED] } }, ...(filters.orderStatus ? [{ status: filters.orderStatus as OrderStatus }] : [])],
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
  const where = buildOutstandingOrdersWhere(filters);
  const [totalItems, rows] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({ where, select: orderListRowSelect, orderBy: { receivedAt: "asc" }, skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize }),
  ]);
  return { rows: rows.map(toOutstandingOrderRow), pagination: { ...pagination, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) } };
}

// Same AND-array pattern as buildOutstandingOrdersWhere above, and for the
// same reason: a later `status` key in the same object literal would
// silently replace this report's own defining `status: {in: [...]}`
// constraint rather than narrow within it. An orderStatus value outside
// {APPROVED, PICKING} (e.g. "REJECTED") correctly yields zero rows here
// via the AND, rather than needing its own validation -- it's not
// "awaiting fulfilment" by definition, which is the right answer.
function buildAwaitingFulfilmentWhere(filters: ReportFilters): Prisma.CustomerOrderWhereInput {
  return {
    ...demoWhere(filters),
    dispatchRecords: { none: { status: { in: ["DEPARTED", "DELIVERED"] } } },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
    AND: [{ status: { in: [OrderStatus.APPROVED, OrderStatus.PICKING] } }, ...(filters.orderStatus ? [{ status: filters.orderStatus as OrderStatus }] : [])],
  };
}

/** Orders APPROVED or PICKING with no dispatch that has actually departed yet. */
export async function listOrdersAwaitingFulfilment(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<OutstandingOrderRow>> {
  const where = buildAwaitingFulfilmentWhere(filters);
  const [totalItems, rows] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({ where, select: orderListRowSelect, orderBy: { approvedAt: "asc" }, skip: (pagination.page - 1) * pagination.pageSize, take: pagination.pageSize }),
  ]);
  return { rows: rows.map(toOutstandingOrderRow), pagination: { ...pagination, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) } };
}

export type OrderStatusBreakdownRow = { status: string; count: number };

/**
 * Management Analytics spec Part 2: a real distribution over the FULL
 * filtered dataset (every matching order, not just the current page) --
 * built from the exact same `where` the paginated list above uses, so the
 * breakdown and the list can never disagree about which rows are in
 * scope. avgDaysOutstanding is computed in JS from the same rows' own
 * receivedAt (there is no SQL-level NOW()-receivedAt aggregate available
 * through Prisma's groupBy), mirroring the same averaging approach
 * lib/reporting/sales-pipeline.ts's averageDaysBetween already uses.
 */
async function getOrderStatusBreakdown(where: Prisma.CustomerOrderWhereInput): Promise<{ byStatus: OrderStatusBreakdownRow[]; avgDaysOutstanding: number | null; sampleSize: number }> {
  const [grouped, receivedDates] = await Promise.all([
    prisma.customerOrder.groupBy({ by: ["status"], where, _count: { _all: true } }),
    prisma.customerOrder.findMany({ where, select: { receivedAt: true } }),
  ]);
  const withReceivedAt = receivedDates.filter((o: { receivedAt: Date | null }): o is { receivedAt: Date } => o.receivedAt !== null);
  const avgDaysOutstanding =
    withReceivedAt.length === 0
      ? null
      : Math.round((withReceivedAt.reduce((sum: number, o: { receivedAt: Date }) => sum + (Date.now() - o.receivedAt.getTime()), 0) / withReceivedAt.length / (1000 * 60 * 60 * 24)) * 10) / 10;
  return {
    byStatus: grouped
      .map((g: { status: string; _count: { _all: number } }) => ({ status: g.status, count: g._count._all }))
      .sort((a: { count: number }, b: { count: number }) => b.count - a.count),
    avgDaysOutstanding,
    sampleSize: withReceivedAt.length,
  };
}

export async function getOutstandingOrdersBreakdown(filters: ReportFilters) {
  return getOrderStatusBreakdown(buildOutstandingOrdersWhere(filters));
}

export async function getAwaitingFulfilmentBreakdown(filters: ReportFilters) {
  return getOrderStatusBreakdown(buildAwaitingFulfilmentWhere(filters));
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
  /**
   * Follow-up fix: "since now we have prices, the graphs should now have
   * prices too... the quantity should be associated with its price" --
   * priced at this specific order line's own OrderLine.approvedUnitPrice
   * (the actually-agreed price for THIS line, when one was ever set),
   * the same single real price lib/lost-sales/estimate-value.ts's
   * resolveEstimatedLostSaleValue already trusts as its first, most
   * historically-valid source. Deliberately never falls back to
   * customerUnitPrice (the customer's own, unverified PO figure) --
   * "never invent/assume a value" applies to an unverified price exactly
   * as much as to a missing one. null (never a fabricated 0) when this
   * line was never priced.
   */
  requestedValue: string | null;
  foundValue: string | null;
  unavailableValue: string | null;
  pickedAt: string | null;
};

// fulfilmentStatus applies here as a PickingSessionStatus value (this
// report's own entity) -- see applicableEnumFilter's comment above for why
// a value belonging to a different fulfilment-stage enum (DispatchStatus/
// DeliveryOutcome) is simply not applied rather than forced into a
// zero-row filter. Pulled out so the paginated list and its breakdown
// aggregate below share one definition of "in scope."
function buildPickingShortagesWhere(filters: ReportFilters): Prisma.PickingLineWhereInput {
  const range = dateRangeToTimestampFilter(filters);
  return {
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
}

export async function listPickingShortages(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<PickingShortageRow>> {
  const where = buildPickingShortagesWhere(filters);
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
        orderLine: {
          select: {
            originalProductDescription: true,
            approvedUnitPrice: true,
            product: { select: { itemName: true } },
            order: { select: { id: true, reference: true, customer: { select: { name: true } } } },
          },
        },
      },
      orderBy: { pickedAt: "desc" },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
    }),
  ]);
  return {
    rows: rows.map((line) => {
      const unitPrice = line.orderLine.approvedUnitPrice?.toString() ?? null;
      const valueOf = (quantity: { toString(): string } | null): string | null =>
        unitPrice && quantity ? multiplyDecimalStrings(unitPrice, quantity.toString()) : null;
      return {
        pickingLineId: line.id,
        orderId: line.orderLine.order.id,
        orderReference: line.orderLine.order.reference,
        customerName: line.orderLine.order.customer.name,
        productDescription: line.orderLine.product?.itemName ?? line.orderLine.originalProductDescription,
        requestedQuantity: line.requestedQuantity.toString(),
        requestedValue: valueOf(line.requestedQuantity),
        foundQuantity: line.foundQuantity?.toString() ?? null,
        foundValue: valueOf(line.foundQuantity),
        unavailableQuantity: line.unavailableQuantity?.toString() ?? null,
        unavailableValue: valueOf(line.unavailableQuantity),
        pickedAt: line.pickedAt?.toISOString() ?? null,
      };
    }),
    pagination: { ...pagination, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / pagination.pageSize)) },
  };
}

export type ProductShortageBreakdownRow = {
  productDescription: string;
  lineCount: number;
  totalUnavailableQuantity: string;
  /** Follow-up fix: sum of each contributing line's own unavailableQuantity x that line's OrderLine.approvedUnitPrice -- see PickingShortageRow.unavailableValue's own comment on why no other price is ever substituted. Excludes lines with no approved price (see linesWithoutPrice below) rather than fabricating a zero for them. */
  totalUnavailableValue: string;
  /** How many of this product's lineCount had no OrderLine.approvedUnitPrice and are therefore excluded from totalUnavailableValue above -- never silently dropped from view. */
  linesWithoutPrice: number;
};

/**
 * Management Analytics spec Part 2: top products by shortage quantity,
 * aggregated over the FULL filtered set of picking lines (not just the
 * current page), using the exact same `where` listPickingShortages
 * itself queries. Prisma's groupBy cannot group by a nested relation
 * field (the product description lives on OrderLine, not PickingLine
 * itself), so this fetches the matching rows' own product identifiers
 * and sums in JS -- the same approach lib/reporting/sales-pipeline.ts's
 * quotationsIssuedValue already takes for summing decimal-string
 * quantities (sumDecimalStrings/formatScaledDecimal from
 * lib/fulfilment/decimal.ts), scoped to a reporting-sized filtered set,
 * never the whole table.
 */
export async function getPickingShortagesBreakdown(filters: ReportFilters): Promise<{ topProducts: ProductShortageBreakdownRow[]; totalLines: number }> {
  const where = buildPickingShortagesWhere(filters);
  const rows = await prisma.pickingLine.findMany({
    where,
    select: {
      unavailableQuantity: true,
      orderLine: { select: { originalProductDescription: true, approvedUnitPrice: true, product: { select: { itemName: true } } } },
    },
  });
  const byProduct = new Map<string, { lineCount: number; quantities: string[]; values: string[]; linesWithoutPrice: number }>();
  for (const row of rows) {
    const label = row.orderLine.product?.itemName ?? row.orderLine.originalProductDescription;
    const existing = byProduct.get(label) ?? { lineCount: 0, quantities: [], values: [], linesWithoutPrice: 0 };
    existing.lineCount += 1;
    if (row.unavailableQuantity) {
      existing.quantities.push(row.unavailableQuantity.toString());
      const unitPrice = row.orderLine.approvedUnitPrice?.toString() ?? null;
      const value = unitPrice ? multiplyDecimalStrings(unitPrice, row.unavailableQuantity.toString()) : null;
      if (value !== null) {
        existing.values.push(value);
      } else {
        existing.linesWithoutPrice += 1;
      }
    }
    byProduct.set(label, existing);
  }
  const topProducts = [...byProduct.entries()]
    .map(([productDescription, v]) => ({
      productDescription,
      lineCount: v.lineCount,
      totalUnavailableQuantity: formatScaledDecimal(sumDecimalStrings(v.quantities)),
      totalUnavailableValue: formatScaledDecimal(sumDecimalStrings(v.values)),
      linesWithoutPrice: v.linesWithoutPrice,
    }))
    .sort((a, b) => Number.parseFloat(b.totalUnavailableQuantity) - Number.parseFloat(a.totalUnavailableQuantity))
    .slice(0, 10);
  return { topProducts, totalLines: rows.length };
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

// Same AND-array pattern as buildOutstandingOrdersWhere/
// buildAwaitingFulfilmentWhere above: narrows WITHIN "is an exception"
// rather than replacing that definition. fulfilmentStatus applies here as
// a DeliveryOutcome value (this report's own entity); ACCEPTED_IN_FULL is
// a valid DeliveryOutcome but not an exception, so passing it here
// correctly yields zero rows via the AND rather than needing special-case
// rejection. Pulled out so the list and its by-outcome breakdown share one
// definition of "in scope."
function buildDeliveryExceptionsWhere(filters: ReportFilters): Prisma.DeliveryRecordWhereInput {
  const range = dateRangeToTimestampFilter(filters);
  return {
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
}

export async function listDeliveryExceptions(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<DeliveryExceptionRow>> {
  const where = buildDeliveryExceptionsWhere(filters);
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

export type DeliveryOutcomeBreakdownRow = { outcome: string; count: number };

/** Management Analytics spec Part 2: real counts by outcome over the full filtered set, same `where` as listDeliveryExceptions. */
export async function getDeliveryExceptionsBreakdown(filters: ReportFilters): Promise<{ byOutcome: DeliveryOutcomeBreakdownRow[] }> {
  const where = buildDeliveryExceptionsWhere(filters);
  const grouped = await prisma.deliveryRecord.groupBy({ by: ["outcome"], where, _count: { _all: true } });
  return {
    byOutcome: grouped
      .map((g: { outcome: string; _count: { _all: number } }) => ({ outcome: g.outcome, count: g._count._all }))
      .sort((a: { count: number }, b: { count: number }) => b.count - a.count),
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
    { key: "requestedValue", header: "Requested value" },
    { key: "foundQuantity", header: "Found quantity" },
    { key: "foundValue", header: "Found value" },
    { key: "unavailableQuantity", header: "Unavailable quantity" },
    { key: "unavailableValue", header: "Unavailable value" },
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
  | { kind: "list"; data: PaginatedResult<unknown>; breakdown: unknown };

/**
 * One switch, used by both the view route and the export route, so
 * neither can drift from "which report id maps to which function" --
 * see this file's own top comment on why operational-summary is a
 * single parameterized function rather than three.
 *
 * Management Analytics spec Part 2: every LIST-kind report now also
 * carries a `breakdown` -- a real categorical distribution (or, for
 * picking-shortages, a ranked top-10) computed over the FULL filtered
 * set via the exact same `where` clause the paginated rows themselves
 * use (see each buildXxxWhere helper above), never just the current
 * page. `breakdown` is `null` for a SUMMARY-kind report, which already
 * presents its own full set of distributions.
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
    case "outstanding-orders": {
      const [data, breakdown] = await Promise.all([listOutstandingOrders(filters, pagination), getOutstandingOrdersBreakdown(filters)]);
      return { kind: "list", data, breakdown };
    }
    case "awaiting-fulfilment": {
      const [data, breakdown] = await Promise.all([listOrdersAwaitingFulfilment(filters, pagination), getAwaitingFulfilmentBreakdown(filters)]);
      return { kind: "list", data, breakdown };
    }
    case "picking-shortages": {
      const [data, breakdown] = await Promise.all([listPickingShortages(filters, pagination), getPickingShortagesBreakdown(filters)]);
      return { kind: "list", data, breakdown };
    }
    case "delivery-exceptions": {
      const [data, breakdown] = await Promise.all([listDeliveryExceptions(filters, pagination), getDeliveryExceptionsBreakdown(filters)]);
      return { kind: "list", data, breakdown };
    }
    case "communication-failures": {
      const [data, breakdown] = await Promise.all([listCommunicationFailures(filters, pagination), getCommunicationFailuresBreakdown(filters)]);
      return { kind: "list", data, breakdown };
    }
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
function buildCommunicationFailuresWhere(filters: ReportFilters): Prisma.OutboundMessageWhereInput {
  const range = dateRangeToTimestampFilter(filters);
  return {
    ...demoWhere(filters),
    status: "FAILED",
    createdAt: range,
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
  };
}

export async function listCommunicationFailures(filters: ReportFilters, pagination: PaginationParams): Promise<PaginatedResult<CommunicationFailureRow>> {
  const where = buildCommunicationFailuresWhere(filters);
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

export type CommunicationFailureBreakdownRow = { key: string; count: number };

/** Management Analytics spec Part 2: failure counts by channel and by message type over the full filtered set, same `where` as listCommunicationFailures. */
export async function getCommunicationFailuresBreakdown(filters: ReportFilters): Promise<{ byChannel: CommunicationFailureBreakdownRow[]; byType: CommunicationFailureBreakdownRow[] }> {
  const where = buildCommunicationFailuresWhere(filters);
  const [byChannel, byType] = await Promise.all([
    prisma.outboundMessage.groupBy({ by: ["channel"], where, _count: { _all: true } }),
    prisma.outboundMessage.groupBy({ by: ["type"], where, _count: { _all: true } }),
  ]);
  return {
    byChannel: byChannel
      .map((g: { channel: string; _count: { _all: number } }) => ({ key: g.channel, count: g._count._all }))
      .sort((a: { count: number }, b: { count: number }) => b.count - a.count),
    byType: byType
      .map((g: { type: string; _count: { _all: number } }) => ({ key: g.type, count: g._count._all }))
      .sort((a: { count: number }, b: { count: number }) => b.count - a.count),
  };
}
