import type { SalesPipelineReport, SalesPipelineFunnel } from "@/lib/reporting/sales-pipeline";
import type { FulfilmentIntelligenceReport } from "@/lib/reporting/fulfilment-intelligence";
import type { FinancialExposureReport } from "@/lib/reporting/financial-exposure";
import type { CommunicationsMonitoringReport } from "@/lib/reporting/communications-monitoring";
import type { QuotationDashboardCounts } from "@/lib/quotations/queries";
import type { OperationalSummaryPeriod, LostSalesManagementReport } from "@/lib/reporting/management-reports";
import { LOST_SALE_REASON_LABELS } from "@/lib/lost-sales/display";
import { CLAIM_CATEGORY_LABELS, CLAIM_PRIORITY_LABELS, CLAIM_STATUS_LABELS } from "@/lib/invoice-claims/display";
import { QUOTATION_STATUS_LABELS } from "@/lib/quotations/display";
import { formatCurrencyAmount } from "@/lib/format/currency";
import { SectionCard, MetricCard, BarRow, RateStat, EmptyState } from "../../_components/ui";

/**
 * Management Analytics spec, Part 2: replaces the old flat
 * flattenToKeyValueRows() JSON-dump table that app/reports/management/
 * [reportId]/page.tsx used to render for every SUMMARY-kind report with
 * real analytics -- KPI cards, rate stats (always shown with their own
 * sample size, never a bare percentage), categorical-distribution bar
 * rankings, and ranked top-N lists.
 *
 * Every number rendered here is read directly from the SAME, already-
 * computed report objects lib/reporting/management-reports.ts has always
 * produced (getSalesPipelineReport / getFulfilmentIntelligenceReport /
 * getFinancialExposureReport / getCommunicationsMonitoringReport /
 * getLostSalesReportSummary / getQuotationDashboardCounts) -- nothing is
 * re-derived, invented, or computed from a different query than the one
 * that always backed this report. The only NEW work in this file is
 * presentation: grouping related figures, ranking breakdowns that were
 * previously dumped as raw object keys, and never rendering a rate
 * without the sample size it was computed from (the exact rule
 * RateStat's own doc-comment states, inherited unchanged from every
 * other report page in this codebase).
 *
 * FinancialExposureSections is shared: it is both the entire body of the
 * standalone "invoice-claims-exposure" report AND the `financial`
 * sub-section embedded inside "operational-summary" -- both call sites
 * pass the exact same FinancialExposureReport shape, so there is only
 * ever one place this data is rendered from.
 */

/** Money with its currency sign: "$1,234.50" for USD (the default when a figure carries no currency), "ZWG 1,234.50" otherwise. */
function money(value: string, currency: string = "USD"): string {
  const formatted = formatCurrencyAmount(currency, value);
  return formatted === "—" ? value : formatted;
}

function quantity(value: string): string {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) ? n.toLocaleString("en-GB", { maximumFractionDigits: 2 }) : value;
}

function hours(value: number | null): string {
  return value === null ? "Not available" : `${value}h`;
}

/** Record<string, number> -> ranked [key, count][], highest first, zero-count keys dropped (nothing to show, and a 0-width bar reads as "missing data" rather than "none"). */
function rankCounts(counts: Record<string, number>): [string, number][] {
  return Object.entries(counts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1]);
}

function CategoryBarList({ title, description, counts, labels, color }: { title: string; description?: string; counts: Record<string, number>; labels: Record<string, string>; color: string }) {
  const ranked = rankCounts(counts);
  const max = ranked.length > 0 ? ranked[0]![1] : 0;
  return (
    <SectionCard title={title} description={description}>
      {ranked.length === 0 ? (
        <EmptyState message="No records in scope." />
      ) : (
        <div className="space-y-3">
          {ranked.map(([key, count]) => (
            <BarRow key={key} label={labels[key] ?? key} count={count} maxCount={max} color={color} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

function RankedList({ title, description, rows, empty }: { title: string; description?: string; rows: { label: string; detail: string }[]; empty: string }) {
  return (
    <SectionCard title={title} description={description}>
      {rows.length === 0 ? (
        <EmptyState message={empty} />
      ) : (
        <ol className="space-y-2 text-sm">
          {rows.map((row, i) => (
            <li key={i} className="flex items-center justify-between gap-3 border-b border-[#F0F2EF] pb-2 last:border-0 last:pb-0">
              <span className="font-medium text-[#17251E]">
                <span className="mr-2 text-[#A4ACA4]">{i + 1}.</span>
                {row.label}
              </span>
              <span className="whitespace-nowrap text-xs text-[#849087]">{row.detail}</span>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Sales pipeline funnel (operational-summary's `pipeline` section)
// ---------------------------------------------------------------------------

export function PipelineFunnelSections({ pipeline }: { pipeline: SalesPipelineReport }) {
  const f = pipeline.funnel;
  const funnelStages: [string, number][] = [
    ["Requests received", f.requestsReceived],
    ["Quotations created", f.quotationsCreated],
    ["Quotations issued", f.quotationsIssued],
    ["Quotations accepted", f.quotationsAccepted],
    ["Orders received", f.ordersReceived],
    ["Orders confirmed", f.ordersConfirmed],
  ];
  const maxStage = Math.max(1, ...funnelStages.map(([, v]) => v));

  return (
    <>
      <SectionCard title="Sales pipeline funnel" description={`${pipeline.dateFrom} to ${pipeline.dateTo} -- each stage counted on its own cohort anchor, so a later stage is never assumed to be a subset of an earlier one`}>
        <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <RateStat label="Requests processed" ratePercent={f.requestsProcessedRatePercent} sampleSize={f.requestsReceived} sampleLabel="requests" />
          <RateStat label="Quotation acceptance" ratePercent={f.quotationAcceptanceRatePercent} sampleSize={f.quotationsIssued} sampleLabel="issued quotations" />
          <RateStat label="Quotation → order conversion" ratePercent={f.quotationToOrderConversionRatePercent} sampleSize={f.acceptedQuotationsInCohort} sampleLabel="accepted quotations" />
          <RateStat label="Order approval" ratePercent={f.orderApprovalRatePercent} sampleSize={f.ordersReceived} sampleLabel="orders" />
        </div>
        <div className="space-y-3">
          {funnelStages.map(([label, count]) => (
            <BarRow key={label} label={label} count={count} maxCount={maxStage} color="bg-[#2a78d6]" />
          ))}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard title="Quotations issued value" value={money(f.quotationsIssuedValue)} dataQuality="actual" />
          <MetricCard title="Orders awaiting fulfilment" value={String(f.ordersAwaitingFulfilment)} dataQuality="actual" />
          <MetricCard title="Orders rejected / cancelled" value={`${f.ordersRejected} / ${f.ordersCancelled}`} dataQuality="actual" />
          <MetricCard title="Confirmed lost sales" value={`${f.lostSalesConfirmedCount} (${quantity(f.lostSalesConfirmedQuantity)} units)`} dataQuality="actual" />
        </div>
      </SectionCard>

      <SectionCard title="Stage-to-stage bottlenecks" description="Average days between consecutive lifecycle timestamps -- never shown without its own sample size, so a one-record average is never mistaken for a stable trend">
        {pipeline.bottlenecks.length === 0 ? (
          <EmptyState message="No transitions with both timestamps recorded in this period." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                <tr>
                  <th className="px-4 py-2 font-semibold">Transition</th>
                  <th className="px-4 py-2 text-right font-semibold">Average days</th>
                  <th className="px-4 py-2 text-right font-semibold">Sample size</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF1ED]">
                {pipeline.bottlenecks.map((b) => (
                  <tr key={b.transition}>
                    <td className="px-4 py-2 text-[#17251E]">{b.transition}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{b.averageDays === null ? "Not available" : b.averageDays}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-[#849087]">{b.sampleSize === 0 ? "No data" : `${b.sampleSize} record(s)`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </>
  );
}

// ---------------------------------------------------------------------------
// Fulfilment intelligence (operational-summary's `fulfilment` section)
// ---------------------------------------------------------------------------

export function FulfilmentSections({ fulfilment }: { fulfilment: FulfilmentIntelligenceReport }) {
  const q = fulfilment.quantities;
  const p = fulfilment.picking;
  const d = fulfilment.dispatchDelivery;
  const o = fulfilment.orders;

  const dispatchBreakdown: [string, number][] = [
    ["Planned", d.dispatchesPlanned],
    ["Departed", d.dispatchesDeparted],
    ["Delivered", d.dispatchesDelivered],
    ["Cancelled", d.dispatchesCancelled],
    ["Overdue to depart", d.dispatchesOverdueToDepart],
  ];
  const maxDispatch = Math.max(1, ...dispatchBreakdown.map(([, v]) => v));

  const deliveryOutcomes: [string, number][] = [
    ["Accepted in full", d.deliveriesAcceptedInFull],
    ["Partially rejected", d.deliveriesPartiallyRejected],
    ["Fully rejected", d.deliveriesFullyRejected],
  ];
  const maxOutcome = Math.max(1, ...deliveryOutcomes.map(([, v]) => v));

  const orderBreakdown: [string, number][] = [
    ["Fully fulfilled", o.ordersFullyFulfilled],
    ["Partially fulfilled", o.ordersPartiallyFulfilled],
    ["Awaiting picking", o.ordersAwaitingPicking],
  ];
  const maxOrder = Math.max(1, ...orderBreakdown.map(([, v]) => v));

  return (
    <>
      <SectionCard title="Fulfilment quantities" description={`${fulfilment.dateFrom} to ${fulfilment.dateTo}`}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard title="Ordered" value={quantity(q.orderedQuantity)} dataQuality="actual" />
          <MetricCard title="Available at picking" value={quantity(q.availableQuantity)} dataQuality="actual" />
          <MetricCard title="Shortage" value={quantity(q.shortageQuantity)} dataQuality="actual" />
          <MetricCard title="Dispatched" value={quantity(q.dispatchedQuantity)} dataQuality="actual" />
          <MetricCard title="Accepted on delivery" value={quantity(q.acceptedQuantity)} dataQuality="actual" />
          <MetricCard title="Rejected on delivery" value={quantity(q.rejectedQuantity)} dataQuality="actual" />
          <MetricCard title="Outstanding (in transit)" value={quantity(q.outstandingDeliveryQuantity)} dataQuality="actual" />
        </div>
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <RateStat label="Picking availability rate" ratePercent={fulfilment.rates.pickingAvailabilityRatePercent} sampleSize={fulfilment.rates.pickingLineSampleSize} sampleLabel="picking lines" />
          <RateStat label="Delivery acceptance rate" ratePercent={fulfilment.rates.deliveryAcceptanceRatePercent} sampleSize={fulfilment.rates.deliveryLineSampleSize} sampleLabel="delivery lines with a recorded outcome" />
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <SectionCard title="Picking performance">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <MetricCard title="Sessions started" value={String(p.sessionsStarted)} dataQuality="actual" />
            <MetricCard title="Sessions completed" value={String(p.sessionsCompleted)} dataQuality="actual" />
            <MetricCard title="Sessions authorized" value={String(p.sessionsAuthorized)} dataQuality="actual" />
            <MetricCard title="With / without shortage" value={`${p.sessionsWithShortage} / ${p.sessionsWithNoShortage}`} dataQuality="actual" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <MetricCard title="Avg. picking duration" value={hours(p.averagePickingDurationHours)} dataQuality={p.averagePickingDurationHours === null ? "missing" : "calculated"} />
            <MetricCard title="Avg. authorization lag" value={hours(p.averageAuthorizationLagHours)} dataQuality={p.averageAuthorizationLagHours === null ? "missing" : "calculated"} />
          </div>
        </SectionCard>

        <SectionCard title="Order fulfilment breakdown">
          <div className="space-y-3">
            {orderBreakdown.map(([label, count]) => (
              <BarRow key={label} label={label} count={count} maxCount={maxOrder} color="bg-[#78964A]" />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Dispatch status">
          <div className="space-y-3">
            {dispatchBreakdown.map(([label, count]) => (
              <BarRow key={label} label={label} count={count} maxCount={maxDispatch} color={label === "Overdue to depart" ? "bg-red-500" : "bg-[#1baf7a]"} />
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Delivery outcomes">
          <div className="space-y-3">
            {deliveryOutcomes.map(([label, count]) => (
              <BarRow key={label} label={label} count={count} maxCount={maxOutcome} color={label === "Accepted in full" ? "bg-[#78964A]" : "bg-amber-500"} />
            ))}
          </div>
        </SectionCard>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Communications monitoring (operational-summary's `communications` section)
// ---------------------------------------------------------------------------

export function CommunicationsSections({ communications }: { communications: CommunicationsMonitoringReport }) {
  const intake = communications.intake;
  const outbound = communications.outbound;
  const maxChannel = Math.max(1, ...intake.byChannel.map((c) => c.count));
  const outboundBreakdown: [string, number][] = [
    ["Queued", outbound.queued],
    ["Sent", outbound.sent],
    ["Failed", outbound.failed],
    ["Required a retry", outbound.retried],
  ];
  const maxOutbound = Math.max(1, ...outboundBreakdown.map(([, v]) => v));

  return (
    <SectionCard title="Communications monitoring" description={`${communications.dateFrom} to ${communications.dateTo} · Email: ${communications.channelMode.email} · WhatsApp: ${communications.channelMode.whatsapp}`}>
      <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MetricCard title="Requests received" value={String(intake.totalReceived)} dataQuality="actual" />
        <MetricCard title="Awaiting review" value={String(intake.awaitingReview)} dataQuality="actual" />
        <MetricCard title="Processed / duplicate-or-rejected" value={`${intake.successfullyProcessed} / ${intake.duplicateOrRejected}`} dataQuality="actual" />
        <MetricCard title="Orders with a failed notification" value={String(communications.exceptions.ordersWithFailedOutboundMessage)} dataQuality="actual" />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#849087]">Intake by channel</p>
          {intake.byChannel.length === 0 ? (
            <EmptyState message="No inbound messages in scope." />
          ) : (
            <div className="space-y-3">
              {intake.byChannel.map((c) => (
                <BarRow key={c.channel} label={c.channel} count={c.count} maxCount={maxChannel} color="bg-[#2a78d6]" />
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#849087]">Outbound delivery</p>
          <div className="space-y-3">
            {outboundBreakdown.map(([label, count]) => (
              <BarRow key={label} label={label} count={count} maxCount={maxOutbound} color={label === "Failed" ? "bg-red-500" : "bg-[#78964A]"} />
            ))}
          </div>
          <p className="mt-3 text-[11px] text-[#9AA59E]">
            {communications.exceptions.deliveryExceptionsWithNoSuccessfulNotification} delivery exception(s) never reached the customer via a successful notification.
          </p>
        </div>
      </div>
    </SectionCard>
  );
}

export type OperationalSummaryData = {
  period: OperationalSummaryPeriod;
  dateFrom: string;
  dateTo: string;
  pipeline: SalesPipelineReport;
  fulfilment: FulfilmentIntelligenceReport;
  financial: FinancialExposureReport;
  communications: CommunicationsMonitoringReport;
};

export function OperationalSummarySections({ data }: { data: OperationalSummaryData }) {
  return (
    <div className="space-y-6">
      <PipelineFunnelSections pipeline={data.pipeline} />
      <FulfilmentSections fulfilment={data.fulfilment} />
      <FinancialExposureSections data={data.financial} />
      <CommunicationsSections communications={data.communications} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Financial exposure (standalone "invoice-claims-exposure" report, and
// embedded inside operational-summary)
// ---------------------------------------------------------------------------

export function FinancialExposureSections({ data }: { data: FinancialExposureReport }) {
  const claims = data.claims;
  const reconciliation = data.reconciliation;
  const returns = data.returnsAndCreditNotes;
  const lostSales = data.lostSalesBySource;

  const reconciliationBreakdown: [string, number][] = [
    ["Fully invoiced lines", reconciliation.fullyInvoicedLines.length],
    ["Partially invoiced lines", reconciliation.partiallyInvoicedLines.length],
    ["Awaiting invoicing lines", reconciliation.awaitingInvoicingLines.length],
    ["Over-invoiced lines", reconciliation.overInvoicedLines.length],
    ["Unmatched invoices", reconciliation.unmatchedInvoices.length],
    ["Reconciliation exceptions", reconciliation.reconciliationExceptions.length],
  ];
  const maxReconciliation = Math.max(1, ...reconciliationBreakdown.map(([, v]) => v));

  return (
    <div className="space-y-6">
      <SectionCard title="Invoice claims" description="Status, category and priority are each shown as a ranked, categorical breakdown -- never as a flat key list">
        <div className="mb-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard title="Average resolution time" value={claims.averageResolutionDays === null ? "Not available" : `${claims.averageResolutionDays} day(s)`} dataQuality={claims.averageResolutionDays === null ? "missing" : "calculated"} />
          {claims.exposureByCurrency.map((bucket) => (
            <MetricCard key={bucket.currencyCode} title={`${bucket.currencyCode} exposure (potential / approved / actual)`} value={`${money(bucket.potentialCreditExposure, bucket.currencyCode)} / ${money(bucket.approvedCreditExposure, bucket.currencyCode)} / ${money(bucket.actualSapCreditedAmount, bucket.currencyCode)}`} description={`${bucket.claimCount} claim(s)`} dataQuality="actual" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <CategoryBarList title="By status" counts={claims.statusCounts} labels={CLAIM_STATUS_LABELS} color="bg-[#2a78d6]" />
          <CategoryBarList title="By category" counts={claims.categoryCounts} labels={CLAIM_CATEGORY_LABELS} color="bg-[#78964A]" />
          <CategoryBarList title="By priority" counts={claims.priorityCounts} labels={CLAIM_PRIORITY_LABELS} color="bg-amber-500" />
        </div>
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RankedList
            title="Repeat-complaint customers"
            description="Customers with more than one claim on record"
            rows={claims.repeatComplaintCustomers.map((c) => ({ label: c.customerName, detail: `${c.claimCount} claims` }))}
            empty="No customer has filed more than one claim."
          />
          <RankedList
            title="Most-claimed products"
            rows={claims.byProduct.map((p) => ({ label: p.sapItemDescription ?? p.sapItemCode, detail: `${p.claimLineCount} line(s)${p.qualityIssueCount > 0 ? ` · ${p.qualityIssueCount} quality` : ""}` }))}
            empty="No claim lines recorded."
          />
          <RankedList
            title="By customer"
            rows={claims.byCustomer.map((c) => ({ label: c.customerName, detail: `${c.claimCount} claim(s)` }))}
            empty="No claims recorded."
          />
          <RankedList
            title="By responsible department"
            rows={claims.byResponsibleDepartment.map((d) => ({ label: d.department, detail: `${d.claimCount} claim(s)` }))}
            empty="No department attribution recorded."
          />
        </div>
      </SectionCard>

      <SectionCard title="SAP invoice reconciliation" description="Counts of order lines / invoices in each reconciliation state -- a whole-business, right-now total">
        <div className="space-y-3">
          {reconciliationBreakdown.map(([label, count]) => (
            <BarRow key={label} label={label} count={count} maxCount={maxReconciliation} color={label.includes("Exception") || label.includes("Over-invoiced") ? "bg-red-500" : label.includes("Unmatched") ? "bg-amber-500" : "bg-[#78964A]"} />
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Returns and credit notes" description="Honors date range and customer filters, unlike the two sections above">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <MetricCard title="Returns awaiting resolution" value={String(returns.returnsAwaitingResolution)} dataQuality="actual" />
          <MetricCard title="Returns resolved" value={String(returns.returnsResolved)} dataQuality="actual" />
          <MetricCard title="Credit notes pending" value={String(returns.creditNotesPendingCount)} description="Approved, but no CreditNote issued yet" dataQuality="actual" />
          <MetricCard title="Credit notes issued (all-time)" value={String(returns.creditNotesIssuedCount)} dataQuality="actual" />
          <MetricCard title="Credit notes issued (period)" value={String(returns.creditNotesIssuedCountInPeriod)} dataQuality="actual" />
        </div>
      </SectionCard>

      <SectionCard title="Lost sales, by source" description={lostSales.note}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="rounded-xl border border-[#E9EDE8] p-4">
            <p className="text-sm font-semibold text-[#17251E]">{lostSales.sourceA.label}</p>
            <p className="mt-1 text-xs text-[#849087]">{lostSales.sourceA.description}</p>
            <div className="mt-3 space-y-2">
              {lostSales.sourceA.exposureByCurrency.length === 0 ? (
                <p className="text-xs text-[#9AA59E]">No priced exposure.</p>
              ) : (
                lostSales.sourceA.exposureByCurrency.map((bucket) => (
                  <p key={bucket.currencyCode} className="text-sm tabular-nums text-[#17251E]">
                    {money(bucket.potentialCreditExposure, bucket.currencyCode)} <span className="text-xs text-[#849087]">({bucket.claimCount} claims)</span>
                  </p>
                ))
              )}
            </div>
          </div>
          <div className="rounded-xl border border-[#E9EDE8] p-4">
            <p className="text-sm font-semibold text-[#17251E]">{lostSales.sourceB.label}</p>
            <p className="mt-1 text-xs text-[#849087]">{lostSales.sourceB.description}</p>
            <p className="mt-3 text-xl font-bold tabular-nums text-[#17251E]">{money(lostSales.sourceB.estimatedValue)}</p>
            <p className="mt-1 text-[11px] text-[#9AA59E]">
              {lostSales.sourceB.recordsWithEstimate} record(s) priced
              {lostSales.sourceB.recordsWithoutEstimate > 0 && ` · ${lostSales.sourceB.recordsWithoutEstimate} record(s) have no resolvable price and are excluded from this total`}
            </p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quotations performance
// ---------------------------------------------------------------------------

export type QuotationsPerformanceData = {
  allTime: QuotationDashboardCounts;
  period: { dateFrom: string; dateTo: string; funnel: SalesPipelineFunnel };
};

export function QuotationsPerformanceSections({ data }: { data: QuotationsPerformanceData }) {
  const f = data.period.funnel;
  const valueByCurrency = new Map<string, { status: string; currency: string; total: string }[]>();
  for (const row of data.allTime.valueByStatus) {
    const list = valueByCurrency.get(row.currency) ?? [];
    list.push(row);
    valueByCurrency.set(row.currency, list);
  }

  return (
    <div className="space-y-6">
      <SectionCard title="Quotation funnel, all-time" description="Whole-business totals, unaffected by any filter -- only the period figures below are date/customer/salesperson/product scoped">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard title="Total quotations" value={String(data.allTime.total)} dataQuality="actual" />
          <MetricCard title="Draft" value={String(data.allTime.draft)} dataQuality="actual" />
          <MetricCard title="Issued, awaiting response" value={String(data.allTime.issuedAwaitingResponse)} dataQuality="actual" />
          <MetricCard title="Accepted" value={String(data.allTime.accepted)} dataQuality="actual" />
          <MetricCard title="Rejected" value={String(data.allTime.rejected)} dataQuality="actual" />
          <MetricCard title="Expired" value={String(data.allTime.expired)} dataQuality="actual" />
          <MetricCard title="Cancelled" value={String(data.allTime.cancelled)} dataQuality="actual" />
          <MetricCard title="Due for follow-up" value={String(data.allTime.dueForFollowUp)} dataQuality="actual" />
        </div>
      </SectionCard>

      <SectionCard title="Quotation value by status" description="Grouped by currency -- never summed across currencies">
        {valueByCurrency.size === 0 ? (
          <EmptyState message="No quotation values recorded." />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {[...valueByCurrency.entries()].map(([currency, rows]) => (
              <div key={currency}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#849087]">{currency}</p>
                <table className="w-full text-left text-sm">
                  <tbody className="divide-y divide-[#F0F2EF]">
                    {rows.map((row) => (
                      <tr key={row.status}>
                        <td className="py-1.5 text-[#536158]">{QUOTATION_STATUS_LABELS[row.status] ?? row.status}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold text-[#17251E]">{money(row.total, currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <PipelineFunnelSections pipeline={{ dateFrom: data.period.dateFrom, dateTo: data.period.dateTo, funnel: f, bottlenecks: [] }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lost sales (management-reports.ts's getLostSalesManagementReport)
// ---------------------------------------------------------------------------

export function LostSalesSections({ data }: { data: LostSalesManagementReport }) {
  const maxReason = Math.max(1, ...data.lossReasonBreakdown.map((r) => r.recordCount));

  return (
    <div className="space-y-6">
      <SectionCard title="Lost sales, right now" description="A whole-business current total, not date-filtered -- reused as-is from the existing lost-sales summary. No &quot;awaiting manager decision&quot; tile here -- every shortage is automatically cancelled and confirmed lost the moment it is recorded (spec PART A), so there is no longer a decision step to await.">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <MetricCard
            title="Unavailable quantity"
            value={quantity(data.totalUnavailableQuantity)}
            description={`≈ ${quantity(data.estimatedValue)} in estimated value${
              data.demandsWithoutEstimate > 0 ? ` (excludes ${data.demandsWithoutEstimate} demand(s) with no resolvable price)` : ""
            }`}
            dataQuality="actual"
          />
          <MetricCard title="Outstanding quantity" value={quantity(data.totalOutstandingQuantity)} dataQuality="actual" />
          <MetricCard title="Confirmed lost quantity" value={quantity(data.totalConfirmedLostQuantity)} dataQuality="actual" />
        </div>
      </SectionCard>

      <SectionCard title="By loss reason" description="Count of records and total quantity per reason">
        {data.lossReasonBreakdown.length === 0 ? (
          <EmptyState message="No lost-sales records in scope." />
        ) : (
          <div className="space-y-4">
            {data.lossReasonBreakdown.map((row) => (
              <div key={row.reason}>
                <BarRow label={LOST_SALE_REASON_LABELS[row.reason] ?? row.reason} count={row.recordCount} maxCount={maxReason} color="bg-[#2a78d6]" />
                <p className="mt-1 text-[11px] text-[#9AA59E]">{quantity(row.totalQuantity)} unit(s)</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <RankedList
          title="Top unavailable products"
          rows={data.topUnavailableProducts.map((p) => ({ label: p.productDescriptionSnapshot, detail: `${quantity(p.totalQuantity)} units` }))}
          empty="No unavailable quantity recorded."
        />
        <RankedList
          title="Top confirmed-lost products"
          rows={data.topConfirmedLostProducts.map((p) => ({ label: p.productDescriptionSnapshot, detail: `${quantity(p.totalQuantity)} units` }))}
          empty="No confirmed lost sales recorded."
        />
        <RankedList
          title="Customers most affected"
          rows={data.topShortageCustomers.map((c) => ({ label: c.customerName, detail: `${c.demandCount} shortage(s)` }))}
          empty="No shortages recorded."
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LIST-report breakdowns (Part 2): a real distribution over the FULL
// filtered set of rows, computed via lib/reporting/management-reports.ts's
// getXxxBreakdown functions (same `where` as the paginated list itself),
// shown above that list's table rather than in place of it.
// ---------------------------------------------------------------------------

export function OrderStatusBreakdownSection({
  data,
  statusLabels,
}: {
  data: { byStatus: { status: string; count: number }[]; avgDaysOutstanding: number | null; sampleSize: number };
  statusLabels: Record<string, string>;
}) {
  const max = Math.max(1, ...data.byStatus.map((s) => s.count));
  return (
    <SectionCard title="Breakdown, across every matching order" description="Not just the current page">
      <div className="mb-4">
        <MetricCard
          title="Average days outstanding"
          value={data.avgDaysOutstanding === null ? "Not available" : `${data.avgDaysOutstanding} day(s)`}
          description={`Based on ${data.sampleSize} order(s) with a received date`}
          dataQuality={data.avgDaysOutstanding === null ? "missing" : "calculated"}
        />
      </div>
      {data.byStatus.length === 0 ? (
        <EmptyState message="No matching orders." />
      ) : (
        <div className="space-y-3">
          {data.byStatus.map((s) => (
            <BarRow key={s.status} label={statusLabels[s.status] ?? s.status} count={s.count} maxCount={max} color="bg-[#2a78d6]" />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function ProductShortageBreakdownSection({
  data,
}: {
  data: { topProducts: { productDescription: string; lineCount: number; totalUnavailableQuantity: string; totalUnavailableValue?: string; linesWithoutPrice?: number }[]; totalLines: number };
}) {
  return (
    <RankedList
      title="Top shortage products"
      description={`Ranked by total unavailable quantity across ${data.totalLines} matching picking line(s), not just the current page`}
      rows={data.topProducts.map((p) => ({
        label: p.productDescription,
        detail: `${quantity(p.totalUnavailableQuantity)} units short, ${p.lineCount} line(s)${
          p.totalUnavailableValue !== undefined
            ? ` -- ≈ ${quantity(p.totalUnavailableValue)} in value${
                p.linesWithoutPrice ? ` (${p.linesWithoutPrice} line(s) with no approved price excluded)` : ""
              }`
            : ""
        }`,
      }))}
      empty="No shortages match these filters."
    />
  );
}

export function DeliveryOutcomeBreakdownSection({ data, outcomeLabels }: { data: { byOutcome: { outcome: string; count: number }[] }; outcomeLabels: Record<string, string> }) {
  const max = Math.max(1, ...data.byOutcome.map((o) => o.count));
  return (
    <SectionCard title="Breakdown by outcome" description="Across every matching delivery exception, not just the current page">
      {data.byOutcome.length === 0 ? (
        <EmptyState message="No matching delivery exceptions." />
      ) : (
        <div className="space-y-3">
          {data.byOutcome.map((o) => (
            <BarRow key={o.outcome} label={outcomeLabels[o.outcome] ?? o.outcome} count={o.count} maxCount={max} color={o.outcome === "FULLY_REJECTED" ? "bg-red-500" : "bg-amber-500"} />
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export function CommunicationFailureBreakdownSection({ data }: { data: { byChannel: { key: string; count: number }[]; byType: { key: string; count: number }[] } }) {
  const maxChannel = Math.max(1, ...data.byChannel.map((c) => c.count));
  const maxType = Math.max(1, ...data.byType.map((t) => t.count));
  return (
    <SectionCard title="Breakdown by channel and message type" description="Across every matching failed message, not just the current page">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#849087]">By channel</p>
          {data.byChannel.length === 0 ? <EmptyState message="No matching failures." /> : (
            <div className="space-y-3">
              {data.byChannel.map((c) => (
                <BarRow key={c.key} label={c.key} count={c.count} maxCount={maxChannel} color="bg-[#2a78d6]" />
              ))}
            </div>
          )}
        </div>
        <div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#849087]">By message type</p>
          {data.byType.length === 0 ? <EmptyState message="No matching failures." /> : (
            <div className="space-y-3">
              {data.byType.map((t) => (
                <BarRow key={t.key} label={t.key} count={t.count} maxCount={maxType} color="bg-[#78964A]" />
              ))}
            </div>
          )}
        </div>
      </div>
    </SectionCard>
  );
}
