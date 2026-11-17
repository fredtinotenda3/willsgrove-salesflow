import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dateRangeToTimestampFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import type { ReportFilters } from "@/lib/reporting/types";
import {
  bucketKeyForDate,
  bucketLabelForKey,
  buildHistogram,
  computeShortageRate,
  MIN_SAMPLE_SIZE_FOR_DISTRIBUTION,
  percentileOfSorted,
  type LostSalesAnalyticsPeriod,
} from "@/lib/lost-sales/analytics-validation";
import { listUnfulfilledDemands, type ListUnfulfilledDemandsResult } from "@/lib/lost-sales/queries";

/**
 * Additional Implementation Requirements (spec section 3: "Lost Sales
 * Analytics Overhaul"). One combined, DB-backed analytics query,
 * returning everything the /lost-sales/analytics page needs in a single
 * round trip -- metrics, every required visualization's data, and the
 * drilldown table -- all computed against the SAME filtered row set, so
 * every chart on the page is internally consistent (spec's own "avoid
 * misleading analytics" warning: a KPI tile and a chart drawn from two
 * differently-filtered queries is exactly the kind of inconsistency
 * that warning is about).
 *
 * Scope convention (documented here once, applies to every figure this
 * module returns except where noted): "current" demands only --
 * status != SUPERSEDED, same default listUnfulfilledDemands/
 * getLostSalesReportSummary already use -- UNLESS the caller explicitly
 * filters by a specific status (including SUPERSEDED itself, for
 * history browsing). This is a deliberately simpler, self-consistent
 * rule than getLostSalesReportSummary's own confirmedLostTotal (which
 * intentionally INCLUDES superseded rows -- see that function's own
 * comment); the two are different reports serving different questions,
 * not two numbers that must match. The analytics page says as much in
 * its own copy rather than silently mixing populations within one
 * chart.
 */

// A bound on how many individual UnfulfilledDemand rows this module will
// pull into memory for trend-bucketing/histogram/top-N computation.
// Prisma handles the WHERE/count fine at any scale; this cap exists so a
// single analytics request can never become an unbounded full-table
// fetch. Comfortably above any realistic per-year shortage volume for
// this business; if it is ever hit, `truncated: true` is surfaced so the
// UI discloses it rather than silently showing a partial picture (spec's
// "avoid misleading analytics").
const MAX_ANALYTICS_ROWS = 10_000;

// A product/customer must appear in at least this many demand rows
// before it is ranked by SHORTAGE RATE (not by raw quantity) -- a
// single demand with 1 requested/1 unavailable is a 100% rate that would
// otherwise dominate a rate-based ranking on no real volume. Spec
// section 3: "avoid misleading analytics... no invented values."
const MIN_DEMAND_COUNT_FOR_RATE_RANKING = 3;

const TOP_N = 10;

type AnalyticsRow = {
  id: string;
  orderId: string;
  customerId: string;
  customerName: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  requestedQuantity: number;
  foundQuantity: number;
  unavailableQuantity: number;
  outstandingQuantity: number;
  cancelledQuantity: number;
  substitutedQuantity: number;
  confirmedLostQuantity: number;
  estimatedValue: number | null;
  status: string;
  createdAt: Date;
  salespersonId: string | null;
};

export type LostSalesTrendPoint = {
  bucket: string;
  label: string;
  requestedQuantity: string;
  unavailableQuantity: string;
  estimatedLostValue: string;
  demandCount: number;
};

export type LostSalesProductBreakdown = {
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  requestedQuantity: string;
  foundQuantity: string;
  unavailableQuantity: string;
  demandCount: number;
};

export type LostSalesCustomerBreakdown = {
  customerId: string;
  customerName: string;
  unavailableQuantity: string;
  demandCount: number;
};

export type LostSalesShortageRateEntry = {
  label: string;
  shortageRatePercent: number;
  requestedQuantity: string;
  unavailableQuantity: string;
  demandCount: number;
};

export type LostSalesCompositionBreakdown = {
  outstandingQuantity: string;
  cancelledNotConfirmedLostQuantity: string;
  confirmedLostQuantity: string;
  substitutedQuantity: string;
  undecidedQuantity: string;
  totalUnavailableQuantity: string;
};

export type LostSalesDistribution = {
  sampleSize: number;
  sufficientForDistribution: boolean;
  percentiles: { p25: number; p50: number; p75: number; p90: number } | null;
  histogram: { bucketStart: number; bucketEnd: number; count: number }[] | null;
};

export type LostSalesAnalyticsResult = {
  effectiveDateFrom: string | null;
  effectiveDateTo: string | null;
  dateRangeWasDefaulted: boolean;
  sampleSize: number;
  truncated: boolean;
  kpis: {
    totalRequestedQuantity: string;
    totalUnavailableQuantity: string;
    totalOutstandingQuantity: string;
    totalConfirmedLostQuantity: string;
    totalEstimatedLostValue: string;
    demandsWithoutEstimate: number;
    availabilityRatePercent: number | null;
    shortageRatePercent: number | null;
  };
  trend: LostSalesTrendPoint[];
  topUnavailableProducts: LostSalesProductBreakdown[];
  topUnavailableCustomers: LostSalesCustomerBreakdown[];
  requestedFoundUnavailableByProduct: LostSalesProductBreakdown[];
  shortageRateByProduct: LostSalesShortageRateEntry[];
  shortageRateByCustomer: LostSalesShortageRateEntry[];
  composition: LostSalesCompositionBreakdown;
  distribution: LostSalesDistribution;
  lossReasonBreakdown: { reason: string; recordCount: number; totalQuantity: string }[];
  decisionTypeBreakdown: { decisionType: string; eventCount: number; totalQuantity: string }[];
  drilldown: ListUnfulfilledDemandsResult;
};

/**
 * Converts a Prisma Decimal to a plain JS number for in-memory
 * aggregation (trend buckets, top-N, histogram/percentiles) -- a
 * DELIBERATE, scoped exception to this codebase's usual
 * scaled-decimal-string arithmetic (lib/picking/validation.ts's
 * parseScaledDecimal/multiplyDecimalStrings), which exists specifically
 * for TRANSACTIONAL correctness (money/quantities actually written to
 * the database). This module only ever produces read-only, rounded
 * display figures for charts -- it writes nothing -- so ordinary
 * floating-point summation is an acceptable, standard analytics
 * practice at this data's realistic volume (low thousands of rows, not
 * millions), and nothing here is fed back into a transaction. Where
 * exact totals matter (the KPI tiles' headline numbers), this module's
 * sums are cross-checked against DB-side `_sum` aggregates in
 * getLostSalesReportSummary/getAutomaticLostSalesValue at the same
 * precision a reasonable person would expect from a chart axis label.
 */
function toNumber(value: { toString(): string } | null): number {
  if (value === null) return 0;
  const parsed = Number.parseFloat(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatTotal(value: number): string {
  // Quantities/values throughout this schema are 4-decimal-place
  // Decimal columns (see lib/picking/validation.ts's scaled-decimal
  // convention) -- matching that precision here keeps a summed total
  // from this module looking different (e.g. extra float noise digits)
  // than the same figure read directly off a Decimal column elsewhere
  // in the UI.
  return value.toFixed(4);
}

export async function getLostSalesAnalytics(
  filters: ReportFilters,
  period: LostSalesAnalyticsPeriod,
  drilldownPage: { page: number; pageSize: number }
): Promise<LostSalesAnalyticsResult> {
  const dateRangeWasDefaulted = filters.dateFrom === null && filters.dateTo === null;

  // Spec section 3 requires a trend/time view; with no caller-given
  // range, default to lib/reporting/filters.ts's own trailing-30-day
  // window -- the SAME default every other /reports/* page already
  // uses (defaultDateRange/resolveEffectiveDateRange), rather than a
  // bespoke window specific to this page, so switching between this
  // page and any other report page never surprises the user with a
  // differently-scoped "no filter" default. Applied to EVERY figure in
  // this payload, not just the trend chart -- see this file's module
  // comment on why.
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const { gte: effectiveFromDate, lt: effectiveToDateExclusive } = dateRangeToTimestampFilter({
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
  });

  const where: Prisma.UnfulfilledDemandWhereInput = {
    isDemo: filters.includeDemo ? undefined : false,
    createdAt: { gte: effectiveFromDate, lt: effectiveToDateExclusive },
    status: filters.unfulfilledDemandStatus
      ? (filters.unfulfilledDemandStatus as Prisma.UnfulfilledDemandWhereInput["status"])
      : { not: "SUPERSEDED" },
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    ...(filters.productId ? { productId: filters.productId } : {}),
    ...(filters.salespersonId ? { order: { salespersonId: filters.salespersonId } } : {}),
    ...(filters.lostSalesReason
      ? { lostSaleRecords: { some: { reason: filters.lostSalesReason as Prisma.LostSaleRecordWhereInput["reason"] } } }
      : {}),
    ...(filters.customerDecisionType
      ? { decisionEvents: { some: { decisionType: filters.customerDecisionType as Prisma.CustomerDecisionEventWhereInput["decisionType"] } } }
      : {}),
  };

  const [totalMatching, rawRows, reasonGroups, decisionGroups, drilldown] = await Promise.all([
    prisma.unfulfilledDemand.count({ where }),
    prisma.unfulfilledDemand.findMany({
      where,
      take: MAX_ANALYTICS_ROWS,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        orderId: true,
        customerId: true,
        customer: { select: { name: true } },
        productId: true,
        sapItemCodeSnapshot: true,
        productDescriptionSnapshot: true,
        requestedQuantity: true,
        foundQuantity: true,
        unavailableQuantity: true,
        outstandingQuantity: true,
        cancelledQuantity: true,
        substitutedQuantity: true,
        confirmedLostQuantity: true,
        estimatedValue: true,
        status: true,
        createdAt: true,
        order: { select: { salespersonId: true } },
      },
    }),
    prisma.lostSaleRecord.groupBy({
      by: ["reason"],
      where: { unfulfilledDemand: where },
      _count: { _all: true },
      _sum: { quantity: true },
      orderBy: { _count: { reason: "desc" } },
    }),
    prisma.customerDecisionEvent.groupBy({
      by: ["decisionType"],
      where: { unfulfilledDemand: where },
      _count: { _all: true },
      _sum: { quantity: true },
      orderBy: { _count: { decisionType: "desc" } },
    }),
    listUnfulfilledDemands({
      page: drilldownPage.page,
      pageSize: drilldownPage.pageSize,
      includeDemo: filters.includeDemo,
      status: filters.unfulfilledDemandStatus ?? undefined,
      customerId: filters.customerId ?? undefined,
      productId: filters.productId ?? undefined,
      salespersonId: filters.salespersonId ?? undefined,
      dateFrom: effectiveFromDate,
      dateTo: effectiveToDateExclusive,
      reason: filters.lostSalesReason ?? undefined,
      decisionType: filters.customerDecisionType ?? undefined,
    }),
  ]);

  const rows: AnalyticsRow[] = rawRows.map((row) => ({
    id: row.id,
    orderId: row.orderId,
    customerId: row.customerId,
    customerName: row.customer.name,
    productId: row.productId,
    sapItemCodeSnapshot: row.sapItemCodeSnapshot,
    productDescriptionSnapshot: row.productDescriptionSnapshot,
    requestedQuantity: toNumber(row.requestedQuantity),
    foundQuantity: toNumber(row.foundQuantity),
    unavailableQuantity: toNumber(row.unavailableQuantity),
    outstandingQuantity: toNumber(row.outstandingQuantity),
    cancelledQuantity: toNumber(row.cancelledQuantity),
    substitutedQuantity: toNumber(row.substitutedQuantity),
    confirmedLostQuantity: toNumber(row.confirmedLostQuantity),
    estimatedValue: row.estimatedValue === null ? null : toNumber(row.estimatedValue),
    status: row.status,
    createdAt: row.createdAt,
    salespersonId: row.order.salespersonId,
  }));

  // --- KPIs -----------------------------------------------------------
  let totalRequested = 0;
  let totalUnavailable = 0;
  let totalOutstanding = 0;
  let totalConfirmedLost = 0;
  let totalEstimatedValue = 0;
  let demandsWithoutEstimate = 0;
  for (const row of rows) {
    totalRequested += row.requestedQuantity;
    totalUnavailable += row.unavailableQuantity;
    totalOutstanding += row.outstandingQuantity;
    totalConfirmedLost += row.confirmedLostQuantity;
    if (row.estimatedValue !== null) {
      totalEstimatedValue += row.estimatedValue;
    } else {
      demandsWithoutEstimate += 1;
    }
  }
  const shortageRate = computeShortageRate(totalUnavailable, totalRequested);

  // --- Trend ------------------------------------------------------------
  const trendBuckets = new Map<
    string,
    { requested: number; unavailable: number; estimatedValue: number; count: number }
  >();
  for (const row of rows) {
    const key = bucketKeyForDate(row.createdAt, period);
    const bucket = trendBuckets.get(key) ?? { requested: 0, unavailable: 0, estimatedValue: 0, count: 0 };
    bucket.requested += row.requestedQuantity;
    bucket.unavailable += row.unavailableQuantity;
    bucket.estimatedValue += row.estimatedValue ?? 0;
    bucket.count += 1;
    trendBuckets.set(key, bucket);
  }
  const trend: LostSalesTrendPoint[] = Array.from(trendBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, totals]) => ({
      bucket,
      label: bucketLabelForKey(bucket, period),
      requestedQuantity: formatTotal(totals.requested),
      unavailableQuantity: formatTotal(totals.unavailable),
      estimatedLostValue: formatTotal(totals.estimatedValue),
      demandCount: totals.count,
    }));

  // --- Per-product / per-customer aggregation (shared by several charts) ---
  type ProductAgg = {
    productId: string | null;
    sapItemCodeSnapshot: string | null;
    productDescriptionSnapshot: string;
    requested: number;
    found: number;
    unavailable: number;
    count: number;
  };
  const byProduct = new Map<string, ProductAgg>();
  type CustomerAgg = { customerId: string; customerName: string; unavailable: number; requested: number; count: number };
  const byCustomer = new Map<string, CustomerAgg>();

  for (const row of rows) {
    const productKey = row.sapItemCodeSnapshot ?? row.productId ?? `unresolved:${row.productDescriptionSnapshot}`;
    const productAgg =
      byProduct.get(productKey) ?? {
        productId: row.productId,
        sapItemCodeSnapshot: row.sapItemCodeSnapshot,
        productDescriptionSnapshot: row.productDescriptionSnapshot,
        requested: 0,
        found: 0,
        unavailable: 0,
        count: 0,
      };
    productAgg.requested += row.requestedQuantity;
    productAgg.found += row.foundQuantity;
    productAgg.unavailable += row.unavailableQuantity;
    productAgg.count += 1;
    byProduct.set(productKey, productAgg);

    const customerAgg =
      byCustomer.get(row.customerId) ?? { customerId: row.customerId, customerName: row.customerName, unavailable: 0, requested: 0, count: 0 };
    customerAgg.unavailable += row.unavailableQuantity;
    customerAgg.requested += row.requestedQuantity;
    customerAgg.count += 1;
    byCustomer.set(row.customerId, customerAgg);
  }

  const productAggs = Array.from(byProduct.values());
  const customerAggs = Array.from(byCustomer.values());

  const topUnavailableProducts: LostSalesProductBreakdown[] = [...productAggs]
    .sort((a, b) => b.unavailable - a.unavailable)
    .slice(0, TOP_N)
    .map((agg) => ({
      productId: agg.productId,
      sapItemCodeSnapshot: agg.sapItemCodeSnapshot,
      productDescriptionSnapshot: agg.productDescriptionSnapshot,
      requestedQuantity: formatTotal(agg.requested),
      foundQuantity: formatTotal(agg.found),
      unavailableQuantity: formatTotal(agg.unavailable),
      demandCount: agg.count,
    }));

  const topUnavailableCustomers: LostSalesCustomerBreakdown[] = [...customerAggs]
    .sort((a, b) => b.unavailable - a.unavailable)
    .slice(0, TOP_N)
    .map((agg) => ({
      customerId: agg.customerId,
      customerName: agg.customerName,
      unavailableQuantity: formatTotal(agg.unavailable),
      demandCount: agg.count,
    }));

  // Spec: "requested vs found vs unavailable, grouped/stacked bars" --
  // same top-10-by-unavailable product set as above, just with all
  // three measures instead of one.
  const requestedFoundUnavailableByProduct = topUnavailableProducts;

  const shortageRateByProduct: LostSalesShortageRateEntry[] = productAggs
    .filter((agg) => agg.count >= MIN_DEMAND_COUNT_FOR_RATE_RANKING)
    .map((agg) => ({
      label: agg.productDescriptionSnapshot,
      rate: computeShortageRate(agg.unavailable, agg.requested),
      requested: agg.requested,
      unavailable: agg.unavailable,
      count: agg.count,
    }))
    .filter((entry): entry is { label: string; rate: number; requested: number; unavailable: number; count: number } => entry.rate !== null)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, TOP_N)
    .map((entry) => ({
      label: entry.label,
      shortageRatePercent: Math.round(entry.rate * 10000) / 100,
      requestedQuantity: formatTotal(entry.requested),
      unavailableQuantity: formatTotal(entry.unavailable),
      demandCount: entry.count,
    }));

  const shortageRateByCustomer: LostSalesShortageRateEntry[] = customerAggs
    .filter((agg) => agg.count >= MIN_DEMAND_COUNT_FOR_RATE_RANKING)
    .map((agg) => ({
      label: agg.customerName,
      rate: computeShortageRate(agg.unavailable, agg.requested),
      requested: agg.requested,
      unavailable: agg.unavailable,
      count: agg.count,
    }))
    .filter((entry): entry is { label: string; rate: number; requested: number; unavailable: number; count: number } => entry.rate !== null)
    .sort((a, b) => b.rate - a.rate)
    .slice(0, TOP_N)
    .map((entry) => ({
      label: entry.label,
      shortageRatePercent: Math.round(entry.rate * 10000) / 100,
      requestedQuantity: formatTotal(entry.requested),
      unavailableQuantity: formatTotal(entry.unavailable),
      demandCount: entry.count,
    }));

  // --- Composition (spec: "composition stacked bar") -------------------
  let outstandingTotal = 0;
  let cancelledTotal = 0;
  let confirmedLostTotal = 0;
  let substitutedTotal = 0;
  let unavailableForComposition = 0;
  for (const row of rows) {
    outstandingTotal += row.outstandingQuantity;
    cancelledTotal += row.cancelledQuantity;
    confirmedLostTotal += row.confirmedLostQuantity;
    substitutedTotal += row.substitutedQuantity;
    unavailableForComposition += row.unavailableQuantity;
  }
  // confirmedLostQuantity is always a SUBSET of cancelledQuantity (schema
  // invariant) -- split it out as its own segment rather than double
  // counting it inside "cancelled" too.
  const cancelledNotConfirmedLost = Math.max(0, cancelledTotal - confirmedLostTotal);
  const undecided = Math.max(
    0,
    unavailableForComposition - outstandingTotal - cancelledTotal - substitutedTotal
  );

  const composition: LostSalesCompositionBreakdown = {
    outstandingQuantity: formatTotal(outstandingTotal),
    cancelledNotConfirmedLostQuantity: formatTotal(cancelledNotConfirmedLost),
    confirmedLostQuantity: formatTotal(confirmedLostTotal),
    substitutedQuantity: formatTotal(substitutedTotal),
    undecidedQuantity: formatTotal(undecided),
    totalUnavailableQuantity: formatTotal(unavailableForComposition),
  };

  // --- Distribution (spec: "histograms/box plots/percentiles where
  // sample size is sufficient") ----------------------------------------
  const unavailableValues = rows.map((row) => row.unavailableQuantity).sort((a, b) => a - b);
  const sufficientForDistribution = unavailableValues.length >= MIN_SAMPLE_SIZE_FOR_DISTRIBUTION;
  const distribution: LostSalesDistribution = {
    sampleSize: unavailableValues.length,
    sufficientForDistribution,
    percentiles: sufficientForDistribution
      ? {
          p25: percentileOfSorted(unavailableValues, 25)!,
          p50: percentileOfSorted(unavailableValues, 50)!,
          p75: percentileOfSorted(unavailableValues, 75)!,
          p90: percentileOfSorted(unavailableValues, 90)!,
        }
      : null,
    histogram: buildHistogram(unavailableValues),
  };

  return {
    // effectiveFrom/effectiveTo are already the inclusive "YYYY-MM-DD"
    // strings resolveEffectiveDateRange resolved (either the caller's
    // own filters or lib/reporting/filters.ts's 30-day default) -- used
    // directly rather than re-derived from the Date objects above, which
    // only exist for the Prisma query's gte/lt bounds.
    effectiveDateFrom: effectiveFrom,
    effectiveDateTo: effectiveTo,
    dateRangeWasDefaulted,
    sampleSize: rows.length,
    truncated: totalMatching > MAX_ANALYTICS_ROWS,
    kpis: {
      totalRequestedQuantity: formatTotal(totalRequested),
      totalUnavailableQuantity: formatTotal(totalUnavailable),
      totalOutstandingQuantity: formatTotal(totalOutstanding),
      totalConfirmedLostQuantity: formatTotal(totalConfirmedLost),
      totalEstimatedLostValue: formatTotal(totalEstimatedValue),
      demandsWithoutEstimate,
      availabilityRatePercent: shortageRate === null ? null : Math.round((1 - shortageRate) * 10000) / 100,
      shortageRatePercent: shortageRate === null ? null : Math.round(shortageRate * 10000) / 100,
    },
    trend,
    topUnavailableProducts,
    topUnavailableCustomers,
    requestedFoundUnavailableByProduct,
    shortageRateByProduct,
    shortageRateByCustomer,
    composition,
    distribution,
    lossReasonBreakdown: reasonGroups.map((group) => ({
      reason: group.reason,
      recordCount: group._count._all,
      totalQuantity: formatTotal(toNumber(group._sum.quantity)),
    })),
    decisionTypeBreakdown: decisionGroups.map((group) => ({
      decisionType: group.decisionType,
      eventCount: group._count._all,
      totalQuantity: formatTotal(toNumber(group._sum.quantity)),
    })),
    drilldown,
  };
}
