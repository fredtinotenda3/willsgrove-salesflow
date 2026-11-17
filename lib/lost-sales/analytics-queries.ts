import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dateRangeToTimestampFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import type { ReportFilters } from "@/lib/reporting/types";
import {
  bucketDateRange,
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
 *
 * Chart intelligence enhancement (deep chart drill-down, product-level
 * breakdown, rich tooltips): every aggregate figure this module already
 * computed is now ALSO broken down by contributing product (and, for the
 * trend, by date bucket too), with distinct affected-order/customer
 * counts and an explicit estimated-vs-confirmed value split, still from
 * this same single filtered row set and still without any extra query
 * per product/bucket (see the one additional `product`/`lostSaleRecords`
 * join added to the existing findMany below -- not a new query). Two
 * deliberate, documented scope decisions carried through this
 * enhancement:
 *   1. UnfulfilledDemand.estimatedValue/LostSaleRecord.estimatedValue
 *      carry NO currency code in this schema (a known, pre-existing
 *      limitation from Milestone 4 -- see lib/reporting/
 *      financial-exposure.ts's own module comment: "Source B... never
 *      records a currency"). This module does not invent one; every
 *      money figure it returns stays an un-prefixed plain amount, same
 *      as every other Source B figure in this codebase, and the UI this
 *      enhancement builds says so explicitly rather than silently
 *      implying a single currency.
 *   2. "Recovered value" / "subsequently fulfilled value" (in dollar
 *      terms) is NOT computed anywhere in this codebase and is not
 *      invented here -- UnfulfilledDemandStatus.RESOLVED and
 *      substitutedQuantity are the real, already-tracked QUANTITY-level
 *      signals for "this shortage stopped being a loss," and the UI
 *      surfaces those honestly rather than pro-rating a dollar figure
 *      nothing here actually tracks.
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

// Chart intelligence enhancement (deep chart drill-down, product-level
// breakdown, rich tooltips). How many individual products a trend
// point's own tooltip shows before collapsing the rest into an
// "+N more products" summary row -- keeps a date with many contributing
// products from producing an unreadably long tooltip (spec's own "do not
// overwhelm the chart itself... use rich tooltips and drill-down panels"
// instruction), while the drilldown table/full breakdown charts below
// remain the place to see every product with no cap.
const MAX_PRODUCTS_PER_BUCKET_TOOLTIP = 8;

type AnalyticsRow = {
  id: string;
  orderId: string;
  customerId: string;
  customerName: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  // Chart intelligence enhancement: Product.unitOfMeasure, snapshotted
  // via the live product relation (this demand itself stores no UOM of
  // its own -- see this type's own join below). Null when productId is
  // null (an unresolved product -- the same "never invent a value" rule
  // as everywhere else in this module: an unknown unit is shown as
  // unknown, never defaulted to a guessed one).
  unitOfMeasure: string | null;
  requestedQuantity: number;
  foundQuantity: number;
  unavailableQuantity: number;
  outstandingQuantity: number;
  cancelledQuantity: number;
  substitutedQuantity: number;
  confirmedLostQuantity: number;
  estimatedUnitPrice: number | null;
  estimatedValue: number | null;
  // Chart intelligence enhancement: this row's own confirmed-lost value,
  // from LostSaleRecord.estimatedValue (Source B's manually-confirmed
  // figure -- see lib/lost-sales/queries.ts's getSupplyShortageLostSalesValue
  // module comment for the full Estimated-vs-Confirmed distinction this
  // module preserves throughout). A demand can have at most one
  // LostSaleRecord in practice (one confirmation event), but this sums
  // defensively over all of them rather than assuming exactly one.
  confirmedLostValue: number;
  status: string;
  createdAt: Date;
  salespersonId: string | null;
};

export type LostSalesTrendPoint = {
  bucket: string;
  label: string;
  /** Chart intelligence enhancement: this bucket's own inclusive dateFrom/dateTo (lib/reporting/types.ts's ReportFilters shape) -- for a drill-down link into this same page/-/lost-sales scoped to exactly this point, nothing invented. */
  dateFrom: string;
  dateTo: string;
  requestedQuantity: string;
  foundQuantity: string;
  unavailableQuantity: string;
  estimatedLostValue: string;
  /** Chart intelligence enhancement: Source B's confirmed (not merely estimated) value for demands created in this bucket -- see AnalyticsRow.confirmedLostValue. Never summed into estimatedLostValue above; always shown as its own, separately-labeled figure. */
  confirmedLostValue: string;
  demandCount: number;
  /** Chart intelligence enhancement: distinct CustomerOrder/Customer ids contributing to this bucket -- "how many orders/customers were affected," not re-derivable from demandCount alone (one order can have several affected lines). */
  affectedOrderCount: number;
  affectedCustomerCount: number;
  availabilityRatePercent: number | null;
  shortageRatePercent: number | null;
  /** Chart intelligence enhancement: set only when every contributing row shares one Product.unitOfMeasure; null when two or more differ (or none is known) -- see this file's "do not combine incompatible UOMs" discipline below. */
  quantityUnitCode: string | null;
  mixedUnitsOfMeasure: boolean;
  /** Top products contributing to this bucket by unavailable quantity, capped at MAX_PRODUCTS_PER_BUCKET_TOOLTIP -- see otherProductsCount/otherProductsUnavailableQuantity for what the cap leaves out. */
  products: LostSalesProductBreakdown[];
  otherProductsCount: number;
  otherProductsUnavailableQuantity: string;
};

export type LostSalesProductBreakdown = {
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  /** Chart intelligence enhancement: Product.unitOfMeasure for this product (null when unresolved) -- so a quantity is never shown without the unit it's actually counted in. */
  unitOfMeasure: string | null;
  requestedQuantity: string;
  foundQuantity: string;
  unavailableQuantity: string;
  /** Chart intelligence enhancement: this product's own shortage rate within the scope this breakdown was computed over -- null for the same reason computeShortageRate returns null (zero requested), never gated by MIN_DEMAND_COUNT_FOR_RATE_RANKING here (that gate only applies to the dedicated shortageRateByProduct RANKING below, not to a per-product breakdown row that always shows its own real number). */
  shortageRatePercent: number | null;
  /** Chart intelligence enhancement: Source B automatic estimate, this product's share. */
  estimatedValue: string;
  /** Chart intelligence enhancement: Source B's actually-confirmed value, this product's share -- see LostSalesTrendPoint.confirmedLostValue's own comment on the distinction this never blurs. */
  confirmedLostValue: string;
  /** Chart intelligence enhancement: distinct orders/customers this product's contribution touches, within whatever scope (whole report or one bucket) this breakdown was computed over. */
  affectedOrderCount: number;
  affectedCustomerCount: number;
  demandCount: number;
};

export type LostSalesCustomerBreakdown = {
  customerId: string;
  customerName: string;
  unavailableQuantity: string;
  /** Chart intelligence enhancement. */
  requestedQuantity: string;
  foundQuantity: string;
  estimatedValue: string;
  confirmedLostValue: string;
  affectedOrderCount: number;
  shortageRatePercent: number | null;
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
    totalFoundQuantity: string;
    totalUnavailableQuantity: string;
    totalOutstandingQuantity: string;
    totalConfirmedLostQuantity: string;
    totalEstimatedLostValue: string;
    /** Chart intelligence enhancement: Source B's actually-confirmed value (LostSaleRecord.estimatedValue) across the whole filtered scope -- see LostSalesTrendPoint.confirmedLostValue's own comment. Never added to totalEstimatedLostValue. */
    totalConfirmedLostValue: string;
    demandsWithoutEstimate: number;
    /** Chart intelligence enhancement: distinct orders/customers across the whole filtered scope. */
    affectedOrderCount: number;
    affectedCustomerCount: number;
    /** Chart intelligence enhancement: see LostSalesTrendPoint.quantityUnitCode/mixedUnitsOfMeasure's own comment -- same rule, applied over the whole filtered scope rather than one bucket. */
    quantityUnitCode: string | null;
    mixedUnitsOfMeasure: boolean;
    availabilityRatePercent: number | null;
    shortageRatePercent: number | null;
  };
  trend: LostSalesTrendPoint[];
  topUnavailableProducts: LostSalesProductBreakdown[];
  topUnavailableCustomers: LostSalesCustomerBreakdown[];
  requestedFoundUnavailableByProduct: LostSalesProductBreakdown[];
  /**
   * Chart intelligence enhancement: these two now carry the SAME rich
   * LostSalesProductBreakdown/LostSalesCustomerBreakdown shape every other
   * product/customer chart on this page uses (value split, affected
   * orders/customers, demandCount) rather than a narrower rate-only row --
   * so the shortage-rate ranking charts can use the identical rich tooltip
   * as every other chart, with no separate type and no duplicated
   * aggregation logic (see rankByShortageRate below).
   */
  shortageRateByProduct: LostSalesProductBreakdown[];
  shortageRateByCustomer: LostSalesCustomerBreakdown[];
  composition: LostSalesCompositionBreakdown;
  distribution: LostSalesDistribution;
  lossReasonBreakdown: { reason: string; recordCount: number; totalQuantity: string; totalConfirmedValue: string }[];
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
        // Chart intelligence enhancement: unitOfMeasure joined from the
        // live Product row (null when productId is null, or when the
        // product has none recorded) -- this is the ONE extra join this
        // enhancement adds to this already-single findMany, not a
        // separate per-product query (no N+1: still one round trip
        // regardless of how many distinct products are in scope).
        product: { select: { unitOfMeasure: true } },
        sapItemCodeSnapshot: true,
        productDescriptionSnapshot: true,
        requestedQuantity: true,
        foundQuantity: true,
        unavailableQuantity: true,
        outstandingQuantity: true,
        cancelledQuantity: true,
        substitutedQuantity: true,
        confirmedLostQuantity: true,
        estimatedUnitPrice: true,
        estimatedValue: true,
        status: true,
        createdAt: true,
        order: { select: { salespersonId: true } },
        // Chart intelligence enhancement: Source B's CONFIRMED value, if
        // this demand has ever had a loss confirmed against it -- joined
        // here (still one query) rather than a second groupBy/aggregate
        // call, so every per-bucket/per-product figure below can
        // distinguish "estimated" from "confirmed" without re-querying.
        lostSaleRecords: { select: { estimatedValue: true } },
      },
    }),
    prisma.lostSaleRecord.groupBy({
      by: ["reason"],
      where: { unfulfilledDemand: where },
      _count: { _all: true },
      // Chart intelligence enhancement: _sum.estimatedValue added so the
      // "by loss reason" breakdown can show the confirmed value behind
      // each reason, not only its quantity -- same groupBy call, no
      // extra query.
      _sum: { quantity: true, estimatedValue: true },
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
    unitOfMeasure: row.product?.unitOfMeasure ?? null,
    sapItemCodeSnapshot: row.sapItemCodeSnapshot,
    productDescriptionSnapshot: row.productDescriptionSnapshot,
    requestedQuantity: toNumber(row.requestedQuantity),
    foundQuantity: toNumber(row.foundQuantity),
    unavailableQuantity: toNumber(row.unavailableQuantity),
    outstandingQuantity: toNumber(row.outstandingQuantity),
    cancelledQuantity: toNumber(row.cancelledQuantity),
    substitutedQuantity: toNumber(row.substitutedQuantity),
    confirmedLostQuantity: toNumber(row.confirmedLostQuantity),
    estimatedUnitPrice: row.estimatedUnitPrice === null ? null : toNumber(row.estimatedUnitPrice),
    estimatedValue: row.estimatedValue === null ? null : toNumber(row.estimatedValue),
    confirmedLostValue: row.lostSaleRecords.reduce(
      (sum: number, record: { estimatedValue: { toString(): string } | null }) => sum + toNumber(record.estimatedValue),
      0
    ),
    status: row.status,
    createdAt: row.createdAt,
    salespersonId: row.order.salespersonId,
  }));

  // --- KPIs -----------------------------------------------------------
  let totalRequested = 0;
  let totalFound = 0;
  let totalUnavailable = 0;
  let totalOutstanding = 0;
  let totalConfirmedLost = 0;
  let totalEstimatedValue = 0;
  let totalConfirmedLostValue = 0;
  let demandsWithoutEstimate = 0;
  const allOrderIds = new Set<string>();
  const allCustomerIds = new Set<string>();
  // Chart intelligence enhancement: "do not mix incompatible units of
  // measurement" (spec section 9) -- tracked across the WHOLE filtered
  // scope the same way as per-bucket below. unitOfMeasureSeen stays a
  // Set (not just a boolean) so distinct units are actually counted,
  // not merely detected.
  const allUnitsOfMeasure = new Set<string>();
  for (const row of rows) {
    totalRequested += row.requestedQuantity;
    totalFound += row.foundQuantity;
    totalUnavailable += row.unavailableQuantity;
    totalOutstanding += row.outstandingQuantity;
    totalConfirmedLost += row.confirmedLostQuantity;
    totalConfirmedLostValue += row.confirmedLostValue;
    if (row.estimatedValue !== null) {
      totalEstimatedValue += row.estimatedValue;
    } else {
      demandsWithoutEstimate += 1;
    }
    allOrderIds.add(row.orderId);
    allCustomerIds.add(row.customerId);
    if (row.unitOfMeasure) allUnitsOfMeasure.add(row.unitOfMeasure);
  }
  const shortageRate = computeShortageRate(totalUnavailable, totalRequested);
  const mixedUnitsOfMeasure = allUnitsOfMeasure.size > 1;
  const quantityUnitCode = allUnitsOfMeasure.size === 1 ? Array.from(allUnitsOfMeasure)[0] : null;

  // --- Trend ------------------------------------------------------------
  // Chart intelligence enhancement: a reusable per-product aggregate
  // shape, built fresh for each trend bucket below AND for the
  // whole-scope top-products/requested-found-unavailable breakdowns
  // further down -- one shared helper (toProductBreakdown) turns either
  // kind of Map into the same LostSalesProductBreakdown[] the UI
  // consumes, so the two call sites can never drift into computing a
  // product's shortage rate or confirmed value two different ways.
  type ProductAgg = {
    productId: string | null;
    sapItemCodeSnapshot: string | null;
    productDescriptionSnapshot: string;
    unitOfMeasure: string | null;
    requested: number;
    found: number;
    unavailable: number;
    estimatedValue: number;
    confirmedLostValue: number;
    count: number;
    orderIds: Set<string>;
    customerIds: Set<string>;
  };
  function newProductAgg(row: AnalyticsRow): ProductAgg {
    return {
      productId: row.productId,
      sapItemCodeSnapshot: row.sapItemCodeSnapshot,
      productDescriptionSnapshot: row.productDescriptionSnapshot,
      unitOfMeasure: row.unitOfMeasure,
      requested: 0,
      found: 0,
      unavailable: 0,
      estimatedValue: 0,
      confirmedLostValue: 0,
      count: 0,
      orderIds: new Set(),
      customerIds: new Set(),
    };
  }
  function addRowToProductAgg(agg: ProductAgg, row: AnalyticsRow): void {
    agg.requested += row.requestedQuantity;
    agg.found += row.foundQuantity;
    agg.unavailable += row.unavailableQuantity;
    agg.estimatedValue += row.estimatedValue ?? 0;
    agg.confirmedLostValue += row.confirmedLostValue;
    agg.count += 1;
    agg.orderIds.add(row.orderId);
    agg.customerIds.add(row.customerId);
  }
  function productKeyFor(row: AnalyticsRow): string {
    return row.sapItemCodeSnapshot ?? row.productId ?? `unresolved:${row.productDescriptionSnapshot}`;
  }
  function toProductBreakdown(agg: ProductAgg): LostSalesProductBreakdown {
    return {
      productId: agg.productId,
      sapItemCodeSnapshot: agg.sapItemCodeSnapshot,
      productDescriptionSnapshot: agg.productDescriptionSnapshot,
      unitOfMeasure: agg.unitOfMeasure,
      requestedQuantity: formatTotal(agg.requested),
      foundQuantity: formatTotal(agg.found),
      unavailableQuantity: formatTotal(agg.unavailable),
      shortageRatePercent: (() => {
        const rate = computeShortageRate(agg.unavailable, agg.requested);
        return rate === null ? null : Math.round(rate * 10000) / 100;
      })(),
      estimatedValue: formatTotal(agg.estimatedValue),
      confirmedLostValue: formatTotal(agg.confirmedLostValue),
      affectedOrderCount: agg.orderIds.size,
      affectedCustomerCount: agg.customerIds.size,
      demandCount: agg.count,
    };
  }

  const trendBuckets = new Map<
    string,
    {
      requested: number;
      found: number;
      unavailable: number;
      estimatedValue: number;
      confirmedLostValue: number;
      count: number;
      orderIds: Set<string>;
      customerIds: Set<string>;
      unitsOfMeasure: Set<string>;
      byProduct: Map<string, ProductAgg>;
    }
  >();
  for (const row of rows) {
    const key = bucketKeyForDate(row.createdAt, period);
    const bucket =
      trendBuckets.get(key) ??
      {
        requested: 0,
        found: 0,
        unavailable: 0,
        estimatedValue: 0,
        confirmedLostValue: 0,
        count: 0,
        orderIds: new Set<string>(),
        customerIds: new Set<string>(),
        unitsOfMeasure: new Set<string>(),
        byProduct: new Map<string, ProductAgg>(),
      };
    bucket.requested += row.requestedQuantity;
    bucket.found += row.foundQuantity;
    bucket.unavailable += row.unavailableQuantity;
    bucket.estimatedValue += row.estimatedValue ?? 0;
    bucket.confirmedLostValue += row.confirmedLostValue;
    bucket.count += 1;
    bucket.orderIds.add(row.orderId);
    bucket.customerIds.add(row.customerId);
    if (row.unitOfMeasure) bucket.unitsOfMeasure.add(row.unitOfMeasure);

    const productKey = productKeyFor(row);
    const productAgg = bucket.byProduct.get(productKey) ?? newProductAgg(row);
    addRowToProductAgg(productAgg, row);
    bucket.byProduct.set(productKey, productAgg);

    trendBuckets.set(key, bucket);
  }
  const trend: LostSalesTrendPoint[] = Array.from(trendBuckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bucket, totals]) => {
      const { dateFrom, dateTo } = bucketDateRange(bucket, period);
      const shortageRateForBucket = computeShortageRate(totals.unavailable, totals.requested);
      const sortedProducts = Array.from(totals.byProduct.values()).sort((a, b) => b.unavailable - a.unavailable);
      const shownProducts = sortedProducts.slice(0, MAX_PRODUCTS_PER_BUCKET_TOOLTIP);
      const hiddenProducts = sortedProducts.slice(MAX_PRODUCTS_PER_BUCKET_TOOLTIP);
      return {
        bucket,
        label: bucketLabelForKey(bucket, period),
        dateFrom,
        dateTo,
        requestedQuantity: formatTotal(totals.requested),
        foundQuantity: formatTotal(totals.found),
        unavailableQuantity: formatTotal(totals.unavailable),
        estimatedLostValue: formatTotal(totals.estimatedValue),
        confirmedLostValue: formatTotal(totals.confirmedLostValue),
        demandCount: totals.count,
        affectedOrderCount: totals.orderIds.size,
        affectedCustomerCount: totals.customerIds.size,
        availabilityRatePercent: shortageRateForBucket === null ? null : Math.round((1 - shortageRateForBucket) * 10000) / 100,
        shortageRatePercent: shortageRateForBucket === null ? null : Math.round(shortageRateForBucket * 10000) / 100,
        quantityUnitCode: totals.unitsOfMeasure.size === 1 ? Array.from(totals.unitsOfMeasure)[0] : null,
        mixedUnitsOfMeasure: totals.unitsOfMeasure.size > 1,
        products: shownProducts.map(toProductBreakdown),
        otherProductsCount: hiddenProducts.length,
        otherProductsUnavailableQuantity: formatTotal(hiddenProducts.reduce((sum, p) => sum + p.unavailable, 0)),
      };
    });

  // --- Per-product / per-customer aggregation (shared by several charts) ---
  // Chart intelligence enhancement: reuses the exact same ProductAgg/
  // newProductAgg/addRowToProductAgg/toProductBreakdown helpers the trend
  // section above uses per-bucket, just accumulated over the WHOLE
  // filtered scope instead of one bucket at a time -- one aggregation
  // rule, two scopes, never two separately-maintained implementations of
  // "what does this product's row mean."
  const byProduct = new Map<string, ProductAgg>();
  type CustomerAgg = {
    customerId: string;
    customerName: string;
    unavailable: number;
    requested: number;
    found: number;
    estimatedValue: number;
    confirmedLostValue: number;
    count: number;
    orderIds: Set<string>;
  };
  const byCustomer = new Map<string, CustomerAgg>();

  /**
   * Chart intelligence enhancement: shared by BOTH topUnavailableCustomers
   * and the shortageRateByCustomer ranking below -- one implementation of
   * "what a customer's contribution means," the same discipline
   * toProductBreakdown already applies on the product side (this file's
   * own module comment on why one aggregation rule must never have two
   * separately-maintained implementations).
   */
  function toCustomerBreakdown(agg: CustomerAgg): LostSalesCustomerBreakdown {
    return {
      customerId: agg.customerId,
      customerName: agg.customerName,
      unavailableQuantity: formatTotal(agg.unavailable),
      requestedQuantity: formatTotal(agg.requested),
      foundQuantity: formatTotal(agg.found),
      estimatedValue: formatTotal(agg.estimatedValue),
      confirmedLostValue: formatTotal(agg.confirmedLostValue),
      affectedOrderCount: agg.orderIds.size,
      shortageRatePercent: (() => {
        const rate = computeShortageRate(agg.unavailable, agg.requested);
        return rate === null ? null : Math.round(rate * 10000) / 100;
      })(),
      demandCount: agg.count,
    };
  }

  for (const row of rows) {
    const productKey = productKeyFor(row);
    const productAgg = byProduct.get(productKey) ?? newProductAgg(row);
    addRowToProductAgg(productAgg, row);
    byProduct.set(productKey, productAgg);

    const customerAgg =
      byCustomer.get(row.customerId) ?? {
        customerId: row.customerId,
        customerName: row.customerName,
        unavailable: 0,
        requested: 0,
        found: 0,
        estimatedValue: 0,
        confirmedLostValue: 0,
        count: 0,
        orderIds: new Set<string>(),
      };
    customerAgg.unavailable += row.unavailableQuantity;
    customerAgg.requested += row.requestedQuantity;
    customerAgg.found += row.foundQuantity;
    customerAgg.estimatedValue += row.estimatedValue ?? 0;
    customerAgg.confirmedLostValue += row.confirmedLostValue;
    customerAgg.count += 1;
    customerAgg.orderIds.add(row.orderId);
    byCustomer.set(row.customerId, customerAgg);
  }

  const productAggs = Array.from(byProduct.values());
  const customerAggs = Array.from(byCustomer.values());

  const topUnavailableProducts: LostSalesProductBreakdown[] = [...productAggs]
    .sort((a, b) => b.unavailable - a.unavailable)
    .slice(0, TOP_N)
    .map(toProductBreakdown);

  const topUnavailableCustomers: LostSalesCustomerBreakdown[] = [...customerAggs]
    .sort((a, b) => b.unavailable - a.unavailable)
    .slice(0, TOP_N)
    .map(toCustomerBreakdown);

  // Spec: "requested vs found vs unavailable, grouped/stacked bars" --
  // same top-10-by-unavailable product set as above, just with all
  // three measures instead of one.
  const requestedFoundUnavailableByProduct = topUnavailableProducts;

  // Chart intelligence enhancement: a single shared ranking helper for
  // both products and customers -- computes each aggregate's shortage
  // rate exactly once (never re-derived per sort comparison), applies
  // MIN_DEMAND_COUNT_FOR_RATE_RANKING and the "rate must be defined"
  // filter identically for both, then hands back the TOP_N raw aggregates
  // (still ProductAgg/CustomerAgg) for the caller to map through
  // toProductBreakdown/toCustomerBreakdown -- so the ranking charts below
  // get the exact same rich per-entity shape (value split, affected
  // orders/customers, drill-down ids) every other chart on this page
  // already uses, with zero separate type and zero duplicated
  // aggregation logic.
  function rankByShortageRate<A extends { unavailable: number; requested: number; count: number }>(aggs: A[]): A[] {
    return aggs
      .map((agg) => ({ agg, rate: computeShortageRate(agg.unavailable, agg.requested) }))
      .filter((entry): entry is { agg: A; rate: number } => entry.agg.count >= MIN_DEMAND_COUNT_FOR_RATE_RANKING && entry.rate !== null)
      .sort((a, b) => b.rate - a.rate)
      .slice(0, TOP_N)
      .map((entry) => entry.agg);
  }

  const shortageRateByProduct: LostSalesProductBreakdown[] = rankByShortageRate(productAggs).map(toProductBreakdown);
  const shortageRateByCustomer: LostSalesCustomerBreakdown[] = rankByShortageRate(customerAggs).map(toCustomerBreakdown);

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
      totalFoundQuantity: formatTotal(totalFound),
      totalUnavailableQuantity: formatTotal(totalUnavailable),
      totalOutstandingQuantity: formatTotal(totalOutstanding),
      totalConfirmedLostQuantity: formatTotal(totalConfirmedLost),
      totalEstimatedLostValue: formatTotal(totalEstimatedValue),
      totalConfirmedLostValue: formatTotal(totalConfirmedLostValue),
      demandsWithoutEstimate,
      affectedOrderCount: allOrderIds.size,
      affectedCustomerCount: allCustomerIds.size,
      quantityUnitCode,
      mixedUnitsOfMeasure,
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
      // Chart intelligence enhancement.
      totalConfirmedValue: formatTotal(toNumber(group._sum.estimatedValue)),
    })),
    decisionTypeBreakdown: decisionGroups.map((group) => ({
      decisionType: group.decisionType,
      eventCount: group._count._all,
      totalQuantity: formatTotal(toNumber(group._sum.quantity)),
    })),
    drilldown,
  };
}
