import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDecisionIntelligencePageData, type DecisionRecommendationRow } from "@/lib/reporting/decision-intelligence-queries";
import { parseReportFilters, parsePagination, REPORT_DEFAULT_PAGE_SIZE } from "@/lib/reporting/filters";
import type { DecisionCategory, DecisionPriority, DecisionConfidence, DecisionRecommendationStatus } from "@/lib/reporting/decision-types";
import { toFlatSearchParams, toURLSearchParams, type ReportSearchParams } from "../_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, MetricCard, EmptyState, Pagination, BarRow } from "../_components/ui";
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

const CATEGORY_LABELS: Record<DecisionCategory, string> = {
  SALES: "Sales",
  CUSTOMER: "Customer",
  PRODUCT: "Product",
  COMMERCIAL_EXPOSURE: "Commercial exposure",
  OPERATIONAL: "Operational",
};

const PRIORITY_LABELS: Record<DecisionPriority, string> = {
  CRITICAL: "Critical",
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INFORMATIONAL: "Informational",
};

const PRIORITY_BADGE_STYLES: Record<DecisionPriority, string> = {
  CRITICAL: "bg-red-50 text-red-700",
  HIGH: "bg-amber-50 text-amber-700",
  MEDIUM: "bg-cyan-50 text-cyan-700",
  LOW: "bg-gray-100 text-gray-600",
  INFORMATIONAL: "bg-gray-50 text-gray-400",
};

const CONFIDENCE_LABELS: Record<DecisionConfidence, string> = {
  HIGH: "High",
  MEDIUM: "Medium",
  LOW: "Low",
  INSUFFICIENT_DATA: "Insufficient data",
};

const CONFIDENCE_BADGE_STYLES: Record<DecisionConfidence, string> = {
  HIGH: "bg-emerald-50 text-emerald-700",
  MEDIUM: "bg-cyan-50 text-cyan-700",
  LOW: "bg-amber-50 text-amber-700",
  INSUFFICIENT_DATA: "bg-gray-100 text-gray-500",
};

const STATUS_LABELS: Record<DecisionRecommendationStatus, string> = {
  OPEN: "Open",
  ACKNOWLEDGED: "Acknowledged",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

const STATUS_BADGE_STYLES: Record<DecisionRecommendationStatus, string> = {
  OPEN: "bg-amber-50 text-amber-700",
  ACKNOWLEDGED: "bg-cyan-50 text-cyan-700",
  IN_PROGRESS: "bg-blue-50 text-blue-700",
  RESOLVED: "bg-emerald-50 text-emerald-700",
  DISMISSED: "bg-gray-100 text-gray-500",
};

function Badge({ label, className }: { label: string; className: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold ${className}`}>{label}</span>;
}

/** The one or two "related to" facts a row carries, rendered compactly -- never more than what the row actually has (never a fabricated relation). */
function relatedSummary(row: DecisionRecommendationRow): string {
  const parts: string[] = [];
  if (row.customerName) parts.push(row.customerName);
  if (row.sapItemCode) parts.push(row.sapItemCode);
  if (row.salespersonName) parts.push(row.salespersonName);
  if (row.customerOrderReference) parts.push(`Order ${row.customerOrderReference}`);
  if (row.currencyCode) parts.push(row.currencyCode);
  return parts.length > 0 ? parts.join(" · ") : "—";
}

/**
 * Milestone 15 (Decision Intelligence). Management overview -- a
 * page-level redirect for SALESPERSON here is a UX convenience only,
 * same precedent as every other M12-M14 report page. The real control
 * is server-side in app/api/reports/decision-intelligence/route.ts
 * (and every sibling route under it), via
 * lib/reporting/access.ts's requireManagementReportAccess.
 *
 * Renders the executive decision summary (3.1), the priority attention
 * queue (3.2), and the full filterable/paginated recommendation list
 * (spec section 9) in one page, using
 * getDecisionIntelligencePageData so the rule catalogue is evaluated
 * and synced exactly once per page load rather than twice.
 */
export default async function DecisionIntelligenceOverviewPage({ searchParams }: RouteParams) {
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

  const { overview, list } = await getDecisionIntelligencePageData(filters, pagination, { id: user.id, role: user.role });

  const basePath = "/reports/decision-intelligence";
  const maxCategoryCount = Math.max(1, ...Object.values(overview.summary.byCategory));
  const maxPriorityCount = Math.max(1, ...Object.values(overview.summary.byPriority));
  const maxConfidenceCount = Math.max(1, ...Object.values(overview.summary.byConfidence));

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Decision Intelligence</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Decision Intelligence</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Decision Intelligence"
            title="Decision Intelligence"
            description={`${overview.summary.totalRecommendations} open recommendation(s) from deterministic, explainable rules over ${overview.period.from} to ${overview.period.to}. Every recommendation is traceable to real source records -- never LLM-generated, never a fabricated figure. ${overview.dataFreshnessNote}`}
            actions={
              <Link href="/reports" className="text-sm font-semibold text-[#718078] hover:text-[#17251E]">
                &larr; All reports
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
            exportAction="/api/reports/decision-intelligence/recommendations/export"
            searchParams={flatSearchParams}
            customers={[]}
            salespeople={[]}
            showCustomer
            showProduct
            showSalesperson
            showCurrency
            showDecisionCategory
            showPriority
            showRecommendationStatus
          />

          {/* --- 3.1: executive decision summary --- */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Total recommendations" value={String(overview.summary.totalRecommendations)} description="Matching the current filters" />
            <MetricCard title="Critical + High" value={String(overview.summary.byPriority.CRITICAL + overview.summary.byPriority.HIGH)} description="In the priority attention queue below" />
            <MetricCard title="High confidence" value={String(overview.summary.byConfidence.HIGH)} description="Directly supported by verified source data" />
            <MetricCard title="Insufficient data" value={String(overview.summary.byConfidence.INSUFFICIENT_DATA)} description="Flagged rather than guessed" />
          </section>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <SectionCard title="By decision category" description="Spec sections 3.3-3.7">
              <div className="space-y-3">
                {(Object.keys(overview.summary.byCategory) as DecisionCategory[]).map((c) => (
                  <BarRow key={c} label={CATEGORY_LABELS[c]} count={overview.summary.byCategory[c]} maxCount={maxCategoryCount} color="bg-[#78964A]" />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="By priority" description="Documented, rule-based bands -- never intuition">
              <div className="space-y-3">
                {(Object.keys(overview.summary.byPriority) as DecisionPriority[]).map((p) => (
                  <BarRow key={p} label={PRIORITY_LABELS[p]} count={overview.summary.byPriority[p]} maxCount={maxPriorityCount} color={p === "CRITICAL" ? "bg-red-500" : p === "HIGH" ? "bg-amber-500" : "bg-[#78964A]"} />
                ))}
              </div>
            </SectionCard>

            <SectionCard title="By confidence" description="Each rule's basis is documented in its own evidence">
              <div className="space-y-3">
                {(Object.keys(overview.summary.byConfidence) as DecisionConfidence[]).map((c) => (
                  <BarRow key={c} label={CONFIDENCE_LABELS[c]} count={overview.summary.byConfidence[c]} maxCount={maxConfidenceCount} color="bg-[#78964A]" />
                ))}
              </div>
            </SectionCard>
          </div>

          {/* --- 3.2: priority attention queue --- */}
          <SectionCard title="Priority attention queue" description="CRITICAL and HIGH priority recommendations only, sorted priority-first then most-recently-detected.">
            {overview.priorityQueue.length === 0 ? (
              <EmptyState message="No CRITICAL or HIGH priority recommendations right now." />
            ) : (
              <ul className="divide-y divide-[#EEF1ED]">
                {overview.priorityQueue.map((row) => (
                  <li key={row.id} className="flex items-start justify-between gap-4 py-4">
                    <div className="min-w-0">
                      <div className="mb-1 flex items-center gap-2">
                        <Badge label={PRIORITY_LABELS[row.priority]} className={PRIORITY_BADGE_STYLES[row.priority]} />
                        <Badge label={CATEGORY_LABELS[row.decisionCategory]} className="bg-[#F2F6F1] text-[#496A42]" />
                        <Badge label={STATUS_LABELS[row.status]} className={STATUS_BADGE_STYLES[row.status]} />
                      </div>
                      <Link href={`${basePath}/${row.id}`} className="font-semibold text-[#173D2E] hover:underline">
                        {row.title}
                      </Link>
                      <p className="mt-1 text-xs leading-5 text-[#849087]">{row.explanation}</p>
                      <p className="mt-1 text-[11px] text-[#9AA59E]">{relatedSummary(row)}</p>
                    </div>
                    <Link href={`${basePath}/${row.id}`} className="shrink-0 text-xs font-semibold text-[#496A42] hover:underline">
                      View &rarr;
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          {/* --- spec section 9: full recommendation list --- */}
          <SectionCard title="All recommendations" description={`${list.pagination.totalItems} recommendation(s) matching the current filters. Use "Export CSV" above to download this exact filtered set.`}>
            {list.rows.length === 0 ? (
              <EmptyState message="No recommendations match these filters." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Priority</th>
                      <th className="px-5 py-3 font-semibold">Category</th>
                      <th className="px-5 py-3 font-semibold">Title</th>
                      <th className="px-5 py-3 font-semibold">Confidence</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                      <th className="px-5 py-3 font-semibold">Related to</th>
                      <th className="px-5 py-3 font-semibold">Period</th>
                      <th className="px-5 py-3 font-semibold">Detected</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {list.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <Badge label={PRIORITY_LABELS[row.priority]} className={PRIORITY_BADGE_STYLES[row.priority]} />
                        </td>
                        <td className="px-5 py-3 text-[#536158]">{CATEGORY_LABELS[row.decisionCategory]}</td>
                        <td className="px-5 py-3">
                          <Link href={`${basePath}/${row.id}`} className="font-semibold text-[#173D2E] hover:underline">
                            {row.title}
                          </Link>
                        </td>
                        <td className="px-5 py-3">
                          <Badge label={CONFIDENCE_LABELS[row.confidence]} className={CONFIDENCE_BADGE_STYLES[row.confidence]} />
                        </td>
                        <td className="px-5 py-3">
                          <Badge label={STATUS_LABELS[row.status]} className={STATUS_BADGE_STYLES[row.status]} />
                        </td>
                        <td className="px-5 py-3 text-[#536158]">{relatedSummary(row)}</td>
                        <td className="px-5 py-3 text-[#536158]">
                          {row.reportingPeriodFrom} &ndash; {row.reportingPeriodTo}
                        </td>
                        <td className="px-5 py-3 text-[#849087]">{new Date(row.firstDetectedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pagination basePath={basePath} searchParams={flatSearchParams} page={list.pagination.page} totalPages={list.pagination.totalPages} totalItems={list.pagination.totalItems} pageSize={list.pagination.pageSize} />
          </SectionCard>

          {/* --- related surfaces --- */}
          <SectionCard title="Related reports and records" description="Every recommendation links to its own source records on its detail page. These are the surfaces behind this report's own rules.">
            <div className="flex flex-wrap gap-3 text-sm">
              <Link href="/reports/sales-performance" className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold text-[#17251E] hover:bg-gray-50">Sales performance</Link>
              <Link href="/reports/customer-intelligence" className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold text-[#17251E] hover:bg-gray-50">Customer intelligence</Link>
              <Link href="/reports/product-intelligence" className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold text-[#17251E] hover:bg-gray-50">Product intelligence</Link>
              <Link href="/lost-sales" className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold text-[#17251E] hover:bg-gray-50">Lost sales</Link>
              <Link href="/invoice-claims" className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold text-[#17251E] hover:bg-gray-50">Invoice claims</Link>
              <Link href="/returns-credits" className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold text-[#17251E] hover:bg-gray-50">Returns &amp; credit notes</Link>
              <Link href="/quotations" className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold text-[#17251E] hover:bg-gray-50">Quotations</Link>
              <Link href="/orders" className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold text-[#17251E] hover:bg-gray-50">Orders</Link>
              <Link href="/fulfilment" className="rounded-lg border border-[#E1E7E2] px-3 py-1.5 font-semibold text-[#17251E] hover:bg-gray-50">Fulfilment records</Link>
            </div>
          </SectionCard>

          <p className="text-xs leading-5 text-[#9AA59E]">
            Every recommendation is produced by a documented, deterministic rule -- never by free-form AI generation. A rule that lacks the evidence to support a higher confidence level is marked
            INSUFFICIENT_DATA rather than guessed. See each recommendation&apos;s own detail page for its full evidence, source-record references and status history.
          </p>
        </div>
      </main>
    </div>
  );
}
