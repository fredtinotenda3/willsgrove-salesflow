import "server-only";
import { getSalesPipelineReport } from "@/lib/reporting/sales-pipeline";
import { getFulfilmentIntelligenceReport } from "@/lib/reporting/fulfilment-intelligence";
import { getFinancialExposureReport } from "@/lib/reporting/financial-exposure";
import { getLostSalesAnalytics } from "@/lib/lost-sales/analytics-queries";
import { getOperationalDashboard, type OperationalDashboard } from "@/lib/reporting/operational-dashboard";
import { formatOrderAmount } from "@/lib/order-display";
import { formatMoney } from "@/lib/format/analytics";
import type { ReportFilters, DrillDownLink } from "@/lib/reporting/types";
import { deltaPercent, resolveComparisonRanges } from "@/lib/reporting/decision-dashboard-period";

/**
 * Final completion phase, section 3 ("genuine decision-support
 * dashboard"): this is the one new composition this rebuild needed.
 * Spec section 2's rule governs here exactly as it does everywhere else
 * in lib/reporting/ -- every figure below comes from an already-built,
 * already-correct aggregate function (sales-pipeline, fulfilment-
 * intelligence, financial-exposure, lost-sales analytics, the existing
 * operational action-queue). Nothing here re-derives business logic a
 * second time; this module's only genuinely new computation is the
 * period-over-period comparison itself (current period vs. the
 * immediately preceding period of equal length), which no existing
 * report computes.
 *
 * Why these 8 KPIs and no others (spec: "do not display every metric
 * merely because it is available; ~5-9 meaningful KPIs"): one metric per
 * named business area (sales/orders x2, picking/fulfilment+availability
 * x2, dispatch/delivery x1, financial exposure x1, claims x1, lost sales
 * x1). "Availability" is not a 9th metric with its own KPI card --
 * lib/reporting/fulfilment-intelligence.ts's own module comment already
 * documents why this schema's "available" and "picked" are the same
 * number (foundQuantity); pickingAvailabilityRate IS the availability
 * metric, not a separate one.
 *
 * Why only 4 of the 8 carry a period-over-period comparison: the other
 * 4 (orders awaiting fulfilment, open invoice claims, claims financial
 * exposure, estimated supply-shortage lost sales) are, by this
 * codebase's own established design (see financial-exposure.ts's and
 * operational-dashboard.ts's own module comments), whole-business
 * "right now" snapshots rather than period-bounded flows -- computing a
 * fake prior-period delta for a running total would misrepresent it, not
 * inform anyone, which is exactly what "no fabricated targets" rules
 * out. Each such KPI is labeled "current position" rather than given an
 * invented trend.
 *
 * Role-based access (spec: "role-appropriate content using the existing
 * permission system"): follows this codebase's own pre-existing,
 * documented two-tier precedent (lib/reporting/access.ts's own module
 * comment) rather than inventing a new one -- operational KPIs are
 * visible to every authenticated role (SALESPERSON/SALES_MANAGER/
 * ADMINISTRATOR), exactly like the rest of the M11 operational surface;
 * the two KPIs that are literally a money exposure figure (claims
 * financial exposure, estimated lost-sales value) are marked
 * `visibility: "management"` and the page itself (not this module)
 * decides whether to render them, matching "never rely on hiding a UI
 * component as the sole security control" -- the underlying report
 * functions this module calls are the same open-to-all-roles aggregate
 * functions already used by the fully-open lost-sales/financial-exposure
 * report pages, so hiding the tile is a UX/relevance choice for the
 * dashboard specifically, not this app's actual authorization boundary
 * for that data (which remains each report page/route's own check).
 */

/** A product must have run short on this many separate demand records to count as a REPEATED shortage. */
export const REPEAT_SHORTAGE_MIN_DEMANDS = 3;

export type DashboardArea = "sales_orders" | "picking_fulfilment" | "dispatch_delivery" | "financial_exposure" | "claims" | "lost_sales";

export type DashboardKpiComparison =
  | { kind: "period"; priorValue: string; deltaPercent: number | null; periodLabel: string; sampleSize?: number }
  | { kind: "pointInTime"; asOfLabel: string };

export type DashboardKpi = {
  id: string;
  area: DashboardArea;
  label: string;
  value: string;
  /** Only set for a money figure that is genuinely a per-currency breakdown (never summed across currencies -- see financial-exposure.ts). */
  currencyBreakdown?: { currencyCode: string; amount: string }[];
  unit: "count" | "percent" | "currency" | "days";
  comparison: DashboardKpiComparison;
  visibility: "all" | "management";
  drillDown: DrillDownLink;
  definition: string;
};

export type DecisionDashboard = {
  asOf: string;
  periodLabel: string;
  dateFrom: string;
  dateTo: string;
  kpis: DashboardKpi[];
  /** Same shape consumed by both components/charts/lost-sales-trend.tsx charts -- each reads only the fields it needs from the same points, same as app/lost-sales/analytics/page.tsx's own usage. */
  trend: Awaited<ReturnType<typeof getLostSalesAnalytics>>["trend"];
  exceptions: OperationalDashboard["actionQueues"];
  /**
   * Products that have run short on at least REPEAT_SHORTAGE_MIN_DEMANDS
   * separate demand records in the dashboard's trend window -- a repeated
   * shortage, as opposed to a one-off. Derived from the lost-sales
   * analytics this function already fetches (no extra query).
   */
  repeatedProductShortages: { productId: string | null; sapItemCode: string | null; name: string; demandCount: number; unavailableQuantity: string; unitOfMeasure: string | null; href: string }[];
  /** Exposed so the page's own pipeline-stage visualization can reuse the exact same already-fetched snapshot rather than this module's caller re-fetching getOperationalDashboard a second time. */
  snapshot: OperationalDashboard["snapshot"];
};

/**
 * Source B (supply-shortage lost sales) never records a currency (see
 * lib/reporting/financial-exposure.ts's own module comment), so
 * formatOrderAmount's "CODE amount" shape doesn't apply here --
 * formatted as a plain decimal amount instead, with no invented
 * currency prefix.
 */
function formatPlainAmount(decimalString: string): string {
  // Source B stores no currency code (see above); it is priced from the
  // business's USD price lists, so it renders with a "$" (shared formatter,
  // same as every chart/tooltip) instead of a bare number.
  return formatMoney(decimalString, "USD");
}

// deltaPercent / resolveComparisonRanges now live in
// lib/reporting/decision-dashboard-period.ts (pure, DB-free, imported
// above) -- see that file's own module comment for why this one function
// pair, unlike the rest of this file, has its own unit-testable home.

export async function getDecisionDashboard(viewerId: string, viewerRole: string, filters: ReportFilters): Promise<DecisionDashboard> {
  const { current, prior, periodLabel } = resolveComparisonRanges(filters);
  const currentFilters: ReportFilters = { ...filters, dateFrom: current.dateFrom, dateTo: current.dateTo };
  const priorFilters: ReportFilters = { ...filters, dateFrom: prior.dateFrom, dateTo: prior.dateTo };

  const [currentPipeline, priorPipeline, currentFulfilment, priorFulfilment, financialExposure, lostSalesAnalytics, operational] = await Promise.all([
    getSalesPipelineReport(currentFilters),
    getSalesPipelineReport(priorFilters),
    getFulfilmentIntelligenceReport(currentFilters),
    getFulfilmentIntelligenceReport(priorFilters),
    getFinancialExposureReport(filters),
    // Trend chart: the same whole-dashboard filters, deliberately NOT
    // narrowed to the KPI comparison window above -- a 7-day trend line
    // has too few points to read as a trend; "day" buckets over
    // lib/reporting/filters.ts's own 30-day default (resolveEffectiveDateRange,
    // used automatically when filters.dateFrom/dateTo are null) matches
    // every other trend view in this codebase. pageSize: 1 because this
    // call site only needs `.trend` -- the drilldown rows it also computes
    // are irrelevant here and would be wasted query cost.
    getLostSalesAnalytics(filters, "day", { page: 1, pageSize: 1 }),
    getOperationalDashboard(viewerId, viewerRole, filters),
  ]);

  const claimsExposureBreakdown = financialExposure.claims.exposureByCurrency
    .filter((bucket) => Number(bucket.potentialCreditExposure) > 0)
    .map((bucket) => ({ currencyCode: bucket.currencyCode, amount: formatOrderAmount(bucket.potentialCreditExposure, bucket.currencyCode) }));

  // Real Business Data Onboarding round, Phase 7 (Claims analytics):
  // Source C's own per-currency breakdown, same shape as Source A's
  // above (both are per-currency; Source B has none, hence
  // formatPlainAmount for that tile instead).
  const returnedGoodsLossBreakdown = financialExposure.lostSalesBySource.sourceC.byCurrency
    .filter((bucket) => Number(bucket.estimatedValue) > 0)
    .map((bucket) => ({ currencyCode: bucket.currencyCode, amount: formatOrderAmount(bucket.estimatedValue, bucket.currencyCode) }));

  const openClaimsCount =
    (financialExposure.claims.statusCounts.OPEN ?? 0) +
    (financialExposure.claims.statusCounts.UNDER_INVESTIGATION ?? 0) +
    (financialExposure.claims.statusCounts.AWAITING_CUSTOMER ?? 0) +
    (financialExposure.claims.statusCounts.AWAITING_INTERNAL_ACTION ?? 0);

  const kpis: DashboardKpi[] = [
    {
      id: "ordersReceived",
      area: "sales_orders",
      label: "Orders Received",
      value: String(currentPipeline.funnel.ordersReceived),
      unit: "count",
      comparison: {
        kind: "period",
        priorValue: String(priorPipeline.funnel.ordersReceived),
        deltaPercent: deltaPercent(currentPipeline.funnel.ordersReceived, priorPipeline.funnel.ordersReceived),
        periodLabel,
      },
      visibility: "all",
      drillDown: { label: "View orders", href: "/orders" },
      definition: "Customer orders received (receivedAt) in the selected period.",
    },
    {
      id: "orderApprovalRate",
      area: "sales_orders",
      label: "Order Approval Rate",
      value: currentPipeline.funnel.orderApprovalRatePercent === null ? "—" : `${currentPipeline.funnel.orderApprovalRatePercent}%`,
      unit: "percent",
      comparison: {
        kind: "period",
        priorValue: priorPipeline.funnel.orderApprovalRatePercent === null ? "—" : `${priorPipeline.funnel.orderApprovalRatePercent}%`,
        deltaPercent:
          currentPipeline.funnel.orderApprovalRatePercent !== null && priorPipeline.funnel.orderApprovalRatePercent !== null
            ? deltaPercent(currentPipeline.funnel.orderApprovalRatePercent, priorPipeline.funnel.orderApprovalRatePercent)
            : null,
        periodLabel,
        sampleSize: currentPipeline.funnel.ordersReceived,
      },
      visibility: "all",
      drillDown: { label: "View orders awaiting approval", href: "/orders?status=READY_FOR_APPROVAL" },
      definition: "Of orders received in the period, the fraction now APPROVED or further along (never ratioed against a different period's cohort).",
    },
    {
      id: "pickingAvailabilityRate",
      area: "picking_fulfilment",
      label: "Picking Availability Rate",
      value: currentFulfilment.rates.pickingAvailabilityRatePercent === null ? "—" : `${currentFulfilment.rates.pickingAvailabilityRatePercent}%`,
      unit: "percent",
      comparison: {
        kind: "period",
        priorValue: priorFulfilment.rates.pickingAvailabilityRatePercent === null ? "—" : `${priorFulfilment.rates.pickingAvailabilityRatePercent}%`,
        deltaPercent:
          currentFulfilment.rates.pickingAvailabilityRatePercent !== null && priorFulfilment.rates.pickingAvailabilityRatePercent !== null
            ? deltaPercent(currentFulfilment.rates.pickingAvailabilityRatePercent, priorFulfilment.rates.pickingAvailabilityRatePercent)
            : null,
        periodLabel,
        sampleSize: currentFulfilment.rates.pickingLineSampleSize,
      },
      visibility: "all",
      drillDown: { label: "View fulfilment report", href: "/reports/fulfilment" },
      definition: "sum(found quantity) / sum(requested quantity) across picking lines in the period -- of what was ordered, how much was actually available to pick.",
    },
    {
      id: "ordersAwaitingFulfilment",
      area: "picking_fulfilment",
      label: "Orders Awaiting Fulfilment",
      value: String(operational.snapshot.ordersAwaitingFulfilment),
      unit: "count",
      comparison: { kind: "pointInTime", asOfLabel: "current backlog" },
      visibility: "all",
      drillDown: { label: "View orders awaiting fulfilment", href: "/fulfilment" },
      definition: "APPROVED/PICKING orders with no dispatch that has actually departed yet -- a current backlog, not a period flow.",
    },
    {
      id: "deliveryAcceptanceRate",
      area: "dispatch_delivery",
      label: "Delivery Acceptance Rate",
      value: currentFulfilment.rates.deliveryAcceptanceRatePercent === null ? "—" : `${currentFulfilment.rates.deliveryAcceptanceRatePercent}%`,
      unit: "percent",
      comparison: {
        kind: "period",
        priorValue: priorFulfilment.rates.deliveryAcceptanceRatePercent === null ? "—" : `${priorFulfilment.rates.deliveryAcceptanceRatePercent}%`,
        deltaPercent:
          currentFulfilment.rates.deliveryAcceptanceRatePercent !== null && priorFulfilment.rates.deliveryAcceptanceRatePercent !== null
            ? deltaPercent(currentFulfilment.rates.deliveryAcceptanceRatePercent, priorFulfilment.rates.deliveryAcceptanceRatePercent)
            : null,
        periodLabel,
        sampleSize: currentFulfilment.rates.deliveryLineSampleSize,
      },
      visibility: "all",
      drillDown: { label: "View fulfilment report", href: "/reports/fulfilment" },
      definition: "Of dispatched quantity with a recorded delivery outcome in the period, the fraction the customer actually accepted.",
    },
    {
      id: "openInvoiceClaims",
      area: "claims",
      label: "Open Invoice Claims",
      value: String(openClaimsCount),
      unit: "count",
      comparison: { kind: "pointInTime", asOfLabel: "current position" },
      visibility: "all",
      drillDown: { label: "View open claims", href: "/invoice-claims?status=OPEN" },
      definition: "Claims currently OPEN, UNDER_INVESTIGATION, AWAITING_CUSTOMER, or AWAITING_INTERNAL_ACTION -- a current position, not a period count.",
    },
    {
      id: "claimsFinancialExposure",
      area: "financial_exposure",
      label: "Claims Financial Exposure",
      value: claimsExposureBreakdown[0]
        ? claimsExposureBreakdown.length > 1
          ? `${claimsExposureBreakdown[0].amount} +${claimsExposureBreakdown.length - 1} more`
          : claimsExposureBreakdown[0].amount
        : "$0.00",
      currencyBreakdown: claimsExposureBreakdown,
      unit: "currency",
      comparison: { kind: "pointInTime", asOfLabel: "current position" },
      visibility: "management",
      drillDown: { label: "View financial exposure", href: "/reports/financial-exposure" },
      definition: "Rejected-after-delivery exposure: sum of potential credit exposure across open/unresolved invoice claims, by currency (never summed across currencies).",
    },
    {
      id: "estimatedLostSalesValue",
      area: "lost_sales",
      label: "Estimated Lost Sales (Supply Shortage)",
      value: formatPlainAmount(financialExposure.lostSalesBySource.sourceB.estimatedValue),
      unit: "currency",
      comparison: { kind: "pointInTime", asOfLabel: "current position" },
      visibility: "management",
      drillDown: { label: "View lost-sales analytics", href: "/lost-sales/analytics" },
      definition: "Unfulfilled demand: sum of estimated value (unavailable quantity x applicable selling price) across lost-sale records with a resolvable price.",
    },
    {
      id: "returnedGoodsLostSalesValue",
      area: "lost_sales",
      label: "Confirmed Loss (Returned Goods)",
      value: returnedGoodsLossBreakdown[0]
        ? returnedGoodsLossBreakdown.length > 1
          ? `${returnedGoodsLossBreakdown[0].amount} +${returnedGoodsLossBreakdown.length - 1} more`
          : returnedGoodsLossBreakdown[0].amount
        : "$0.00",
      currencyBreakdown: returnedGoodsLossBreakdown,
      unit: "currency",
      comparison: { kind: "pointInTime", asOfLabel: "current position" },
      visibility: "management",
      drillDown: { label: "View financial exposure", href: "/reports/financial-exposure" },
      definition: "Confirmed loss from returns: of goods physically returned against a claim, the confirmed value of whatever was found DAMAGED, EXPIRED or otherwise unsellable -- a confirmed outcome, not a dispute estimate. Never summed with Source A (Claims Financial Exposure) for the same claim; see the financial exposure report's own note.",
    },
  ];

  // One genuinely new exception, reusing a figure fulfilment-intelligence.ts
  // already computes (app/reports/fulfilment/page.tsx's own "Overdue to
  // depart" row) but that the pre-existing action queue never surfaced --
  // a concrete, data-supported delay signal, not an invented one. Appended
  // after the pre-existing queue rather than inserted into it, so this
  // dashboard-specific addition never changes operational-dashboard.ts's
  // own, separately-tested output.
  const dispatchesOverdue = currentFulfilment.dispatchDelivery.dispatchesOverdueToDepart;
  const exceptions: OperationalDashboard["actionQueues"] = [
    ...operational.actionQueues,
    {
      label: "Dispatches overdue to depart",
      count: dispatchesOverdue,
      severity: dispatchesOverdue > 0 ? "urgent" : "info",
      drillDown: { label: "View fulfilment report", href: "/reports/fulfilment" },
    },
  ];

  const repeatedProductShortages = lostSalesAnalytics.topUnavailableProducts
    .filter((product) => product.demandCount >= REPEAT_SHORTAGE_MIN_DEMANDS)
    .slice(0, 5)
    .map((product) => ({
      productId: product.productId,
      sapItemCode: product.sapItemCodeSnapshot,
      name: product.productDescriptionSnapshot,
      demandCount: product.demandCount,
      unavailableQuantity: product.unavailableQuantity,
      unitOfMeasure: product.unitOfMeasure,
      href: `/lost-sales/analytics?${new URLSearchParams({ ...(product.productId ? { productId: product.productId } : {}), ...(product.sapItemCodeSnapshot ? { sapItemCode: product.sapItemCodeSnapshot } : {}) }).toString()}`,
    }));

  return {
    asOf: new Date().toISOString(),
    periodLabel,
    dateFrom: current.dateFrom,
    dateTo: current.dateTo,
    kpis,
    trend: lostSalesAnalytics.trend,
    repeatedProductShortages,
    exceptions,
    snapshot: operational.snapshot,
  };
}
