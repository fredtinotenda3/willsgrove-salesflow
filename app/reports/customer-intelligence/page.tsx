import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCustomerIntelligenceOverview } from "@/lib/reporting/customer-revenue-queries";
import { parseReportFilters, parsePagination, REPORT_DEFAULT_PAGE_SIZE } from "@/lib/reporting/filters";
import { toFlatSearchParams, toURLSearchParams, type ReportSearchParams } from "../_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, MetricCard, EmptyState, Pagination } from "../_components/ui";
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
  productCategory: null,
  productSearch: null,
  sapItemCode: null,
  decisionCategory: null,
  priority: null,
  recommendationStatus: null,
} as const;

/**
 * Milestone 13 (Customer Intelligence). Management overview -- a
 * page-level redirect for SALESPERSON here is a UX convenience only, same
 * precedent as app/reports/sales-performance/page.tsx. The real control is
 * server-side in app/api/reports/customer-intelligence/route.ts (and its
 * export sibling), via lib/reporting/access.ts's requireManagementReportAccess.
 *
 * Rankings are computed and returned in full by getCustomerIntelligenceOverview
 * (no per-customer loop, bounded query count); pagination for the screen
 * is a plain in-memory slice over that already-ranked set, done here --
 * the CSV export deliberately exports every filtered row, never just this
 * page's slice (spec section 15).
 */
export default async function CustomerIntelligenceOverviewPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "SALES_MANAGER" && user.role !== "ADMINISTRATOR") {
    redirect("/reports");
  }

  const resolvedSearchParams = await searchParams;
  const flatSearchParams = toFlatSearchParams(resolvedSearchParams);
  const urlSearchParams = toURLSearchParams(resolvedSearchParams);
  const parsedFilters = parseReportFilters(urlSearchParams);
  const parsedPagination = parsePagination(urlSearchParams);

  const filters = parsedFilters.ok ? parsedFilters.filters : EMPTY_FILTERS;
  const pagination = parsedPagination.ok ? parsedPagination.pagination : { page: 1, pageSize: REPORT_DEFAULT_PAGE_SIZE };

  // Milestone 13 default: OFF -- every eligible customer is shown,
  // including those with zero qualifying invoices in the selected
  // period, unless the manager explicitly turns this on. See
  // lib/reporting/customer-revenue-queries.ts's own comment for why.
  const minimumActivityOnly = urlSearchParams.get("minimumActivityOnly") === "true";

  const report = await getCustomerIntelligenceOverview(filters, minimumActivityOnly);

  const totalItems = report.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
  const start = (pagination.page - 1) * pagination.pageSize;
  const pagedRows = report.rows.slice(start, start + pagination.pageSize);

  const basePath = "/reports/customer-intelligence";
  const toggleHref = (value: boolean) => {
    const params = new URLSearchParams(flatSearchParams);
    params.set("minimumActivityOnly", String(value));
    params.delete("page");
    return `${basePath}?${params.toString()}`;
  };

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Customer Intelligence</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Customer Intelligence</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Customer Intelligence"
            title="Customer Intelligence"
            description={`Independent rankings by ${report.metricLabel.toLowerCase()} (within each currency, never combined), purchase frequency and recency, ${report.periodFrom} to ${report.periodTo} -- as-of ${report.asOfDate}. Management-only. No composite score or tier: a USD customer is never ranked against a ZWG customer, and there is no churn label or percentile segmentation in this milestone.`}
            actions={
              <Link href="/reports/management" className="text-sm font-semibold text-[#718078] hover:text-[#17251E]">
                &larr; All management reports
              </Link>
            }
          />

          {(!parsedFilters.ok || !parsedPagination.ok) && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <p>{(!parsedFilters.ok && parsedFilters.message) || (!parsedPagination.ok && parsedPagination.message)} Showing the default view instead.</p>
            </div>
          )}

          <ReportFilterBar viewAction={basePath} exportAction="/api/reports/customer-intelligence/export" searchParams={flatSearchParams} customers={[]} salespeople={[]} showCustomer={false} showCurrency />

          <div className="flex items-center gap-2 rounded-2xl border border-[#E7ECE7] bg-white p-3 shadow-sm">
            <span className="px-2 text-xs font-semibold text-[#718078]">Population</span>
            <Link href={toggleHref(false)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${!minimumActivityOnly ? "bg-[#183B2D] text-white" : "text-[#536158] hover:bg-gray-50"}`}>
              All eligible customers
            </Link>
            <Link href={toggleHref(true)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${minimumActivityOnly ? "bg-[#183B2D] text-white" : "text-[#536158] hover:bg-gray-50"}`}>
              Only active in period
            </Link>
            <span className="ml-2 text-xs text-[#9AA59E]">
              Default: all eligible customers, including those with zero qualifying invoices in the selected period.
            </span>
          </div>

          <SectionCard title="Data quality for this population" description="Unmatched/no-usable-date counts, reusing the exact Milestone 12 definitions -- never silently discarded.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard title="Unattributed invoices" value={String(report.dataQuality.unattributedInvoiceCount)} dataQuality="missing" />
              <MetricCard title={`Unattributed ${report.dataQuality.unattributedInvoiceValueLabel.toLowerCase()}`} value={report.dataQuality.unattributedInvoiceValue} dataQuality="missing" />
              <MetricCard title="Invoices with no usable date" value={String(report.dataQuality.invoicesWithNoUsableDateCount)} dataQuality="missing" />
            </div>
          </SectionCard>

          <SectionCard title="Customer rankings" description={`${totalItems} customer(s) in this population`}>
            {pagedRows.length === 0 ? (
              <EmptyState message="No customers match these filters." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Customer</th>
                      <th className="px-5 py-3 font-semibold">{report.metricLabel} by currency (rank within currency)</th>
                      <th className="px-5 py-3 font-semibold">Purchase frequency (rank)</th>
                      <th className="px-5 py-3 font-semibold">Days since last qualifying invoice (rank)</th>
                      <th className="px-5 py-3 font-semibold">Open claims (calculated, as of {report.asOfDate})</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {pagedRows.map((row) => (
                      <tr key={row.customerId} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <Link href={`/customers/${row.customerId}`} className="font-semibold text-[#173D2E] hover:underline">
                            {row.customerName}
                          </Link>
                        </td>
                        <td className="px-5 py-3 text-[#536158]">
                          {row.revenueByCurrency.length === 0 ? "—" : row.revenueByCurrency.map((r) => `${r.currency} ${r.lineValueTotal} (#${r.rank})`).join(" · ")}
                        </td>
                        <td className="px-5 py-3 tabular-nums">
                          {row.purchaseFrequencyInPeriod} (#{row.purchaseFrequencyRank})
                        </td>
                        <td className="px-5 py-3 tabular-nums">
                          {row.daysSinceLastQualifyingInvoice === null ? "No qualifying invoice on record" : `${row.daysSinceLastQualifyingInvoice} day(s)${row.daysSinceLastQualifyingInvoiceRank !== null ? ` (#${row.daysSinceLastQualifyingInvoiceRank})` : ""}`}
                        </td>
                        <td className="px-5 py-3 tabular-nums">{row.openClaimsCountAsOfReportingDate}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination basePath={basePath} searchParams={flatSearchParams} page={pagination.page} totalPages={totalPages} totalItems={totalItems} pageSize={pagination.pageSize} />
          </SectionCard>

          <p className="text-xs leading-5 text-[#9AA59E]">
            Rankings are independent per dimension and never merged into a composite score or tier. A customer absent from a currency&apos;s revenue ranking simply has no activity in that currency --
            it is never ranked against zero.
          </p>
        </div>
      </main>
    </div>
  );
}
