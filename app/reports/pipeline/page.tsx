import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSalesPipelineReport } from "@/lib/reporting/sales-pipeline";
import { getReportFilterOptions } from "@/lib/reporting/filter-options";
import { parseReportFilters } from "@/lib/reporting/filters";
import { toFlatSearchParams, toURLSearchParams, type ReportSearchParams } from "../_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, MetricCard, RateStat, EmptyState } from "../_components/ui";
import { ReportFilterBar } from "../_components/filter-bar";
import { AlertCircle } from "lucide-react";

export const instant = false;

type RouteParams = {
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
} as const;

export default async function SalesPipelineReportPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const flatSearchParams = toFlatSearchParams(resolvedSearchParams);
  const parsed = parseReportFilters(toURLSearchParams(resolvedSearchParams));

  const [report, filterOptions] = await Promise.all([
    getSalesPipelineReport(parsed.ok ? parsed.filters : EMPTY_FILTERS),
    getReportFilterOptions(),
  ]);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Sales Pipeline</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Sales Pipeline &amp; Order Intelligence</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Sales Pipeline"
            title="Sales Pipeline & Order Intelligence"
            description={`Movement of customer demand from request through to order, ${report.dateFrom} to ${report.dateTo}. Every rate below is computed from one fixed cohort by its own anchor date -- never two independently-dated counts -- so it can never mix different date cohorts into a misleading percentage.`}
          />

          {!parsed.ok && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <p>{parsed.message} Showing the default 30-day window instead.</p>
            </div>
          )}

          <ReportFilterBar
            viewAction="/reports/pipeline"
            exportAction="/api/reports/sales-pipeline/export"
            searchParams={flatSearchParams}
            customers={filterOptions.customers}
            salespeople={filterOptions.salespeople}
            showSalesperson
            showProduct
          />

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Requests received" value={String(report.funnel.requestsReceived)} description="Inbound email/WhatsApp messages in range" dataQuality="actual" />
            <MetricCard title="Quotations issued" value={String(report.funnel.quotationsIssued)} description={`Value: ${report.funnel.quotationsIssuedValue}`} dataQuality="actual" />
            <MetricCard title="Orders received" value={String(report.funnel.ordersReceived)} description="receivedAt in range" dataQuality="actual" />
            <MetricCard
              title="Lost sales confirmed"
              value={String(report.funnel.lostSalesConfirmedCount)}
              description={`Quantity: ${report.funnel.lostSalesConfirmedQuantity}`}
              dataQuality="actual"
            />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Requests &rarr; Quotations" description="Message intake processed into a quotation or explicitly ignored/duplicate">
              <div className="space-y-3 text-sm">
                <Row label="Processed (converted/linked)" value={report.funnel.requestsProcessed} />
                <Row label="Ignored / duplicate" value={report.funnel.requestsIgnoredOrDuplicate} />
              </div>
              <div className="mt-4">
                <RateStat label="Requests processed rate" ratePercent={report.funnel.requestsProcessedRatePercent} sampleSize={report.funnel.requestsReceived} sampleLabel="requests received" />
              </div>
            </SectionCard>

            <SectionCard title="Quotations &rarr; Response" description="Of quotations issued in range, what fraction the customer has accepted as of now">
              <div className="space-y-3 text-sm">
                <Row label="Accepted" value={report.funnel.quotationsAccepted} />
                <Row label="Rejected" value={report.funnel.quotationsRejected} />
                <Row label="Expired" value={report.funnel.quotationsExpired} />
                <Row label="Cancelled" value={report.funnel.quotationsCancelled} />
              </div>
              <div className="mt-4">
                <RateStat label="Quotation acceptance rate" ratePercent={report.funnel.quotationAcceptanceRatePercent} sampleSize={report.funnel.quotationsIssued} sampleLabel="quotations issued" />
              </div>
            </SectionCard>

            <SectionCard title="Accepted Quotations &rarr; Order" description="Of quotations accepted in range, what fraction have since been converted into an order">
              <div className="space-y-3 text-sm">
                <Row label="Accepted (cohort)" value={report.funnel.acceptedQuotationsInCohort} />
                <Row label="Converted to order" value={report.funnel.acceptedQuotationsConvertedToOrder} />
              </div>
              <div className="mt-4">
                <RateStat
                  label="Quotation-to-order conversion rate"
                  ratePercent={report.funnel.quotationToOrderConversionRatePercent}
                  sampleSize={report.funnel.acceptedQuotationsInCohort}
                  sampleLabel="accepted quotations"
                />
              </div>
            </SectionCard>

            <SectionCard title="Orders &rarr; Approval" description="Of orders received in range, what fraction have progressed to approved or further">
              <div className="space-y-3 text-sm">
                <Row label="Awaiting approval" value={report.funnel.ordersAwaitingApproval} />
                <Row label="Confirmed (approved+)" value={report.funnel.ordersConfirmed} />
                <Row label="Awaiting fulfilment" value={report.funnel.ordersAwaitingFulfilment} />
                <Row label="Rejected" value={report.funnel.ordersRejected} />
                <Row label="Cancelled" value={report.funnel.ordersCancelled} />
              </div>
              <div className="mt-4">
                <RateStat label="Order approval rate" ratePercent={report.funnel.orderApprovalRatePercent} sampleSize={report.funnel.ordersReceived} sampleLabel="orders received" />
              </div>
            </SectionCard>
          </section>

          <SectionCard title="Bottlenecks" description="Average days between consecutive lifecycle timestamps on the same record, over records in this window">
            {report.bottlenecks.length === 0 ? (
              <EmptyState message="No timed transitions in this window yet." />
            ) : (
              <div className="divide-y divide-[#EEF1ED]">
                {report.bottlenecks.map((b) => (
                  <div key={b.transition} className="flex items-center justify-between gap-4 py-3">
                    <p className="text-sm font-medium text-[#17251E]">{b.transition}</p>
                    <div className="text-right">
                      <p className="text-sm font-bold text-[#17251E]">{b.averageDays === null ? "—" : `${b.averageDays} days`}</p>
                      <p className="text-[11px] text-[#849087]">{b.sampleSize === 0 ? "No records" : `${b.sampleSize} records`}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <div className="flex items-center justify-between rounded-xl border border-[#E6EBE5] bg-white p-4 text-xs text-[#849087]">
            <p>Order status / quotation status filters aren&apos;t offered here -- this funnel already breaks orders and quotations down by status.</p>
            <Link href="/reports/management" className="font-semibold text-[#173D2E] hover:text-[#28583F]">
              Drill into named management reports →
            </Link>
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
