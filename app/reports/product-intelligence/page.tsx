import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getProductIntelligenceOverview } from "@/lib/reporting/product-insights-queries";
import { parseReportFilters, parsePagination, REPORT_DEFAULT_PAGE_SIZE } from "@/lib/reporting/filters";
import { toFlatSearchParams, toURLSearchParams, type ReportSearchParams } from "../_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, EmptyState, Pagination } from "../_components/ui";
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

const MASTER_DATA_ISSUE_LABELS: Record<string, string> = {
  unmatched: "No Product master row",
  incomplete_category: "Matched, but no category recorded",
};

/**
 * Milestone 14 (Product Intelligence). Management overview -- a
 * page-level redirect for SALESPERSON here is a UX convenience only, same
 * precedent as app/reports/customer-intelligence/page.tsx. The real
 * control is server-side in app/api/reports/product-intelligence/route.ts
 * (and its export sibling), via lib/reporting/access.ts's
 * requireManagementReportAccess.
 *
 * Every spec section 4.B dimension is rendered as its OWN table, under
 * its own heading -- never merged into one ranked row set or a composite
 * score. Only the largest dimension (items 1-4, one row per product with
 * period activity) is paginated for the screen; see
 * lib/reporting/product-insights-queries.ts's own comment for why the
 * other nine are returned and rendered in full.
 */
export default async function ProductIntelligenceOverviewPage({ searchParams }: RouteParams) {
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

  const report = await getProductIntelligenceOverview(filters);

  const totalItems = report.revenueQuantityFrequencyCustomers.rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pagination.pageSize));
  const start = (pagination.page - 1) * pagination.pageSize;
  const pagedRows = report.revenueQuantityFrequencyCustomers.rows.slice(start, start + pagination.pageSize);

  const basePath = "/reports/product-intelligence";

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Product Intelligence</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Product Intelligence</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Product Intelligence"
            title="Product Intelligence"
            description={`Ten independent product rankings, ${report.periodFrom} to ${report.periodTo}${report.previousPeriodFrom ? ` (preceding period: ${report.previousPeriodFrom} to ${report.previousPeriodTo})` : ""}. Management-only. No composite score, no invented product tiers -- each dimension stands on its own.`}
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

          <ReportFilterBar
            viewAction={basePath}
            exportAction="/api/reports/product-intelligence/export"
            searchParams={flatSearchParams}
            customers={[]}
            salespeople={[]}
            showCustomer={false}
            showProduct={false}
            showSalesperson={false}
            showCurrency
            showSapItemCode
            showProductCategory
            showProductSearch
          />

          {/* --- Items 1-4: value, quantity, frequency, distinct customers --- */}
          <SectionCard title="Sales performance" description={`${totalItems} product(s) with qualifying invoice activity in the selected period. ${report.metricLabel} is ranked separately per currency; quantity is ranked separately per unit of measure.`}>
            {pagedRows.length === 0 ? (
              <EmptyState message="No products match these filters." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold">{report.metricLabel} by currency (rank)</th>
                      <th className="px-5 py-3 font-semibold">Quantity by unit (rank)</th>
                      <th className="px-5 py-3 font-semibold">Invoice frequency (rank)</th>
                      <th className="px-5 py-3 font-semibold">Distinct customers (rank)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {pagedRows.map((row) => (
                      <tr key={row.sapItemCode} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          {row.productId ? (
                            <Link href={`/products/${row.productId}`} className="font-semibold text-[#173D2E] hover:underline">
                              {row.sapItemCode}
                            </Link>
                          ) : (
                            <span className="font-semibold text-[#17251E]">{row.sapItemCode}</span>
                          )}
                          <p className="text-xs text-[#849087]">{row.description ?? "—"}</p>
                        </td>
                        <td className="px-5 py-3 text-[#536158]">{row.revenueByCurrency.length === 0 ? "—" : row.revenueByCurrency.map((r) => `${r.currency} ${r.lineValueTotal} (#${r.rank})`).join(" · ")}</td>
                        <td className="px-5 py-3 text-[#536158]">{row.quantityByUnit.length === 0 ? "—" : row.quantityByUnit.map((q) => `${q.quantityTotal} ${q.unitOfMeasure} (#${q.rank})`).join(" · ")}</td>
                        <td className="px-5 py-3 tabular-nums">
                          {row.invoiceFrequencyInPeriod} (#{row.invoiceFrequencyRank})
                        </td>
                        <td className="px-5 py-3 tabular-nums">
                          {row.distinctCustomerCountInPeriod} (#{row.distinctCustomerCountRank})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination basePath={basePath} searchParams={flatSearchParams} page={pagination.page} totalPages={totalPages} totalItems={totalItems} pageSize={pagination.pageSize} />
          </SectionCard>

          {/* --- Item 5: lost sales --- */}
          <SectionCard title="Highest lost-sales activity" description={`${report.lostSalesActivity.rows.length} product(s) with a confirmed lost sale in the selected period.`}>
            {report.lostSalesActivity.rows.length === 0 ? (
              <EmptyState message="No confirmed lost sales in the selected period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Rank</th>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold">Confirmed lost sales</th>
                      <th className="px-5 py-3 font-semibold">Confirmed lost quantity</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {report.lostSalesActivity.rows.map((row) => (
                      <tr key={row.sapItemCode} className="hover:bg-gray-50">
                        <td className="px-5 py-3 tabular-nums font-semibold">#{row.rank}</td>
                        <td className="px-5 py-3">
                          {row.productId ? <Link href={`/products/${row.productId}`} className="font-semibold text-[#173D2E] hover:underline">{row.sapItemCode}</Link> : row.sapItemCode}
                        </td>
                        <td className="px-5 py-3 tabular-nums">{row.confirmedLostSaleCount}</td>
                        <td className="px-5 py-3 text-[#536158]">{row.confirmedLostSaleQuantityTotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* --- Item 6: claims and returns --- */}
          <SectionCard
            title="Highest claim & return activity"
            description={`${report.claimAndReturnActivity.rows.length} product(s) touched by at least one claim in the selected population. ${report.claimAndReturnActivity.multiProductClaimCount} claim(s) span more than one product and are counted toward every product they touch (claimCount), but excluded from returnCount's single-product-claim basis.`}
          >
            {report.claimAndReturnActivity.rows.length === 0 ? (
              <EmptyState message="No claims recorded." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Rank</th>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold">Claims (inclusive)</th>
                      <th className="px-5 py-3 font-semibold">Returns (single-product claims)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {report.claimAndReturnActivity.rows.map((row) => (
                      <tr key={row.sapItemCode} className="hover:bg-gray-50">
                        <td className="px-5 py-3 tabular-nums font-semibold">#{row.rank}</td>
                        <td className="px-5 py-3">
                          {row.productId ? <Link href={`/products/${row.productId}`} className="font-semibold text-[#173D2E] hover:underline">{row.sapItemCode}</Link> : row.sapItemCode}
                        </td>
                        <td className="px-5 py-3 tabular-nums">{row.claimCount}</td>
                        <td className="px-5 py-3 tabular-nums">{row.returnCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* --- Item 7: credit notes --- */}
          <SectionCard
            title="Highest actual credit-note values"
            description={`By currency, single-product-attributable notes only. ${report.creditNoteValue.unattributableCreditNoteCount} credit note(s) exist but span more than one product and are excluded here, never guessed or split.`}
          >
            {report.creditNoteValue.rows.length === 0 ? (
              <EmptyState message="No attributable credit notes in the selected period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Rank</th>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold">Currency</th>
                      <th className="px-5 py-3 font-semibold">Credit-note value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {report.creditNoteValue.rows.map((row) => (
                      <tr key={`${row.sapItemCode}-${row.currency}`} className="hover:bg-gray-50">
                        <td className="px-5 py-3 tabular-nums font-semibold">#{row.rank}</td>
                        <td className="px-5 py-3 font-semibold text-[#17251E]">{row.sapItemCode}</td>
                        <td className="px-5 py-3">{row.currency}</td>
                        <td className="px-5 py-3 text-[#536158]">{row.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* --- Item 8: delivery rejections --- */}
          <SectionCard title="Highest recorded delivery rejection quantities" description="Line-level DeliveryLine.rejectedQuantity only -- never the header-level DeliveryRecord.outcome, which can span several products in one shipment.">
            {report.deliveryRejections.rows.length === 0 ? (
              <EmptyState message="No recorded delivery rejections in the selected period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Rank</th>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold">Rejection lines</th>
                      <th className="px-5 py-3 font-semibold">Rejected quantity by unit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {report.deliveryRejections.rows.map((row) => (
                      <tr key={row.sapItemCode} className="hover:bg-gray-50">
                        <td className="px-5 py-3 tabular-nums font-semibold">#{row.rank}</td>
                        <td className="px-5 py-3">
                          {row.productId ? <Link href={`/products/${row.productId}`} className="font-semibold text-[#173D2E] hover:underline">{row.sapItemCode}</Link> : row.sapItemCode}
                        </td>
                        <td className="px-5 py-3 tabular-nums">{row.deliveryLinesWithRejectionCount}</td>
                        <td className="px-5 py-3 text-[#536158]">{row.rejectedQuantityByUnit.map((q) => `${q.quantityTotal} ${q.unitOfMeasure}`).join(" · ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* --- Item 9: declining activity --- */}
          <SectionCard
            title="Declining invoice activity"
            description={report.previousPeriodFrom ? `Compared with the immediately preceding period of equal duration (${report.previousPeriodFrom} to ${report.previousPeriodTo}), per currency.` : "The preceding period could not be computed for this date range."}
          >
            {report.decliningActivity.rows.length === 0 ? (
              <EmptyState message="No products show a decline against the preceding period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Rank</th>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold">Currency</th>
                      <th className="px-5 py-3 font-semibold">Previous period</th>
                      <th className="px-5 py-3 font-semibold">Current period</th>
                      <th className="px-5 py-3 font-semibold">Decline</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {report.decliningActivity.rows.map((row) => (
                      <tr key={`${row.sapItemCode}-${row.currency}`} className="hover:bg-gray-50">
                        <td className="px-5 py-3 tabular-nums font-semibold">#{row.rank}</td>
                        <td className="px-5 py-3">
                          {row.productId ? <Link href={`/products/${row.productId}`} className="font-semibold text-[#173D2E] hover:underline">{row.sapItemCode}</Link> : row.sapItemCode}
                        </td>
                        <td className="px-5 py-3">{row.currency}</td>
                        <td className="px-5 py-3 text-[#536158]">{row.previousPeriodValue}</td>
                        <td className="px-5 py-3 text-[#536158]">{row.currentPeriodValue}</td>
                        <td className="px-5 py-3 font-semibold text-[#A3372B]">-{row.declineAmount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* --- Item 10: master data quality --- */}
          <SectionCard title="Incomplete or unmatched master data" description="A SAP item code with real invoice activity but no Product master row, or a matched product with no recorded category -- never hidden.">
            {report.masterDataQuality.rows.length === 0 ? (
              <EmptyState message="No master-data issues found for products with activity in the selected period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Product</th>
                      <th className="px-5 py-3 font-semibold">Issue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {report.masterDataQuality.rows.map((row) => (
                      <tr key={row.sapItemCode} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          {row.productId ? <Link href={`/products/${row.productId}`} className="font-semibold text-[#173D2E] hover:underline">{row.sapItemCode}</Link> : <span className="font-semibold text-[#17251E]">{row.sapItemCode}</span>}
                        </td>
                        <td className="px-5 py-3 text-[#536158]">{MASTER_DATA_ISSUE_LABELS[row.issue] ?? row.issue}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-[#9AA59E]">
              {report.masterDataQuality.unmatchedCount} unmatched · {report.masterDataQuality.incompleteCategoryCount} matched but missing a category.
            </p>
          </SectionCard>

          <p className="text-xs leading-5 text-[#9AA59E]">
            Every dimension above is ranked independently and never merged into a composite score or tier. A product absent from a currency&apos;s ranking simply has no activity in that currency -- it
            is never ranked against zero.
          </p>
        </div>
      </main>
    </div>
  );
}
