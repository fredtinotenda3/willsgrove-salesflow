import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getLostSalesAnalytics } from "@/lib/lost-sales/analytics-queries";
import { getClaimReasonAnalytics } from "@/lib/invoice-claims/reason-analytics";
import { parseLostSalesAnalyticsPeriod, lostSalesAnalyticsPeriodValues, type LostSalesAnalyticsPeriod } from "@/lib/lost-sales/analytics-validation";
import { LOST_SALES_MAX_PAGE_SIZE } from "@/lib/lost-sales/queries";
import { unfulfilledDemandStatusValues } from "@/lib/lost-sales/validation";
import { UNFULFILLED_DEMAND_STATUS_LABELS, UNFULFILLED_DEMAND_STATUS_STYLES, LOST_SALE_REASON_LABELS, DECISION_TYPE_LABELS } from "@/lib/lost-sales/display";
import { getReportFilterOptions } from "@/lib/reporting/filter-options";
import { parseReportFilters, parsePagination, REPORT_DEFAULT_PAGE_SIZE } from "@/lib/reporting/filters";
import { toFlatSearchParams, toURLSearchParams, filtersOnly, type ReportSearchParams } from "../../reports/_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, MetricCard, RateStat, BarRow, Pagination, EmptyState } from "../../reports/_components/ui";
import { ReportFilterBar } from "../../reports/_components/filter-bar";
import {
  RequestedVsUnavailableTrendChart,
  EstimatedLostValueTrendChart,
  TopUnavailableBarChart,
  RequestedFoundUnavailableChart,
  ShortageRateBarChart,
  CompositionStackedBar,
  UnavailableQuantityDistribution,
} from "./_components/charts";
import { AlertCircle, ChevronRight, Info } from "lucide-react";

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
  customerDecisionType: null,
  productCategory: null,
  productSearch: null,
  sapItemCode: null,
  decisionCategory: null,
  priority: null,
  recommendationStatus: null,
} as const;

const PERIOD_LABELS: Record<LostSalesAnalyticsPeriod, string> = { day: "Daily", week: "Weekly", month: "Monthly" };

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

  const [analytics, claimReasonAnalytics, filterOptions] = await Promise.all([
    getLostSalesAnalytics(filters, period, pagination),
    getClaimReasonAnalytics(filters),
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
            showCustomerDecisionType
            statusFilter={{
              queryKey: "unfulfilledDemandStatus",
              label: "Demand status",
              options: unfulfilledDemandStatusValues.map((value) => ({ value, label: UNFULFILLED_DEMAND_STATUS_LABELS[value] ?? value })),
            }}
          />

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <MetricCard title="Requested quantity" value={formatQuantity(analytics.kpis.totalRequestedQuantity)} dataQuality="actual" />
            <MetricCard title="Found quantity" value={formatQuantity(analytics.kpis.totalFoundQuantity)} dataQuality="actual" />
            <MetricCard title="Unavailable quantity" value={formatQuantity(analytics.kpis.totalUnavailableQuantity)} dataQuality="actual" />
            <MetricCard title="Outstanding (awaiting supply)" value={formatQuantity(analytics.kpis.totalOutstandingQuantity)} dataQuality="actual" />
            <MetricCard title="Confirmed lost quantity" value={formatQuantity(analytics.kpis.totalConfirmedLostQuantity)} dataQuality="actual" />
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Estimated lost value"
              value={formatQuantity(analytics.kpis.totalEstimatedLostValue)}
              description={
                analytics.kpis.demandsWithoutEstimate > 0
                  ? `${analytics.kpis.demandsWithoutEstimate} demand(s) in scope have no resolvable price and are excluded from this total`
                  : "Every demand in scope had a resolvable price"
              }
              dataQuality={analytics.kpis.demandsWithoutEstimate > 0 ? "provisional" : "calculated"}
            />
            <MetricCard
              title="Confirmed lost value"
              value={formatQuantity(analytics.kpis.totalConfirmedLostValue)}
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

          <SectionCard title="Requested vs. unavailable quantity over time" description="Same unit (quantity), one shared axis -- hover a point for the full product/customer breakdown behind it">
            <RequestedVsUnavailableTrendChart data={analytics.trend} basePath={basePath} baseQuery={baseQuery} />
          </SectionCard>

          <SectionCard title="Estimated lost value over time" description="A different scale (currency) from the quantity trend above -- its own chart, its own axis -- hover a point for the product-contribution table and the estimated-vs-confirmed split">
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

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
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
                        {formatQuantity(row.totalQuantity)} unit(s) -- confirmed value {formatQuantity(row.totalConfirmedValue)}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </SectionCard>
            <SectionCard title="By customer decision" description="CustomerDecisionEvent.decisionType, across every recorded decision in scope -- click a decision type to see its records">
              {analytics.decisionTypeBreakdown.length === 0 ? (
                <EmptyState message="No customer decisions recorded in the selected range." />
              ) : (
                <div className="space-y-4">
                  {analytics.decisionTypeBreakdown.map((row) => (
                    <Link
                      key={row.decisionType}
                      href={buildDrillDownHref(basePath, baseQuery, { customerDecisionType: row.decisionType })}
                      className="-m-1.5 block rounded-lg p-1.5 transition hover:bg-gray-50"
                    >
                      <BarRow
                        label={DECISION_TYPE_LABELS[row.decisionType] ?? row.decisionType}
                        count={row.eventCount}
                        maxCount={Math.max(...analytics.decisionTypeBreakdown.map((r) => r.eventCount))}
                        color="bg-[#1baf7a]"
                      />
                      <p className="mt-1 text-[11px] text-[#9AA59E]">{formatQuantity(row.totalQuantity)} unit(s) across these events</p>
                    </Link>
                  ))}
                </div>
              )}
            </SectionCard>
          </section>

          <SectionCard
            title="Claims by standardised reason"
            description="InvoiceClaimLine.reasonCategory, the 8 standardised claim reasons -- a claim is a customer-reported dispute, never an automatic confirmed loss (see note below)"
          >
            <div className="mb-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
              <Info size={16} className="mt-0.5 shrink-0" />
              <p>
                These figures describe what customers disputed, not confirmed loss -- a Price Claim may resolve via a price correction, a Poor
                Quality Product claim via replacement, a Short Delivered claim via a later fulfilment, and so on. &ldquo;Exposure&rdquo; below is
                the customer&rsquo;s own claimed value (informational only, per invoice line), never summed into the confirmed-lost figures
                above. &ldquo;Resolved&rdquo; means the claim investigation concluded (approved, rejected, or closed) -- not that a financial
                loss was confirmed.
              </p>
            </div>
            {claimReasonAnalytics.byReason.length === 0 ? (
              <EmptyState message="No standardised-reason claim lines match these filters." />
            ) : (
              <div className="space-y-5">
                {claimReasonAnalytics.byReason.map((row) => {
                  const maxCount = Math.max(...claimReasonAnalytics.byReason.map((r) => r.claimLineCount));
                  return (
                    <div key={row.reasonCategory} className="rounded-lg border border-[#EEF1ED] p-4">
                      <BarRow label={row.label} count={row.claimLineCount} maxCount={maxCount} color="bg-[#b8562f]" />
                      <div className="mt-2 grid grid-cols-2 gap-3 text-[11px] text-[#718078] sm:grid-cols-4">
                        <p>{row.distinctClaimCount} claim(s)</p>
                        <p>{formatQuantity(row.claimedQuantity)} unit(s) disputed</p>
                        <p>{row.resolvedCount} resolved / {row.outstandingCount} outstanding</p>
                        <p>
                          {row.informationalExposureByCurrency.length === 0
                            ? "No priced exposure"
                            : row.informationalExposureByCurrency.map((e) => `${e.currency} ${formatQuantity(e.amount)}`).join(" · ")}
                        </p>
                      </div>
                      {(row.topProducts.length > 0 || row.topCustomers.length > 0) && (
                        <div className="mt-3 grid grid-cols-1 gap-4 border-t border-[#F2F4F1] pt-3 sm:grid-cols-2">
                          {row.topProducts.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9AA59E]">Most affected products</p>
                              <ul className="mt-1 space-y-0.5 text-[11px] text-[#17251E]">
                                {row.topProducts.map((p) => (
                                  <li key={`${p.sapItemCode ?? "none"}-${p.description ?? ""}`}>
                                    {p.description ?? p.sapItemCode ?? "Unknown product"} -- {p.claimLineCount} line(s), {formatQuantity(p.claimedQuantity)} unit(s)
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          {row.topCustomers.length > 0 && (
                            <div>
                              <p className="text-[10px] font-semibold uppercase tracking-wide text-[#9AA59E]">Most affected customers</p>
                              <ul className="mt-1 space-y-0.5 text-[11px] text-[#17251E]">
                                {row.topCustomers.map((c) => (
                                  <li key={c.customerId}>
                                    {c.customerName} -- {c.claimLineCount} line(s), {formatQuantity(c.claimedQuantity)} unit(s)
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>

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
                      <th className="px-5 py-3 text-right font-semibold">Lost</th>
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
