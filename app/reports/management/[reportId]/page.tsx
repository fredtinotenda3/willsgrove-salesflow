import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import {
  MANAGEMENT_REPORT_CATALOGUE,
  isManagementReportId,
  runManagementReport,
  LIST_REPORT_CSV_COLUMNS,
  type ManagementReportId,
  type OperationalSummaryPeriod,
} from "@/lib/reporting/management-reports";
import { flattenToKeyValueRows } from "@/lib/reporting/export-csv";
import { getReportFilterOptions } from "@/lib/reporting/filter-options";
import { parseReportFilters, parsePagination, REPORT_DEFAULT_PAGE_SIZE } from "@/lib/reporting/filters";
import { ORDER_STATUSES, ORDER_STATUS_LABELS } from "@/lib/order-display";
import { toFlatSearchParams, toURLSearchParams, type ReportSearchParams } from "../../_components/search-params";
import Sidebar from "../../../components/sidebar";
import { PageHeader, SectionCard, Pagination, EmptyState } from "../../_components/ui";
import { ReportFilterBar, type StatusFilterConfig } from "../../_components/filter-bar";
import { AlertCircle } from "lucide-react";

export const instant = false;

type RouteParams = {
  params: Promise<{ reportId: string }>;
  searchParams: Promise<ReportSearchParams>;
};

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
  productCategory: null,
  productSearch: null,
  sapItemCode: null,
  decisionCategory: null,
  priority: null,
  recommendationStatus: null,
} as const;

const VALID_PERIODS: OperationalSummaryPeriod[] = ["daily", "weekly", "monthly"];
const PERIOD_LABELS: Record<OperationalSummaryPeriod, string> = { daily: "Daily", weekly: "Weekly", monthly: "Monthly" };

const PICKING_SESSION_STATUS_OPTIONS = [
  { value: "IN_PROGRESS", label: "In Progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "AUTHORIZED", label: "Authorized" },
];

const DELIVERY_OUTCOME_OPTIONS = [
  { value: "ACCEPTED_IN_FULL", label: "Accepted in Full" },
  { value: "PARTIALLY_REJECTED", label: "Partially Rejected" },
  { value: "FULLY_REJECTED", label: "Fully Rejected" },
];

const ORDER_STATUS_OPTIONS = ORDER_STATUSES.map((s) => ({ value: s, label: ORDER_STATUS_LABELS[s] }));

/**
 * Which filter-bar fields actually have effect on each report -- kept as
 * one lookup here rather than letting each branch improvise, so the bar
 * shown always matches what lib/reporting/management-reports.ts actually
 * applies for that report id. `note` is shown under the filter bar for
 * any report where a filter the bar still displays (date range is always
 * shown by ReportFilterBar itself) does NOT fully apply -- the same
 * "never silently do nothing" principle as the pipeline/fulfilment/
 * financial-exposure pages' own footer notes.
 */
const REPORT_FILTER_CONFIG: Record<
  ManagementReportId,
  { showSalesperson: boolean; showProduct: boolean; statusFilter?: StatusFilterConfig; note?: string }
> = {
  "operational-summary": {
    showSalesperson: true,
    showProduct: true,
    note: "Pick a period below instead of a date range -- this report always summarizes today ± the chosen period, ignoring the From/To fields.",
  },
  "outstanding-orders": {
    showSalesperson: true,
    showProduct: false,
    statusFilter: { queryKey: "orderStatus", label: "Order status", options: ORDER_STATUS_OPTIONS },
  },
  "awaiting-fulfilment": {
    showSalesperson: true,
    showProduct: false,
    statusFilter: { queryKey: "orderStatus", label: "Order status", options: ORDER_STATUS_OPTIONS },
    note: "This report is already scoped to APPROVED/PICKING orders -- picking any other order status here correctly returns no rows rather than widening the scope.",
  },
  "picking-shortages": {
    showSalesperson: true,
    showProduct: true,
    statusFilter: { queryKey: "fulfilmentStatus", label: "Picking session status", options: PICKING_SESSION_STATUS_OPTIONS },
  },
  "delivery-exceptions": {
    showSalesperson: true,
    showProduct: false,
    statusFilter: { queryKey: "fulfilmentStatus", label: "Delivery outcome", options: DELIVERY_OUTCOME_OPTIONS },
    note: "This report is already scoped to rejected deliveries -- selecting \"Accepted in Full\" here correctly returns no rows.",
  },
  "quotations-performance": {
    showSalesperson: true,
    showProduct: true,
    note: "Filters apply only to the period-scoped funnel figures below -- the all-time quotation totals are whole-business and unaffected by any filter here.",
  },
  "lost-sales": {
    showSalesperson: false,
    showProduct: false,
    note: "Only \"include demo records\" applies to this report -- it is a whole-business, right-now total, not date/customer/product filtered (reused as-is from the Milestone 4 lost-sales summary).",
  },
  "invoice-claims-exposure": {
    showSalesperson: false,
    showProduct: false,
    note: "The claims and reconciliation figures are whole-business, right-now totals and unaffected by date or customer here -- only the returns & credit notes figures honor them.",
  },
  "communication-failures": {
    showSalesperson: false,
    showProduct: false,
    note: "No status filter is offered -- this report's identity is already fixed to failed outbound messages.",
  },
};

function formatMetricLabel(path: string): string {
  return path
    .split(".")
    .map((segment) =>
      segment
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/^./, (c) => c.toUpperCase())
    )
    .join(" › ");
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return value.length === 0 ? "—" : value.join("; ");
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
  }
  return String(value);
}

/** Which key on a list report's own row carries the CustomerOrder id to drill into, if any -- not every list report's rows link to an order. */
const ORDER_DRILLDOWN_KEY: Partial<Record<ManagementReportId, string>> = {
  "outstanding-orders": "id",
  "awaiting-fulfilment": "id",
  "picking-shortages": "orderId",
  "delivery-exceptions": "orderId",
};

export default async function ManagementReportDetailPage({ params, searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }
  if (user.role !== "SALES_MANAGER" && user.role !== "ADMINISTRATOR") {
    redirect("/reports");
  }

  const { reportId } = await params;
  if (!isManagementReportId(reportId)) {
    notFound();
  }

  const catalogueEntry = MANAGEMENT_REPORT_CATALOGUE.find((r) => r.id === reportId)!;
  const config = REPORT_FILTER_CONFIG[reportId];

  const resolvedSearchParams = await searchParams;
  const flatSearchParams = toFlatSearchParams(resolvedSearchParams);
  const urlSearchParams = toURLSearchParams(resolvedSearchParams);
  const parsedFilters = parseReportFilters(urlSearchParams);
  const parsedPagination = parsePagination(urlSearchParams);

  const rawPeriod = urlSearchParams.get("period");
  const period: OperationalSummaryPeriod = VALID_PERIODS.includes(rawPeriod as OperationalSummaryPeriod) ? (rawPeriod as OperationalSummaryPeriod) : "daily";

  const filters = parsedFilters.ok ? parsedFilters.filters : EMPTY_FILTERS;
  const pagination = parsedPagination.ok ? parsedPagination.pagination : { page: 1, pageSize: REPORT_DEFAULT_PAGE_SIZE };

  const [result, filterOptions] = await Promise.all([runManagementReport(reportId, filters, pagination, period), getReportFilterOptions()]);

  const basePath = `/reports/management/${reportId}`;

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Management Reports / {catalogueEntry.name}</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">{catalogueEntry.name}</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb={`Reports / Management Reports / ${catalogueEntry.name}`}
            title={catalogueEntry.name}
            description={catalogueEntry.description}
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

          {reportId === "operational-summary" && (
            <div className="flex items-center gap-2 rounded-2xl border border-[#E7ECE7] bg-white p-3 shadow-sm">
              <span className="px-2 text-xs font-semibold text-[#718078]">Period</span>
              {VALID_PERIODS.map((p) => (
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
          )}

          <ReportFilterBar
            viewAction={basePath}
            exportAction={`/api/reports/management/${reportId}/export`}
            searchParams={flatSearchParams}
            customers={filterOptions.customers}
            salespeople={filterOptions.salespeople}
            showSalesperson={config.showSalesperson}
            showProduct={config.showProduct}
            statusFilter={config.statusFilter}
          />

          {config.note && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">{config.note}</div>
          )}

          {result.kind === "summary" ? (
            <SectionCard title="Report figures" description="Every figure below is also what the CSV export contains, in the same order">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {flattenToKeyValueRows(result.data).map((row) => (
                      <tr key={row.metric}>
                        <td className="py-2 pr-6 text-[#536158]">{formatMetricLabel(row.metric)}</td>
                        <td className="py-2 font-semibold tabular-nums text-[#17251E]">{row.value === "" ? "—" : row.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="Matching records" description={`${result.data.pagination.totalItems} total`}>
              {result.data.rows.length === 0 ? (
                <EmptyState message="No records match these filters." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                      <tr>
                        {LIST_REPORT_CSV_COLUMNS[reportId]?.map((col) => (
                          <th key={col.key} className="px-5 py-3 font-semibold">
                            {col.header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF1ED]">
                      {(result.data.rows as Record<string, unknown>[]).map((row, index) => {
                        const drillKey = ORDER_DRILLDOWN_KEY[reportId];
                        const orderId = drillKey ? (row[drillKey] as string | undefined) : undefined;
                        return (
                          <tr key={index} className="hover:bg-gray-50">
                            {LIST_REPORT_CSV_COLUMNS[reportId]?.map((col, colIndex) => {
                              const cellContent = formatCellValue(row[col.key]);
                              return (
                                <td key={col.key} className="px-5 py-3 text-[#17251E]">
                                  {colIndex === 0 && orderId ? (
                                    <Link href={`/orders/${orderId}`} className="font-semibold text-[#173D2E] hover:underline">
                                      {cellContent}
                                    </Link>
                                  ) : (
                                    cellContent
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <Pagination
                basePath={basePath}
                searchParams={flatSearchParams}
                page={result.data.pagination.page}
                totalPages={result.data.pagination.totalPages}
                totalItems={result.data.pagination.totalItems}
                pageSize={result.data.pagination.pageSize}
              />
            </SectionCard>
          )}
        </div>
      </main>
    </div>
  );
}
