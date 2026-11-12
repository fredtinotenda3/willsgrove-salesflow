import "server-only";
import type { Prisma, LostSaleReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter, defaultDateRange } from "@/lib/reporting/filters";
import { getReportFilterOptions, type FilterOption } from "@/lib/reporting/filter-options";
import { classifyOrdersMatching } from "@/lib/reporting/attribution-queries";
import { ATTRIBUTION_BUCKETS, ATTRIBUTION_BUCKET_LABELS, type AttributionBucket } from "@/lib/reporting/attribution";
import { getSalesRevenueReport, type SalesRevenueReport } from "@/lib/reporting/sales-revenue-queries";
import { getCustomerActivityReport, type CustomerActivityReport } from "@/lib/reporting/customer-activity-queries";
import { sumMoneyRows } from "@/lib/reporting/sales-revenue";
import { getSalesPipelineReport } from "@/lib/reporting/sales-pipeline";

/**
 * Milestone 12 (Sales Performance Intelligence) -- Stage D. The composite
 * report that ties together everything else this milestone built: the
 * attribution-confidence breakdown (lib/reporting/attribution.ts via
 * attribution-queries.ts), the per-currency/per-salesperson "SAP invoice
 * line value" breakdown (lib/reporting/sales-revenue-queries.ts), the
 * whole-business new/repeat customer split (lib/reporting/
 * customer-activity-queries.ts), a new lost-sales-by-salesperson
 * breakdown (built directly in this file), and a per-salesperson
 * quotation->order conversion funnel that REUSES lib/reporting/
 * sales-pipeline.ts's own, already-tested conversion math -- never a
 * second copy of that cohort logic.
 *
 * This file imports @prisma/client (both directly, for the lost-sales
 * query, and transitively, through every module it composes), so -- like
 * every other lib/reporting/*.ts file except this milestone's own
 * attribution.ts/customer-activity.ts/sales-revenue.ts pure halves -- it
 * is only exercised by this project's RUN_DB_INTEGRATION_TESTS=1 suite,
 * never by an unconditional unit test.
 *
 * Access: management-only (lib/reporting/access.ts's
 * requireManagementReportAccess), per this milestone's spec-revision
 * decision -- enforced at the API route, not here.
 */

export type AttributionBucketCount = {
  bucket: AttributionBucket;
  label: string;
  count: number;
};

export type SalespersonLostSalesBreakdown = {
  salespersonId: string | null;
  salespersonName: string;
  confirmedCount: number;
  /** Sum of LostSaleRecord.quantity for this salesperson, as a decimal string -- never a float. */
  confirmedQuantity: string;
  /** Keyed by LostSaleReason; a reason absent from this map had zero confirmed lost-sale records for this salesperson in range. */
  byReason: Partial<Record<string, { count: number; quantity: string }>>;
};

export type LostSalesEstimatedValueByCurrency = {
  currency: string;
  /** Sum of LostSaleRecord.estimatedValue for rows whose matched order's currency equals this bucket -- excludes rows with no estimatedValue (never coerced to 0, same "never invent missing SAP fields" rule the schema comment on LostSaleRecord itself states). Estimated, not an authoritative SAP figure. */
  totalEstimatedValue: string;
  excludedCount: number;
};

export type SalespersonPipelineSummary = {
  salespersonId: string;
  salespersonName: string;
  quotationsIssued: number;
  quotationAcceptanceRatePercent: number | null;
  acceptedQuotationsInCohort: number;
  quotationToOrderConversionRatePercent: number | null;
  ordersReceived: number;
  ordersConfirmed: number;
  orderApprovalRatePercent: number | null;
};

export type SalesPerformanceReport = {
  dateFrom: string;
  dateTo: string;

  attribution: {
    totalOrders: number;
    byBucket: AttributionBucketCount[];
  };

  revenue: SalesRevenueReport;
  customerActivity: CustomerActivityReport;

  lostSales: {
    totalConfirmedCount: number;
    totalConfirmedQuantity: string;
    estimatedValueByCurrency: LostSalesEstimatedValueByCurrency[];
    bySalesperson: SalespersonLostSalesBreakdown[];
  };

  /**
   * One funnel per active salesperson (or just the one named by
   * filters.salespersonId, when set), each computed by calling
   * getSalesPipelineReport with that salesperson substituted into the
   * filter set -- i.e. the exact same cohort/rate math
   * lib/reporting/sales-pipeline.ts already uses for the whole-business
   * funnel, run once per salesperson rather than re-derived. Orders/
   * quotations with no assigned salesperson are NOT represented here
   * (sales-pipeline.ts has no "salespersonId IS NULL" filter mode) --
   * see them instead in the unfiltered /reports/pipeline funnel and in
   * this report's own `attribution.byBucket` UNASSIGNED count.
   */
  pipelineBySalesperson: SalespersonPipelineSummary[];

  salespeople: FilterOption[];
};

async function getAttributionBreakdown(filters: ReportFilters, effectiveFrom: string, effectiveTo: string) {
  const demo = demoWhere(filters);
  const range = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const customerFilter: Prisma.CustomerOrderWhereInput = filters.customerId ? { customerId: filters.customerId } : {};
  const salespersonFilter: Prisma.CustomerOrderWhereInput = filters.salespersonId ? { salespersonId: filters.salespersonId } : {};
  const productFilter: Prisma.CustomerOrderWhereInput = filters.productId ? { lines: { some: { productId: filters.productId } } } : {};

  const orderWhere: Prisma.CustomerOrderWhereInput = {
    ...demo,
    receivedAt: { not: null, ...range },
    ...customerFilter,
    ...salespersonFilter,
    ...productFilter,
  };

  const { orders, attributionByOrderId } = await classifyOrdersMatching(orderWhere);

  const counts = new Map<AttributionBucket, number>();
  for (const order of orders) {
    const bucket = attributionByOrderId.get(order.id) ?? "UNVERIFIED_NO_PROVENANCE";
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }

  return {
    totalOrders: orders.length,
    byBucket: ATTRIBUTION_BUCKETS.map((bucket) => ({ bucket, label: ATTRIBUTION_BUCKET_LABELS[bucket], count: counts.get(bucket) ?? 0 })),
  };
}

/**
 * Lost-sales-by-salesperson, built directly against LostSaleRecord ->
 * UnfulfilledDemand -> CustomerOrder (for salespersonId/currency) --
 * there is no existing M4 query shaped this way to reuse. Anchored on
 * LostSaleRecord.confirmedAt (when the lost sale itself was confirmed),
 * NOT UnfulfilledDemand.createdAt (which lib/reporting/sales-pipeline.ts
 * uses for its own, differently-scoped "lost sales confirmed in window"
 * figure) -- this report's own natural anchor is the confirmation event,
 * since that is what LostSaleReason/decisionSource/estimatedValue all
 * describe. lostSalesReason (LostSaleRecord.reason) is applied here, and
 * ONLY here -- see lib/reporting/types.ts's own comment on that field.
 */
async function getLostSalesBySalesperson(filters: ReportFilters, effectiveFrom: string, effectiveTo: string) {
  const demo = demoWhere(filters);
  const range = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const customerFilter: Prisma.UnfulfilledDemandWhereInput = filters.customerId ? { customerId: filters.customerId } : {};
  const productFilter: Prisma.UnfulfilledDemandWhereInput = filters.productId ? { productId: filters.productId } : {};

  const lostSaleWhere: Prisma.LostSaleRecordWhereInput = {
    confirmedAt: range,
    ...(filters.lostSalesReason ? { reason: filters.lostSalesReason as LostSaleReason } : {}),
    unfulfilledDemand: { ...demo, ...customerFilter, ...productFilter },
  };

  const records = await prisma.lostSaleRecord.findMany({
    where: lostSaleWhere,
    select: {
      quantity: true,
      reason: true,
      estimatedValue: true,
      unfulfilledDemand: { select: { orderId: true } },
    },
  });

  const orderIds = [...new Set(records.map((r) => r.unfulfilledDemand.orderId))];
  const orders = orderIds.length > 0 ? await prisma.customerOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, salespersonId: true, currency: true } }) : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));

  type Row = { salespersonId: string | null; quantity: string; reason: string; estimatedValue: string | null; currency: string };
  const rows: Row[] = records
    .map((r) => {
      const order = orderById.get(r.unfulfilledDemand.orderId);
      return {
        salespersonId: order?.salespersonId ?? null,
        quantity: r.quantity.toString(),
        reason: r.reason,
        estimatedValue: r.estimatedValue?.toString() ?? null,
        currency: order?.currency ?? "USD",
      };
    })
    .filter((row) => !filters.salespersonId || row.salespersonId === filters.salespersonId);

  const totalConfirmedCount = rows.length;
  const totalConfirmedQuantity = rows.length > 0 ? formatScaledDecimal(sumDecimalStrings(rows.map((r) => r.quantity))) : "0";

  // Estimated value, grouped by the matched order's currency -- never
  // summed across currency -- and filtered to `filters.currency` when
  // set, same as every other money figure in this milestone.
  const valueByCurrency = new Map<string, (string | null)[]>();
  for (const row of rows) {
    if (filters.currency && row.currency !== filters.currency) continue;
    const bucket = valueByCurrency.get(row.currency) ?? [];
    bucket.push(row.estimatedValue);
    valueByCurrency.set(row.currency, bucket);
  }
  const estimatedValueByCurrency: LostSalesEstimatedValueByCurrency[] = [...valueByCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, values]) => {
      const { total, excludedCount } = sumMoneyRows(values);
      return { currency, totalEstimatedValue: total, excludedCount };
    });

  const salespersonIds = [...new Set(rows.map((r) => r.salespersonId).filter((id): id is string => id !== null))];
  const salespeopleById =
    salespersonIds.length > 0
      ? new Map((await prisma.user.findMany({ where: { id: { in: salespersonIds } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]))
      : new Map<string, string>();

  type Accumulator = { count: number; quantities: string[]; byReason: Map<string, { count: number; quantities: string[] }> };
  const UNASSIGNED_KEY = "__unassigned__";
  const bySalespersonAcc = new Map<string, Accumulator>();
  for (const row of rows) {
    const key = row.salespersonId ?? UNASSIGNED_KEY;
    let acc = bySalespersonAcc.get(key);
    if (!acc) {
      acc = { count: 0, quantities: [], byReason: new Map() };
      bySalespersonAcc.set(key, acc);
    }
    acc.count += 1;
    acc.quantities.push(row.quantity);
    const reasonAcc = acc.byReason.get(row.reason) ?? { count: 0, quantities: [] };
    reasonAcc.count += 1;
    reasonAcc.quantities.push(row.quantity);
    acc.byReason.set(row.reason, reasonAcc);
  }

  const bySalesperson: SalespersonLostSalesBreakdown[] = [...bySalespersonAcc.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, acc]) => ({
      salespersonId: key === UNASSIGNED_KEY ? null : key,
      salespersonName: key === UNASSIGNED_KEY ? "Unassigned" : salespeopleById.get(key) ?? key,
      confirmedCount: acc.count,
      confirmedQuantity: formatScaledDecimal(sumDecimalStrings(acc.quantities)),
      byReason: Object.fromEntries(
        [...acc.byReason.entries()].map(([reason, r]) => [reason, { count: r.count, quantity: formatScaledDecimal(sumDecimalStrings(r.quantities)) }])
      ),
    }));

  return { totalConfirmedCount, totalConfirmedQuantity, estimatedValueByCurrency, bySalesperson };
}

async function getPipelineBySalesperson(filters: ReportFilters, salespeople: FilterOption[]): Promise<SalespersonPipelineSummary[]> {
  const targets = filters.salespersonId ? salespeople.filter((s) => s.id === filters.salespersonId) : salespeople;

  const summaries = await Promise.all(
    targets.map(async (sp) => {
      const report = await getSalesPipelineReport({ ...filters, salespersonId: sp.id });
      return {
        salespersonId: sp.id,
        salespersonName: sp.name,
        quotationsIssued: report.funnel.quotationsIssued,
        quotationAcceptanceRatePercent: report.funnel.quotationAcceptanceRatePercent,
        acceptedQuotationsInCohort: report.funnel.acceptedQuotationsInCohort,
        quotationToOrderConversionRatePercent: report.funnel.quotationToOrderConversionRatePercent,
        ordersReceived: report.funnel.ordersReceived,
        ordersConfirmed: report.funnel.ordersConfirmed,
        orderApprovalRatePercent: report.funnel.orderApprovalRatePercent,
      } satisfies SalespersonPipelineSummary;
    })
  );

  // Sort busiest-first (most quotations issued) so the report leads with
  // whoever actually has volume in this window, rather than alphabetically.
  return summaries.sort((a, b) => b.quotationsIssued - a.quotationsIssued || a.salespersonName.localeCompare(b.salespersonName));
}

export async function getSalesPerformanceReport(filters: ReportFilters): Promise<SalesPerformanceReport> {
  const { dateFrom, dateTo } = defaultDateRange();
  const effectiveFrom = filters.dateFrom ?? dateFrom;
  const effectiveTo = filters.dateTo ?? dateTo;

  const [attribution, revenue, customerActivity, lostSales, filterOptions] = await Promise.all([
    getAttributionBreakdown(filters, effectiveFrom, effectiveTo),
    getSalesRevenueReport(filters),
    getCustomerActivityReport(filters),
    getLostSalesBySalesperson(filters, effectiveFrom, effectiveTo),
    getReportFilterOptions(),
  ]);

  const pipelineBySalesperson = await getPipelineBySalesperson(filters, filterOptions.salespeople);

  return {
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    attribution,
    revenue,
    customerActivity,
    lostSales,
    pipelineBySalesperson,
    salespeople: filterOptions.salespeople,
  };
}

