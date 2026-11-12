import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getFinancialExposureReport } from "@/lib/reporting/financial-exposure";
import { getReportFilterOptions } from "@/lib/reporting/filter-options";
import { parseReportFilters } from "@/lib/reporting/filters";
import { CLAIM_STATUS_LABELS } from "@/lib/invoice-claims/display";
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
  includeDemo: false,
} as const;

export default async function FinancialExposureReportPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const flatSearchParams = toFlatSearchParams(resolvedSearchParams);
  const parsed = parseReportFilters(toURLSearchParams(resolvedSearchParams));

  const [report, filterOptions] = await Promise.all([
    getFinancialExposureReport(parsed.ok ? parsed.filters : EMPTY_FILTERS),
    getReportFilterOptions(),
  ]);

  const openClaimStatuses = ["OPEN", "UNDER_INVESTIGATION", "AWAITING_CUSTOMER", "AWAITING_INTERNAL_ACTION"];
  const openClaimsCount = openClaimStatuses.reduce((sum, status) => sum + (report.claims.statusCounts[status] ?? 0), 0);
  const reconciliationExceptionCount = report.reconciliation.unmatchedInvoices.length + report.reconciliation.reconciliationExceptions.length;

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Invoice Claims &amp; Financial Exposure</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Invoice Claims &amp; Financial Exposure</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Financial Exposure"
            title="Invoice Claims & Financial Exposure"
            description="Consolidated view over the existing M5/M6A claims and reconciliation dashboards, plus returns and credit notes. SAP Business One remains the authoritative system of record -- figures here are reporting on it, not replacing it."
          />

          {!parsed.ok && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <p>{parsed.message} Showing the default window instead.</p>
            </div>
          )}

          <ReportFilterBar
            viewAction="/reports/financial-exposure"
            exportAction="/api/reports/financial-exposure/export"
            searchParams={flatSearchParams}
            customers={filterOptions.customers}
            salespeople={filterOptions.salespeople}
          />

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
            The claims and reconciliation sections below are whole-business, right-now totals (same shape as the
            main operational dashboard) -- they reuse the existing M5/M6A dashboards exactly as built, so only the
            &quot;include demo data&quot; filter applies to them. Date range and customer apply to the returns &amp;
            credit notes section, which is new in this report.
          </div>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Open invoice claims" value={String(openClaimsCount)} description="Not resolved, rejected or closed" dataQuality="actual" />
            <MetricCard title="Avg. resolution days" value={report.claims.averageResolutionDays === null ? "—" : `${report.claims.averageResolutionDays} days`} dataQuality={report.claims.averageResolutionDays === null ? "missing" : "actual"} />
            <MetricCard title="Reconciliation exceptions" value={String(reconciliationExceptionCount)} description="Unmatched or exception invoices" dataQuality="actual" />
            <MetricCard title="Credit notes pending" value={String(report.returnsAndCreditNotes.creditNotesPendingCount)} description="Approved for credit, not yet issued in SAP" dataQuality="actual" />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Claims by status" description="Current, whole-business breakdown">
              <div className="space-y-2">
                {Object.entries(report.claims.statusCounts)
                  .filter(([, count]) => count > 0)
                  .map(([status, count]) => (
                    <div key={status} className="flex items-center justify-between text-sm">
                      <span className="text-[#536158]">{CLAIM_STATUS_LABELS[status] ?? status}</span>
                      <span className="font-bold tabular-nums text-[#17251E]">{count}</span>
                    </div>
                  ))}
                {Object.values(report.claims.statusCounts).every((c) => c === 0) && <EmptyState message="No claims recorded." />}
              </div>
              <Link href="/invoice-claims/dashboard" className="mt-4 inline-block text-xs font-semibold text-[#173D2E] hover:text-[#28583F]">
                Full claims dashboard →
              </Link>
            </SectionCard>

            <SectionCard title="Exposure by currency" description="Potential / approved / actually credited -- never summed across currencies">
              {report.claims.exposureByCurrency.length === 0 ? (
                <EmptyState message="No claim exposure recorded." />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-[11px] uppercase tracking-wide text-[#849087]">
                      <tr>
                        <th className="py-2 pr-4">Currency</th>
                        <th className="py-2 pr-4">Potential</th>
                        <th className="py-2 pr-4">Approved</th>
                        <th className="py-2">Actually credited</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF1ED]">
                      {report.claims.exposureByCurrency.map((row) => (
                        <tr key={row.currencyCode}>
                          <td className="py-2 pr-4 font-semibold">{row.currencyCode}</td>
                          <td className="py-2 pr-4 tabular-nums">{row.potentialCreditExposure}</td>
                          <td className="py-2 pr-4 tabular-nums">{row.approvedCreditExposure}</td>
                          <td className="py-2 tabular-nums">{row.actualSapCreditedAmount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </SectionCard>
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Invoice reconciliation" description="READY_TO_INVOICE orders, by line-level reconciliation outcome">
              <div className="space-y-2 text-sm">
                <Row label="Fully invoiced lines" value={report.reconciliation.fullyInvoicedLines.length} />
                <Row label="Partially invoiced lines" value={report.reconciliation.partiallyInvoicedLines.length} />
                <Row label="Awaiting invoicing" value={report.reconciliation.awaitingInvoicingLines.length} />
                <Row label="Over-invoiced lines" value={report.reconciliation.overInvoicedLines.length} />
                <Row label="Unmatched SAP invoices" value={report.reconciliation.unmatchedInvoices.length} />
                <Row label="Reconciliation exceptions" value={report.reconciliation.reconciliationExceptions.length} />
              </div>
              <Link href="/invoice-reconciliation" className="mt-4 inline-block text-xs font-semibold text-[#173D2E] hover:text-[#28583F]">
                Full reconciliation report →
              </Link>
            </SectionCard>

            <SectionCard title="Returns & credit notes" description={`${report.dateFrom} to ${report.dateTo} -- date/customer filters apply here`}>
              <div className="space-y-2 text-sm">
                <Row label="Returns awaiting resolution" value={report.returnsAndCreditNotes.returnsAwaitingResolution} />
                <Row label="Returns resolved" value={report.returnsAndCreditNotes.returnsResolved} />
                <Row label="Credit notes pending (approved, not issued)" value={report.returnsAndCreditNotes.creditNotesPendingCount} />
                <Row label="Credit notes issued (all time)" value={report.returnsAndCreditNotes.creditNotesIssuedCount} />
                <Row label="Credit notes issued in period" value={report.returnsAndCreditNotes.creditNotesIssuedCountInPeriod} />
              </div>
              <Link href="/returns-credits" className="mt-4 inline-block text-xs font-semibold text-[#173D2E] hover:text-[#28583F]">
                Full returns &amp; credit notes list →
              </Link>
            </SectionCard>
          </section>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#536158]">{label}</span>
      <span className="font-bold tabular-nums text-[#17251E]">{value}</span>
    </div>
  );
}
