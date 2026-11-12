import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSalesPerformanceReport } from "@/lib/reporting/sales-performance";
import { getReportFilterOptions } from "@/lib/reporting/filter-options";
import { parseReportFilters } from "@/lib/reporting/filters";
import { ATTRIBUTION_BUCKET_DEFINITIONS } from "@/lib/reporting/attribution";
import { LOST_SALE_REASON_LABELS } from "@/lib/lost-sales/display";
import { toFlatSearchParams, toURLSearchParams, type ReportSearchParams } from "../_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, MetricCard, EmptyState } from "../_components/ui";
import { ReportFilterBar } from "../_components/filter-bar";
import { AlertCircle } from "lucide-react";

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
  currency: null,
  lostSalesReason: null,
  includeDemo: false,
} as const;

const LOST_SALE_REASON_OPTIONS = Object.entries(LOST_SALE_REASON_LABELS).map(([value, label]) => ({ value, label }));

/**
 * Milestone 12 (Sales Performance Intelligence). Management-only (unlike
 * every M11 operational report page) -- a page-level redirect for
 * SALESPERSON, matching app/reports/management/page.tsx's own precedent
 * exactly. This is a UX convenience, never the security boundary: both
 * app/api/reports/sales-performance/route.ts and its export route
 * enforce the same restriction again, server-side, via
 * lib/reporting/access.ts's requireManagementReportAccess.
 */
export default async function SalesPerformanceReportPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "SALES_MANAGER" && user.role !== "ADMINISTRATOR") {
    redirect("/reports");
  }

  const resolvedSearchParams = await searchParams;
  const flatSearchParams = toFlatSearchParams(resolvedSearchParams);
  const parsed = parseReportFilters(toURLSearchParams(resolvedSearchParams));

  const [report, filterOptions] = await Promise.all([
    getSalesPerformanceReport(parsed.ok ? parsed.filters : EMPTY_FILTERS),
    getReportFilterOptions(),
  ]);

  const salespersonNameById = new Map(report.salespeople.map((s) => [s.id, s.name]));
  const nameFor = (id: string | null) => (id === null ? "Unassigned" : salespersonNameById.get(id) ?? id);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Sales Performance</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Sales Performance Intelligence</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Sales Performance"
            title="Sales Performance Intelligence"
            description={`Salesperson attribution confidence, revenue, customer activity and lost-sales breakdowns, ${report.dateFrom} to ${report.dateTo}. Management-only. Every salesperson figure is qualified by how reliably it is actually attributed -- see the Attribution confidence table below before reading any salesperson's numbers at face value.`}
          />

          {!parsed.ok && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <p>{parsed.message} Showing the default 30-day window instead.</p>
            </div>
          )}

          <ReportFilterBar
            viewAction="/reports/sales-performance"
            exportAction="/api/reports/sales-performance/export"
            searchParams={flatSearchParams}
            customers={filterOptions.customers}
            salespeople={filterOptions.salespeople}
            showSalesperson
            showProduct
            showCurrency
            statusFilter={{ queryKey: "lostSalesReason", label: "Lost sale reason", options: LOST_SALE_REASON_OPTIONS }}
          />

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Orders in scope" value={String(report.attribution.totalOrders)} description="Classified by salesperson-attribution confidence" dataQuality="calculated" />
            <MetricCard title="New customers" value={String(report.customerActivity.newCustomerCount)} description="First qualifying SAP invoice falls in this period" dataQuality="calculated" />
            <MetricCard title="Repeat customers" value={String(report.customerActivity.repeatCustomerCount)} description="Qualifying invoice in period, and an earlier one before it" dataQuality="calculated" />
            <MetricCard title="Lost sales confirmed" value={String(report.lostSales.totalConfirmedCount)} description={`Quantity: ${report.lostSales.totalConfirmedQuantity}`} dataQuality="actual" />
          </section>

          <SectionCard
            title="Attribution confidence"
            description="Every order's salespersonId, classified by how reliably it is actually known -- never inferred from the field's value alone. See docs/milestones/m12-metric-definitions.md for the full definition of each tier."
          >
            {report.attribution.byBucket.every((b) => b.count === 0) ? (
              <EmptyState message="No orders in scope for this filter/date range." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="py-2 pr-4">Tier</th>
                      <th className="py-2 pr-4">Orders</th>
                      <th className="py-2">Definition</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {report.attribution.byBucket.map((row) => (
                      <tr key={row.bucket}>
                        <td className="py-2 pr-4 font-semibold">{row.label}</td>
                        <td className="py-2 pr-4 tabular-nums">{row.count}</td>
                        <td className="py-2 text-xs text-[#718078]">{ATTRIBUTION_BUCKET_DEFINITIONS[row.bucket]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          <SectionCard
            title={`${report.revenue.metricLabel} by currency and salesperson`}
            description="Never summed across currency. Line-level, joined via each SAP invoice line's matched order -- never header-level, so a multi-order invoice is never silently dropped."
          >
            {report.revenue.byCurrency.length === 0 ? (
              <EmptyState message="No invoice lines in scope." />
            ) : (
              <div className="space-y-6">
                {report.revenue.byCurrency.map((currencyRow) => (
                  <div key={currencyRow.currency}>
                    <div className="mb-2 flex items-center justify-between">
                      <p className="text-sm font-bold text-[#17251E]">{currencyRow.currency}</p>
                      <p className="text-sm font-bold tabular-nums text-[#17251E]">
                        {currencyRow.totalLineValue}
                        {currencyRow.excludedLineCount > 0 && <span className="ml-2 text-xs font-normal text-[#A6AFA4]">({currencyRow.excludedLineCount} lines excluded, no line value)</span>}
                      </p>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="text-[11px] uppercase tracking-wide text-[#849087]">
                          <tr>
                            <th className="py-2 pr-4">Salesperson</th>
                            <th className="py-2 pr-4">Orders</th>
                            <th className="py-2">Total value</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EEF1ED]">
                          {currencyRow.bySalesperson.map((row) => (
                            <tr key={row.salespersonId ?? "unassigned"}>
                              <td className="py-2 pr-4">{nameFor(row.salespersonId)}</td>
                              <td className="py-2 pr-4 tabular-nums">{row.orderCount}</td>
                              <td className="py-2 tabular-nums">{row.lineValueTotal}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Lost sales by salesperson" description="Confirmed lost sales, anchored on confirmation date -- not the original demand date">
              {report.lostSales.bySalesperson.length === 0 ? (
                <EmptyState message="No confirmed lost sales in scope." />
              ) : (
                <div className="divide-y divide-[#EEF1ED]">
                  {report.lostSales.bySalesperson.map((row) => (
                    <div key={row.salespersonId ?? "unassigned"} className="flex items-center justify-between gap-4 py-3">
                      <p className="text-sm font-medium text-[#17251E]">{row.salespersonName}</p>
                      <div className="text-right">
                        <p className="text-sm font-bold tabular-nums text-[#17251E]">{row.confirmedCount}</p>
                        <p className="text-[11px] text-[#849087]">Qty: {row.confirmedQuantity}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {report.lostSales.estimatedValueByCurrency.length > 0 && (
                <div className="mt-4 border-t border-[#EEF1ED] pt-4 text-xs text-[#849087]">
                  Estimated value (not an authoritative SAP figure), never summed across currency:
                  {report.lostSales.estimatedValueByCurrency.map((row) => (
                    <span key={row.currency} className="ml-2 font-semibold text-[#17251E]">
                      {row.currency} {row.totalEstimatedValue}
                    </span>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="Quotation-to-order conversion by salesperson" description="Reuses the exact cohort/rate math from Reports / Sales Pipeline, run per salesperson">
              {report.pipelineBySalesperson.length === 0 ? (
                <EmptyState message="No active salespeople, or none with activity in scope." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-[#849087]">
                      <tr>
                        <th className="py-2 pr-4">Salesperson</th>
                        <th className="py-2 pr-4">Quotations</th>
                        <th className="py-2 pr-4">Accept. rate</th>
                        <th className="py-2">Order approval rate</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF1ED]">
                      {report.pipelineBySalesperson.map((row) => (
                        <tr key={row.salespersonId}>
                          <td className="py-2 pr-4">{row.salespersonName}</td>
                          <td className="py-2 pr-4 tabular-nums">{row.quotationsIssued}</td>
                          <td className="py-2 pr-4 tabular-nums">{row.quotationAcceptanceRatePercent === null ? "—" : `${row.quotationAcceptanceRatePercent}%`}</td>
                          <td className="py-2 tabular-nums">{row.orderApprovalRatePercent === null ? "—" : `${row.orderApprovalRatePercent}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </section>

          <div className="flex items-center justify-between rounded-xl border border-[#E6EBE5] bg-white p-4 text-xs text-[#849087]">
            <p>
              New/repeat customer classification is whole-business (never split by salesperson -- a SAP invoice can span multiple SalesFlow orders with different salespeople, so there is no single
              owner to attribute it to).
            </p>
            <Link href="/reports/management" className="font-semibold text-[#173D2E] hover:text-[#28583F]">
              Drill into named management reports →
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
