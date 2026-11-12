import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCommunicationsMonitoringReport } from "@/lib/reporting/communications-monitoring";
import { getReportFilterOptions } from "@/lib/reporting/filter-options";
import { parseReportFilters } from "@/lib/reporting/filters";
import { toFlatSearchParams, toURLSearchParams, filtersOnly, type ReportSearchParams } from "../_components/search-params";
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

const CHANNEL_MODE_LABELS: Record<string, string> = {
  LIVE: "Live",
  MOCK: "Mock / simulated",
  DISABLED: "Disabled",
};

export default async function CommunicationsReportPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const flatSearchParams = toFlatSearchParams(resolvedSearchParams);
  const parsed = parseReportFilters(toURLSearchParams(resolvedSearchParams));

  const [report, filterOptions] = await Promise.all([
    getCommunicationsMonitoringReport(parsed.ok ? parsed.filters : EMPTY_FILTERS),
    getReportFilterOptions(),
  ]);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Communications</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Communications &amp; Exception Monitoring</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Communications"
            title="Communications & Exception Monitoring"
            description={`Email and WhatsApp intake and outbound notifications, ${report.dateFrom} to ${report.dateTo}. "Delivered" means the send attempt succeeded, not a provider delivery receipt -- neither channel adapter in this system models one, so that figure is reported as missing rather than guessed.`}
          />

          {!parsed.ok && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <p>{parsed.message} Showing the default 30-day window instead.</p>
            </div>
          )}

          <ReportFilterBar
            viewAction="/reports/communications"
            exportAction="/api/reports/communications/export"
            searchParams={flatSearchParams}
            customers={filterOptions.customers}
            salespeople={filterOptions.salespeople}
          />

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E6EBE5] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#849087]">Email channel</p>
              <p className="mt-1 text-lg font-bold text-[#17251E]">{CHANNEL_MODE_LABELS[report.channelMode.email] ?? report.channelMode.email}</p>
            </div>
            <div className="rounded-xl border border-[#E6EBE5] bg-white p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#849087]">WhatsApp channel</p>
              <p className="mt-1 text-lg font-bold text-[#17251E]">{CHANNEL_MODE_LABELS[report.channelMode.whatsapp] ?? report.channelMode.whatsapp}</p>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Messages received" value={String(report.intake.totalReceived)} description="Email + WhatsApp intake in range" dataQuality="actual" />
            <MetricCard title="Awaiting review" value={String(report.intake.awaitingReview)} description="Status RECEIVED, not yet processed" dataQuality="actual" />
            <MetricCard title="Outbound sent" value={String(report.outbound.sent)} description={`${report.outbound.queued} queued, ${report.outbound.retried} retried`} dataQuality="actual" />
            <MetricCard title="Outbound failed" value={String(report.outbound.failed)} description="Notification send attempts that failed" dataQuality="actual" />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Intake by channel" description="Messages received in range, by source channel">
              {report.intake.byChannel.length === 0 ? (
                <EmptyState message="No messages received in this window." />
              ) : (
                <div className="space-y-2">
                  {report.intake.byChannel.map((row) => (
                    <div key={row.channel} className="flex items-center justify-between text-sm">
                      <span className="text-[#536158]">{row.channel}</span>
                      <span className="font-bold tabular-nums text-[#17251E]">{row.count}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4 space-y-2 border-t border-[#EEF1ED] pt-4 text-sm">
                <Row label="Successfully processed (converted/linked)" value={report.intake.successfullyProcessed} />
                <Row label="Duplicate / ignored" value={report.intake.duplicateOrRejected} />
              </div>
            </SectionCard>

            <SectionCard title="Exceptions" description="Orders where a customer-facing notification may not have reached them">
              <div className="space-y-3 text-sm">
                <Row label="Orders with a failed outbound message" value={report.exceptions.ordersWithFailedOutboundMessage} />
                <Row label="Delivery exceptions never successfully notified" value={report.exceptions.deliveryExceptionsWithNoSuccessfulNotification} />
              </div>
              <Link
                href={{ pathname: "/reports/management/communication-failures", query: filtersOnly(resolvedSearchParams) }}
                className="mt-4 inline-block text-xs font-semibold text-[#173D2E] hover:text-[#28583F]"
              >
                View communication failures →
              </Link>
            </SectionCard>
          </section>

          <div className="rounded-xl border border-[#E6EBE5] bg-white p-4 text-xs text-[#849087]">
            A communication-status filter isn&apos;t offered here -- this report&apos;s own breakdown (received/
            awaiting review/processed on intake, queued/sent/failed on outbound) already shows every status; an
            equality filter on top of it would only collapse that breakdown to one already-visible number. The
            drill-down above is where a status (FAILED, specifically) is applied meaningfully, as a list report.
          </div>
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
