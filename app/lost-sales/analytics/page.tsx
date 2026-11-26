import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getLostSalesAnalytics } from "@/lib/lost-sales/analytics-queries";
import { getConsolidatedLostSalesAnalytics } from "@/lib/lost-sales/consolidated-analytics";
import { getUnifiedLostSalesReport } from "@/lib/lost-sales/unified-queries";
import { ReasonAnalyticsSection } from "../../reports/_components/reason-analytics-section";
import { UnifiedLostSalesSummary } from "../../reports/_components/unified-lost-sales-summary";
import { parseLostSalesAnalyticsPeriod, lostSalesAnalyticsPeriodValues, type LostSalesAnalyticsPeriod } from "@/lib/lost-sales/analytics-validation";
import { LOST_SALES_MAX_PAGE_SIZE } from "@/lib/lost-sales/queries";
import { unfulfilledDemandStatusValues } from "@/lib/lost-sales/validation";
import {
  UNFULFILLED_DEMAND_STATUS_LABELS,
  UNFULFILLED_DEMAND_STATUS_STYLES,
  LOST_SALE_REASON_LABELS,
  LOST_SALE_SOURCE_LABELS,
  LOST_SALE_SOURCE_STYLES,
} from "@/lib/lost-sales/display";
import { getReportFilterOptions } from "@/lib/reporting/filter-options";
import { parseReportFilters, parsePagination, REPORT_DEFAULT_PAGE_SIZE, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { toFlatSearchParams, toURLSearchParams, filtersOnly, type ReportSearchParams } from "../../reports/_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, MetricCard, RateStat, BarRow, Pagination, EmptyState } from "../../reports/_components/ui";
import { ReportFilterBar } from "../../reports/_components/filter-bar";
import {
  RequestedVsUnavailableTrendChart,
  EstimatedLostValueTrendChart,
  TopUnavailableBarChart,
  RequestedFoundUnavailableChart,
  RequestedFoundUnavailableValueChart,
  RequestedFoundVsAmountByProductChart,
  QuantityVsLostValueTrendChart,
  ShortageRateBarChart,
  CompositionStackedBar,
  UnavailableQuantityDistribution,
} from "./_components/charts";
import { AlertCircle, ChevronRight, Download, Info } from "lucide-react";
import { formatCurrencyAmount } from "@/lib/format/currency";

/**
 * Additional Implementation Requirements (spec section 3: "Lost Sales
 * Analytics Overhaul"). Reached at /lost-sales/analytics (the
 * Operations-section URL namespace -- see app/components/sidebar.tsx's
 * "Lost Sales" entry), not under /reports/*, because this page's access
 * level matches /lost-sales itself (any authenticated user, not
 * management-only -- see lib/lost-sales/queries.ts's own GET
 * /api/lost-sales comment), unlike the management-only M13/M14/M15
 * "Intelligence" report pages. Same "deliberately simple Server
 * Component page, plain query-string filters" architecture as every
 * other /reports/* page -- only the chart rendering itself needs a
 * Client Component (app/lost-sales/analytics/_components/charts.tsx).
 */
export const instant = false;

type RouteParams = { searchParams: Promise<ReportSearchParams> };

const EMPTY_FILTERS = {
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
  includeDemo: false,
  currency: null,
  lostSalesReason: null,
  unfulfilledDemandStatus: null,
  lostSaleSource: null,
  productCategory: null,
  productSearch: null,
  sapItemCode: null,
  decisionCategory: null,
  priority: null,
  recommendationStatus: null,
} as const;

const PERIOD_LABELS: Record<LostSalesAnalyticsPeriod, string> = { day: "Daily", week: "Weekly", month: "Monthly" };

/** Money with its sign: "$1,234.50" (USD, also used where the source figure carries no currency); other currencies keep their code. */
function money(value: string, currency?: string | null): string {
  const formatted = formatCurrencyAmount(currency ?? "USD", value);
  return formatted === "—" ? value : formatted;
}

function formatQuantity(value: string): string {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : value;
}

/**
 * Chart intelligence enhancement (spec section 5's own audit list
 * includes "loss reason breakdowns" and "customer decision breakdowns";
 * spec section 8's own drill-down example is literally "clicking a loss
 * reason filters the relevant records"). Mirrors
 * components/charts/rich-tooltip.tsx's buildHref exactly -- same small,
 * pure URL-building helper, duplicated here rather than imported across
 * the client/server boundary for no real benefit, since this is plain
 * query-string construction, not business/aggregation logic (the one
 * kind of duplication this codebase's "one implementation" rule is
 * actually about -- see analytics-queries.ts's own comment).
 */
function buildDrillDownHref(basePath: string, baseQuery: Record<string, string>, extra: Record<string, string>): string {
  const params = new URLSearchParams(baseQuery);
  for (const [key, value] of Object.entries(extra)) {
    if (value) params.set(key, value);
  }
  return `${basePath}?${params.toString()}`;
}

export default async function LostSalesAnalyticsPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const flatSearchParams = toFlatSearchParams(resolvedSearchParams);
  const urlSearchParams = toURLSearchParams(resolvedSearchParams);

  const parsedFilters = parseReportFilters(urlSearchParams);
  const parsedPagination = parsePagination(urlSearchParams);
  const period = parseLostSalesAnalyticsPeriod(urlSearchParams.get("period"));

  const filters = parsedFilters.ok ? parsedFilters.filters : EMPTY_FILTERS;
  // lib/lost-sales/queries.ts's listUnfulfilledDemands/
  // LOST_SALES_MAX_PAGE_SIZE is this module's own documented pagination
  // cap (100) -- tighter than the generic REPORT_MAX_PAGE_SIZE (200) that
  // parsePagination otherwise allows. Clamped here rather than loosened
  // there, so the drilldown table never silently exceeds the bound every
  // other lost-sales list view honors.
  const rawPagination = parsedPagination.ok ? parsedPagination.pagination : { page: 1, pageSize: REPORT_DEFAULT_PAGE_SIZE };
  const pagination = { page: rawPagination.page, pageSize: Math.min(rawPagination.pageSize, LOST_SALES_MAX_PAGE_SIZE) };

  // Follow-up fix (consolidated lost-sales drilldown). Its own page
  // number, under its own query-param name -- see Pagination's own
  // `pageParam` comment for why this table cannot share "page" with the
  // shortage-only order-level drilldown already on this same page.
  // Reuses the same clamped pageSize as that table (pageSize is not
  // independently filterable here -- one bound is enough).
  const consolidatedPageRaw = Number.parseInt(urlSearchParams.get("consolidatedPage") ?? "1", 10);
  const consolidatedPage = { page: Number.isFinite(consolidatedPageRaw) && consolidatedPageRaw >= 1 ? consolidatedPageRaw : 1, pageSize: pagination.pageSize };

  // The claims/unified figures use the SAME effective date window as the
  // rest of this page (the page's own 30-day default when none is set).
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const [analytics, consolidated, unifiedReport, filterOptions] = await Promise.all([
    getLostSalesAnalytics(filters, period, pagination),
    getConsolidatedLostSalesAnalytics(filters, consolidatedPage),
    getUnifiedLostSalesReport({ includeDemo: filters.includeDemo, customerId: filters.customerId, dateFrom: effectiveFrom, dateTo: effectiveTo }),
    getReportFilterOptions(),
  ]);

  const basePath = "/lost-sales/analytics";
  // Chart intelligence enhancement: every rich-tooltip drill-down link
  // carries the page's CURRENT filters (minus `page`, which means
  // nothing on the destination this links into -- see
  // search-params.ts's own comment on filtersOnly), so clicking into a
  // chart's product/customer/date never silently drops a filter the user
  // already applied (spec section 9: "existing filters apply
  // consistently... to tooltips and drill-down").
  const baseQuery = filtersOnly(resolvedSearchParams);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Lost Sales / Analytics</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Lost Sales Analytics</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Operations / Lost Sales / Analytics"
            title="Lost Sales Analytics"
            description={`Unfulfilled demand, ${analytics.effectiveDateFrom} to ${analytics.effectiveDateTo}${analytics.dateRangeWasDefaulted ? " (default 30-day window -- set a date range below to change it)" : ""}. Figures use the same "current, non-superseded demand" scope throughout this page -- see the note on the Lost-Sales Management summary for how that differs from its own all-time confirmed-lost total.`}
            actions={
              <Link href="/lost-sales" className="text-sm font-semibold text-[#718078] hover:text-[#17251E]">
                &larr; Back to Lost Sales
              </Link>
            }
          />

          {!parsedFilters.ok && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <p>{parsedFilters.message} Showing the default view instead.</p>
            </div>
          )}

          {analytics.truncated && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <Info size={18} className="mt-0.5 shrink-0" />
              <p>
                This filter matches more than {analytics.sampleSize.toLocaleString()} demand records -- the charts above are computed from
                the first {analytics.sampleSize.toLocaleString()} only. Narrow the date range or add a filter for a complete picture.
              </p>
            </div>
          )}

          <div className="flex items-center gap-2 rounded-2xl border border-[#E7ECE7] bg-white p-3 shadow-sm">
            <span className="px-2 text-xs font-semibold text-[#718078]">Trend period</span>
            {lostSalesAnalyticsPeriodValues.map((p) => (
              <Link
                key={p}
                href={{ pathname: basePath, query: { ...flatSearchParams, period: p } }}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${
                  period === p ? "bg-[#183B2D] text-white" : "text-[#536158] hover:bg-gray-50"
                }`}
              >
                {PERIOD_LABELS[p]}
              </Link>
            ))}
          </div>

          <ReportFilterBar
            viewAction={basePath}
            exportAction="/api/lost-sales/analytics/export"
            searchParams={flatSearchParams}
            customers={filterOptions.customers}
            salespeople={filterOptions.salespeople}
            showSalesperson
            showProduct
            showLostSalesReason
            showLostSaleSource
            statusFilter={{
              queryKey: "unfulfilledDemandStatus",
              label: "Demand status",
              options: unfulfilledDemandStatusValues.map((value) => ({ value, label: UNFULFILLED_DEMAND_STATUS_LABELS[value] ?? value })),
            }}
          />

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard
              title="Requested quantity"
              value={formatQuantity(analytics.kpis.totalRequestedQuantity)}
              description={`≈ ${money(analytics.kpis.totalRequestedValue)} in value${
                analytics.kpis.demandsWithoutEstimate > 0 ? " (excludes demand(s) with no resolvable price)" : ""
              }`}
              dataQuality="actual"
            />
            <MetricCard
              title="Found quantity"
              value={formatQuantity(analytics.kpis.totalFoundQuantity)}
              description={`≈ ${money(analytics.kpis.totalFoundValue)} in value${
                analytics.kpis.demandsWithoutEstimate > 0 ? " (excludes demand(s) with no resolvable price)" : ""
              }`}
              dataQuality="actual"
            />
            <MetricCard
              title="Unavailable quantity"
              value={formatQuantity(analytics.kpis.totalUnavailableQuantity)}
              description={`≈ ${money(analytics.kpis.totalEstimatedLostValue)} Lost Value (priced demands only) -- see below for the confirmed figure`}
              dataQuality="actual"
            />
            <MetricCard title="Outstanding (awaiting supply)" value={formatQuantity(analytics.kpis.totalOutstandingQuantity)} dataQuality="actual" />
            <MetricCard title="Confirmed lost quantity" value={formatQuantity(analytics.kpis.totalConfirmedLostQuantity)} dataQuality="actual" />
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Lost Value"
              value={money(analytics.kpis.totalEstimatedLostValue)}
              description={
                analytics.kpis.demandsWithoutEstimate > 0
                  ? `${analytics.kpis.demandsWithoutEstimate} demand(s) in scope have no resolvable price and are excluded from this total`
                  : "Every demand in scope had a resolvable price"
              }
              dataQuality={analytics.kpis.demandsWithoutEstimate > 0 ? "provisional" : "calculated"}
            />
            <MetricCard
              title="Confirmed lost value"
              value={money(analytics.kpis.totalConfirmedLostValue)}
              description="From actually-confirmed LostSaleRecord entries -- never blended with the estimated figure above"
              dataQuality="actual"
            />
            <MetricCard title="Affected orders" value={analytics.kpis.affectedOrderCount.toLocaleString()} dataQuality="actual" />
            <MetricCard title="Affected customers" value={analytics.kpis.affectedCustomerCount.toLocaleString()} dataQuality="actual" />
          </section>

          {analytics.kpis.mixedUnitsOfMeasure && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <Info size={18} className="mt-0.5 shrink-0" />
              <p>
                The demand records in this view span more than one unit of measure, so the quantity totals above combine different units.
                See each chart&apos;s own tooltip for a per-product breakdown with the correct unit for each product.
              </p>
            </div>
          )}

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RateStat label="Availability rate" ratePercent={analytics.kpis.availabilityRatePercent} sampleSize={analytics.sampleSize} sampleLabel="demand records" />
            <RateStat label="Shortage rate" ratePercent={analytics.kpis.shortageRatePercent} sampleSize={analytics.sampleSize} sampleLabel="demand records" />
          </section>

          {/*
            Follow-up fix ("Show returned-claim losses in the same Lost
            Sales Analytics page, KPIs, charts and reports as
            shortage-based lost sales... Show separate breakdowns by
            source... Add source filters and drill-down..."). Everything
            above this point is the pre-existing, UNCHANGED shortage-only
            view (UnfulfilledDemand/LostSaleRecord) -- requested/found/
            outstanding quantities have no meaningful equivalent for a
            physical return (a return was never "requested" or "found"
            during picking), so that view stays exactly as it was.
            Everything in this section is the NEW combined view: both
            sources, side by side, never isolated in a separate report.
          */}
          <SectionCard
            title="Lost sales by source (combined)"
            description="Confirmed losses from BOTH sources -- shortages never delivered, and physically returned goods found unsellable. Never double-counted: the two sources describe disjoint quantities of goods (undelivered vs. delivered-then-returned) -- see each row's own drill-down for the underlying record."
          >
            <div className="space-y-5">
              <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <MetricCard
                  title="Combined confirmed lost quantity"
                  value={formatQuantity(consolidated.kpis.totalConfirmedLostQuantity)}
                  description={consolidated.kpis.mixedUnitsOfMeasure ? "Spans more than one unit of measure -- see the by-product breakdown for each product's own unit" : consolidated.kpis.quantityUnitCode ?? undefined}
                  dataQuality="actual"
                />
                <MetricCard title="From shortages" value={formatQuantity(consolidated.kpis.shortageConfirmedLostQuantity)} dataQuality="actual" />
                <MetricCard title="From returned product" value={formatQuantity(consolidated.kpis.returnedConfirmedLostQuantity)} dataQuality="actual" />
                <MetricCard title="Affected orders / customers" value={`${consolidated.kpis.affectedOrderCount.toLocaleString()} / ${consolidated.kpis.affectedCustomerCount.toLocaleString()}`} dataQuality="actual" />
              </section>

              {consolidated.kpis.recordsWithoutValue > 0 && (
                <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <Info size={18} className="mt-0.5 shrink-0" />
                  <p>
                    {consolidated.kpis.recordsWithoutValue} record(s) in scope have no resolvable unit price and are excluded from every value total
                    below -- never shown as a fabricated zero.
                  </p>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#849087]">Confirmed lost value by currency (never summed across currencies)</p>
                {consolidated.valueByCurrency.length === 0 ? (
                  <EmptyState message="No priced confirmed losses in the selected range." />
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-[#EEF1ED]">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                        <tr>
                          <th className="px-4 py-2 font-semibold">Currency</th>
                          <th className="px-4 py-2 text-right font-semibold">From shortages</th>
                          <th className="px-4 py-2 text-right font-semibold">From returned product</th>
                          <th className="px-4 py-2 text-right font-semibold">Combined</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#EEF1ED]">
                        {consolidated.valueByCurrency.map((bucket) => (
                          <tr key={bucket.currencyCode}>
                            <td className="px-4 py-2 font-semibold text-[#17251E]">{bucket.currencyCode}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-right text-[#17251E]">{money(bucket.shortageValue, bucket.currencyCode)}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-right text-[#17251E]">{money(bucket.returnedValue, bucket.currencyCode)}</td>
                            <td className="whitespace-nowrap px-4 py-2 text-right font-semibold text-[#17251E]">{money(bucket.totalValue, bucket.currencyCode)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#849087]">By source</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {consolidated.bySource.map((row) => (
                    <Link
                      key={row.source}
                      href={buildDrillDownHref(basePath, baseQuery, { lostSaleSource: row.source })}
                      className="block rounded-xl border border-[#EEF1ED] p-4 transition hover:bg-gray-50"
                    >
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold ${LOST_SALE_SOURCE_STYLES[row.source] ?? "bg-gray-100 text-gray-600"}`}>
                        {LOST_SALE_SOURCE_LABELS[row.source] ?? row.source}
                      </span>
                      <p className="mt-2 text-sm text-[#17251E]">
                        {row.recordCount.toLocaleString()} record(s) -- {formatQuantity(row.quantity)} unit(s)
                      </p>
                      <p className="mt-1 text-[11px] text-[#9AA59E]">
                        {row.valueByCurrency.length === 0
                          ? "No priced records"
                          : row.valueByCurrency.map((v) => formatCurrencyAmount(v.currencyCode, v.value)).join(" · ")}
                        {row.recordsWithoutValue > 0 ? ` (+${row.recordsWithoutValue} unpriced)` : ""}
                      </p>
                    </Link>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#849087]">Top products by combined lost quantity</p>
                  {consolidated.byProduct.length === 0 ? (
                    <EmptyState message="No confirmed losses match this filter." />
                  ) : (
                    <div className="space-y-3">
                      {consolidated.byProduct.map((row) => (
                        <div key={`${row.sapItemCodeSnapshot ?? row.productId ?? row.productDescriptionSnapshot ?? "unresolved"}`} className="rounded-lg border border-[#EEF1ED] p-3">
                          <p className="text-sm font-medium text-[#17251E]">
                            {row.productDescriptionSnapshot ?? <span className="italic text-[#9AA59E]">Unspecified (claim-level return)</span>}
                          </p>
                          {row.sapItemCodeSnapshot && <p className="text-[10px] text-gray-400">{row.sapItemCodeSnapshot}</p>}
                          <p className="mt-1 text-[11px] text-[#718078]">
                            {formatQuantity(row.quantity)} {row.mixedUnitsOfMeasure ? "(mixed units)" : row.unitOfMeasure ?? ""} -- shortage{" "}
                            {formatQuantity(row.shortageQuantity)} / returned {formatQuantity(row.returnedQuantity)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#9AA59E]">
                            {row.valueByCurrency.length === 0
                              ? "No priced records"
                              : row.valueByCurrency.map((v) => formatCurrencyAmount(v.currencyCode, v.value)).join(" · ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#849087]">Top customers by combined lost quantity</p>
                  {consolidated.byCustomer.length === 0 ? (
                    <EmptyState message="No confirmed losses match this filter." />
                  ) : (
                    <div className="space-y-3">
                      {consolidated.byCustomer.map((row) => (
                        <div key={row.customerId} className="rounded-lg border border-[#EEF1ED] p-3">
                          <p className="text-sm font-medium text-[#17251E]">{row.customerName}</p>
                          <p className="mt-1 text-[11px] text-[#718078]">
                            {formatQuantity(row.quantity)} unit(s) -- shortage {formatQuantity(row.shortageQuantity)} / returned {formatQuantity(row.returnedQuantity)}
                          </p>
                          <p className="mt-0.5 text-[11px] text-[#9AA59E]">
                            {row.valueByCurrency.length === 0
                              ? "No priced records"
                              : row.valueByCurrency.map((v) => formatCurrencyAmount(v.currencyCode, v.value)).join(" · ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Combined lost-sales drilldown"
            description={`${consolidated.drilldown.pagination.totalItems} confirmed lost-sale record(s) match the current filters, across both sources -- product, customer, quantity, unit of measure, unit price and total value, with drill-down to the original order, invoice, claim and return`}
          >
            <div className="mb-4 flex justify-end">
              <a
                href={buildDrillDownHref("/api/lost-sales/analytics/consolidated-export", baseQuery, {})}
                className="inline-flex items-center gap-2 rounded-xl border border-[#D7E0D5] px-4 py-2 text-xs font-semibold text-[#17251E] transition hover:bg-gray-50"
              >
                <Download size={13} />
                Export CSV (every row, both sources)
              </a>
            </div>
            {consolidated.drilldown.rows.length === 0 ? (
              <EmptyState message="No confirmed lost-sale records match this filter." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Source</th>
                      <th className="px-5 py-3 font-semibold">Date</th>
                      <th className="px-5 py-3 font-semibold">Customer</th>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 text-right font-semibold">Quantity</th>
                      <th className="px-5 py-3 text-right font-semibold">Unit price</th>
                      <th className="px-5 py-3 text-right font-semibold">Total value</th>
                      <th className="px-5 py-3 font-semibold">Drill-down</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {consolidated.drilldown.rows.map((row) => (
                      <tr key={`${row.source}-${row.id}`} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-5 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${LOST_SALE_SOURCE_STYLES[row.source] ?? "bg-gray-100 text-gray-500"}`}>
                            {LOST_SALE_SOURCE_LABELS[row.source] ?? row.source}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-[#17251E]">{new Date(row.date).toLocaleDateString()}</td>
                        <td className="px-5 py-3 font-medium text-[#17251E]">{row.customerName}</td>
                        <td className="px-5 py-3 text-[#17251E]">
                          <p className="font-medium">{row.productDescriptionSnapshot ?? <span className="italic text-[#9AA59E]">Unspecified</span>}</p>
                          {row.sapItemCodeSnapshot && <p className="text-[10px] text-gray-400">{row.sapItemCodeSnapshot}</p>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[#17251E]">
                          {formatQuantity(row.quantity)} {row.unitOfMeasure ?? ""}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[#17251E]">
                          {row.unitPrice !== null ? money(row.unitPrice, row.currencyCode) : <span className="text-[#C3CBC5]">--</span>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[#17251E]">
                          {row.totalValue !== null ? money(row.totalValue, row.currencyCode) : <span className="text-[#C3CBC5]">--</span>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3">
                          <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-gray-500">
                            {row.orderId && (
                              <Link href={`/orders/${row.orderId}`} className="inline-flex items-center gap-0.5 hover:text-[#173D2E]">
                                Order <ChevronRight size={12} />
                              </Link>
                            )}
                            {row.source === "SHORTAGE" && row.unfulfilledDemandId && (
                              <Link href={`/lost-sales/${row.unfulfilledDemandId}`} className="inline-flex items-center gap-0.5 hover:text-[#173D2E]">
                                Demand <ChevronRight size={12} />
                              </Link>
                            )}
                            {row.source === "RETURNED_PRODUCT" && row.sapInvoiceId && (
                              <Link href={`/invoice-reconciliation/${row.sapInvoiceId}`} className="inline-flex items-center gap-0.5 hover:text-[#173D2E]">
                                Invoice <ChevronRight size={12} />
                              </Link>
                            )}
                            {row.source === "RETURNED_PRODUCT" && row.claimId && (
                              <Link href={`/invoice-claims/${row.claimId}`} className="inline-flex items-center gap-0.5 hover:text-[#173D2E]" title={row.returnReference ? `Return ${row.returnReference}, rendered on this claim's own page` : undefined}>
                                Claim &amp; return <ChevronRight size={12} />
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              basePath={basePath}
              searchParams={flatSearchParams}
              page={consolidated.drilldown.pagination.page}
              totalPages={consolidated.drilldown.pagination.totalPages}
              totalItems={consolidated.drilldown.pagination.totalItems}
              pageSize={consolidated.drilldown.pagination.pageSize}
              pageParam="consolidatedPage"
            />
          </SectionCard>

          <SectionCard title="Quantity vs. lost value over time" description="Requested and unavailable quantity (left axis) against requested amount and lost value in USD (right axis) -- separate axes because quantity and money are different units">
            <QuantityVsLostValueTrendChart data={analytics.trend} />
          </SectionCard>

          <SectionCard title="Requested and found quantity vs. sales amount, by product" description="Same top products as below: how much was requested and found (left axis) against the amount that represents in USD (right axis)">
            <RequestedFoundVsAmountByProductChart data={analytics.requestedFoundUnavailableByProduct} />
          </SectionCard>

          <SectionCard title="Requested vs. unavailable quantity over time" description="Same unit (quantity), one shared axis -- hover a point for the full product/customer breakdown behind it">
            <RequestedVsUnavailableTrendChart data={analytics.trend} basePath={basePath} baseQuery={baseQuery} />
          </SectionCard>

          <SectionCard title="Requested vs. unavailable value (Total) over time" description="Order-line Total (Amount) for the same quantities as above -- a currency scale, so its own chart and axis -- hover a point for the product-contribution table and the estimated-vs-confirmed split">
            <EstimatedLostValueTrendChart data={analytics.trend} basePath={basePath} baseQuery={baseQuery} />
          </SectionCard>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Top unavailable products" description={`Top ${analytics.topUnavailableProducts.length} by unavailable quantity -- hover a bar for its full breakdown`}>
              <TopUnavailableBarChart rows={analytics.topUnavailableProducts} entityLabel="products" kind="product" basePath={basePath} baseQuery={baseQuery} />
            </SectionCard>
            <SectionCard title="Top unavailable customers" description={`Top ${analytics.topUnavailableCustomers.length} by unavailable quantity -- hover a bar for its full breakdown`}>
              <TopUnavailableBarChart rows={analytics.topUnavailableCustomers} entityLabel="customers" kind="customer" basePath={basePath} baseQuery={baseQuery} />
            </SectionCard>
          </section>

          <SectionCard title="Requested vs. found vs. unavailable, by product" description="Same top-10-by-unavailable product set as above, all three measures -- hover a bar for its full breakdown">
            <RequestedFoundUnavailableChart data={analytics.requestedFoundUnavailableByProduct} basePath={basePath} baseQuery={baseQuery} />
          </SectionCard>

          <SectionCard title="Requested vs. found vs. unavailable value (Total), by product" description="The same products as above measured in value (order-line Total) instead of quantity -- hover a bar for its full breakdown">
            <RequestedFoundUnavailableValueChart data={analytics.requestedFoundUnavailableByProduct} basePath={basePath} baseQuery={baseQuery} />
          </SectionCard>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Shortage rate by product" description="Ranked only among products with 3+ demand records -- a single-record 100% is never shown as a rate">
              <ShortageRateBarChart rows={analytics.shortageRateByProduct} entityLabel="product" kind="product" basePath={basePath} baseQuery={baseQuery} />
            </SectionCard>
            <SectionCard title="Shortage rate by customer" description="Ranked only among customers with 3+ demand records -- a single-record 100% is never shown as a rate">
              <ShortageRateBarChart rows={analytics.shortageRateByCustomer} entityLabel="customer" kind="customer" basePath={basePath} baseQuery={baseQuery} />
            </SectionCard>
          </section>

          <SectionCard title="Composition of unavailable quantity" description="What became of every unavailable unit -- confirmedLost is a subset of cancelled, split out rather than double-counted">
            <CompositionStackedBar composition={analytics.composition} />
          </SectionCard>

          <SectionCard title="Distribution of unavailable quantity per demand" description="Percentiles and a histogram -- shown only once the sample is large enough to be meaningful">
            <UnavailableQuantityDistribution distribution={analytics.distribution} />
          </SectionCard>

          {/*
            Real Business Data Onboarding round (spec PART A): the "By
            customer decision" breakdown is removed outright, not just
            hidden -- no surviving code path ever creates a new
            CustomerDecisionEvent to break down any more (see
            lib/lost-sales/analytics-queries.ts's own comment on why
            decisionTypeBreakdown no longer exists on this analytics
            result). "By loss reason" survives unchanged: LostSaleRecord
            and its reason enum are untouched by this round -- every
            shortage is still reasoned (INSUFFICIENT_QUANTITY /
            PRODUCT_UNAVAILABLE, picked automatically; see
            create-unfulfilled-demand.ts), just no longer through a human
            decision step.
          */}
          <SectionCard title="By loss reason" description="LostSaleRecord.reason, across every confirmed-lost record in scope -- click a reason to see its records">
            {analytics.lossReasonBreakdown.length === 0 ? (
              <EmptyState message="No confirmed lost-sale records in the selected range." />
            ) : (
              <div className="space-y-4">
                {analytics.lossReasonBreakdown.map((row) => (
                  <Link
                    key={row.reason}
                    href={buildDrillDownHref(basePath, baseQuery, { lostSalesReason: row.reason })}
                    className="-m-1.5 block rounded-lg p-1.5 transition hover:bg-gray-50"
                  >
                    <BarRow
                      label={LOST_SALE_REASON_LABELS[row.reason] ?? row.reason}
                      count={row.recordCount}
                      maxCount={Math.max(...analytics.lossReasonBreakdown.map((r) => r.recordCount))}
                      color="bg-[#2a78d6]"
                    />
                    <p className="mt-1 text-[11px] text-[#9AA59E]">
                      {formatQuantity(row.totalQuantity)} unit(s) -- confirmed value {money(row.totalConfirmedValue)}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          <UnifiedLostSalesSummary unified={unifiedReport.unified} periodLabel={`${effectiveFrom} to ${effectiveTo}`} />

          <ReasonAnalyticsSection breakdown={unifiedReport.reasons} periodLabel={`${effectiveFrom} to ${effectiveTo}`} truncated={unifiedReport.truncated} />

          <SectionCard title="Order-level drilldown" description={`${analytics.drilldown.pagination.totalItems} unfulfilled-demand record(s) match the current filters`}>
            {analytics.drilldown.demands.length === 0 ? (
              <EmptyState message="No unfulfilled-demand records match this filter." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Order</th>
                      <th className="px-5 py-3 font-semibold">Customer</th>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 text-right font-semibold">Requested</th>
                      <th className="px-5 py-3 text-right font-semibold">Unavailable</th>
                      <th className="px-5 py-3 text-right font-semibold">Outstanding</th>
                      <th className="px-5 py-3 text-right font-semibold">Lost qty</th>
                      <th className="px-5 py-3 text-right font-semibold">Unit price</th>
                      <th className="px-5 py-3 text-right font-semibold">Lost Value</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {analytics.drilldown.demands.map((demand) => (
                      <tr key={demand.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-5 py-3">
                          <Link href={`/orders/${demand.orderId}`} className="font-semibold text-[#173D2E] hover:underline">
                            {demand.orderReference}
                          </Link>
                        </td>
                        <td className="px-5 py-3 font-medium text-[#17251E]">{demand.customerName}</td>
                        <td className="px-5 py-3 text-[#17251E]">
                          <p className="font-medium">{demand.productDescriptionSnapshot}</p>
                          {demand.sapItemCodeSnapshot && <p className="text-[10px] text-gray-400">{demand.sapItemCodeSnapshot}</p>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[#17251E]">{demand.requestedQuantity}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[#17251E]">{demand.unavailableQuantity}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[#17251E]">{demand.outstandingQuantity}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[#17251E]">{demand.confirmedLostQuantity}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[#17251E]">
                          {demand.estimatedUnitPrice !== null ? money(demand.estimatedUnitPrice, demand.currencyCode) : <span className="text-[#C3CBC5]">--</span>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-[#17251E]">
                          {demand.estimatedValue !== null ? money(demand.estimatedValue, demand.currencyCode) : <span className="text-[#C3CBC5]">--</span>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3">
                          <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${UNFULFILLED_DEMAND_STATUS_STYLES[demand.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {UNFULFILLED_DEMAND_STATUS_LABELS[demand.status] ?? demand.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          <Link href={`/lost-sales/${demand.id}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]">
                            Open
                            <ChevronRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination
              basePath={basePath}
              searchParams={flatSearchParams}
              page={analytics.drilldown.pagination.page}
              totalPages={analytics.drilldown.pagination.totalPages}
              totalItems={analytics.drilldown.pagination.totalItems}
              pageSize={analytics.drilldown.pagination.pageSize}
            />
          </SectionCard>
        </div>
      </main>
    </div>
  );
}
