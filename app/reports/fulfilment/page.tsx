import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getFulfilmentIntelligenceReport } from "@/lib/reporting/fulfilment-intelligence";
import { getReportFilterOptions } from "@/lib/reporting/filter-options";
import { parseReportFilters } from "@/lib/reporting/filters";
import { toFlatSearchParams, toURLSearchParams, filtersOnly, type ReportSearchParams } from "../_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, MetricCard, RateStat } from "../_components/ui";
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
  currency: null,
  lostSalesReason: null,
  productCategory: null,
  productSearch: null,
  sapItemCode: null,
  decisionCategory: null,
  priority: null,
  recommendationStatus: null,
} as const;

export default async function FulfilmentIntelligenceReportPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const flatSearchParams = toFlatSearchParams(resolvedSearchParams);
  const parsed = parseReportFilters(toURLSearchParams(resolvedSearchParams));

  const [report, filterOptions] = await Promise.all([
    getFulfilmentIntelligenceReport(parsed.ok ? parsed.filters : EMPTY_FILTERS),
    getReportFilterOptions(),
  ]);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Picking &amp; Fulfilment</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Picking &amp; Fulfilment Intelligence</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Picking & Fulfilment"
            title="Picking & Fulfilment Intelligence"
            description={`Real M3/M10 picking, dispatch and delivery records, ${report.dateFrom} to ${report.dateTo}. Dispatched quantities are never treated as delivered, and picking completion is never treated as delivery completion -- each is tracked and reported as its own distinct quantity.`}
          />

          {!parsed.ok && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <p>{parsed.message} Showing the default 30-day window instead.</p>
            </div>
          )}

          <ReportFilterBar
            viewAction="/reports/fulfilment"
            exportAction="/api/reports/fulfilment/export"
            searchParams={flatSearchParams}
            customers={filterOptions.customers}
            salespeople={filterOptions.salespeople}
            showSalesperson
            showProduct
          />

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Ordered quantity" value={report.quantities.orderedQuantity} description="Sum of requested quantity, picking lines in range" dataQuality="actual" />
            <MetricCard title="Available / picked" value={report.quantities.availableQuantity} description="Sum of found quantity at pick time" dataQuality="actual" />
            <MetricCard title="Shortage quantity" value={report.quantities.shortageQuantity} description="Requested but not found" dataQuality="actual" />
            <MetricCard title="Outstanding in transit" value={report.quantities.outstandingDeliveryQuantity} description="Dispatched, no delivery outcome recorded yet" dataQuality="actual" />
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RateStat
              label="Picking availability rate"
              ratePercent={report.rates.pickingAvailabilityRatePercent}
              sampleSize={report.rates.pickingLineSampleSize}
              sampleLabel="picking lines"
            />
            <RateStat
              label="Delivery acceptance rate"
              ratePercent={report.rates.deliveryAcceptanceRatePercent}
              sampleSize={report.rates.deliveryLineSampleSize}
              sampleLabel="dispatch lines with a recorded outcome"
            />
          </section>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-3">
            <SectionCard title="Picking performance" description="PickingSession lifecycle in range">
              <div className="space-y-3 text-sm">
                <Row label="Sessions started" value={report.picking.sessionsStarted} />
                <Row label="Completed" value={report.picking.sessionsCompleted} />
                <Row label="Authorized" value={report.picking.sessionsAuthorized} />
                <Row label="No shortage" value={report.picking.sessionsWithNoShortage} />
                <Row label="With shortage" value={report.picking.sessionsWithShortage} />
                <Row label="Avg. picking duration" value={report.picking.averagePickingDurationHours === null ? "—" : `${report.picking.averagePickingDurationHours} h`} />
                <Row label="Avg. authorization lag" value={report.picking.averageAuthorizationLagHours === null ? "—" : `${report.picking.averageAuthorizationLagHours} h`} />
              </div>
              <Link href={{ pathname: "/reports/management/picking-shortages", query: filtersOnly(resolvedSearchParams) }} className="mt-4 inline-block text-xs font-semibold text-[#173D2E] hover:text-[#28583F]">
                View picking shortages →
              </Link>
            </SectionCard>

            <SectionCard title="Dispatch" description="DispatchRecord lifecycle in range">
              <div className="space-y-3 text-sm">
                <Row label="Planned" value={report.dispatchDelivery.dispatchesPlanned} />
                <Row label="Departed" value={report.dispatchDelivery.dispatchesDeparted} />
                <Row label="Delivered" value={report.dispatchDelivery.dispatchesDelivered} />
                <Row label="Cancelled" value={report.dispatchDelivery.dispatchesCancelled} />
                <Row label="Overdue to depart" value={report.dispatchDelivery.dispatchesOverdueToDepart} />
              </div>
              <Link href={{ pathname: "/reports/management/awaiting-fulfilment", query: filtersOnly(resolvedSearchParams) }} className="mt-4 inline-block text-xs font-semibold text-[#173D2E] hover:text-[#28583F]">
                View orders awaiting fulfilment →
              </Link>
            </SectionCard>

            <SectionCard title="Delivery outcomes" description="DeliveryRecord outcome in range">
              <div className="space-y-3 text-sm">
                <Row label="Accepted in full" value={report.dispatchDelivery.deliveriesAcceptedInFull} />
                <Row label="Partially rejected" value={report.dispatchDelivery.deliveriesPartiallyRejected} />
                <Row label="Fully rejected" value={report.dispatchDelivery.deliveriesFullyRejected} />
              </div>
              <Link href={{ pathname: "/reports/management/delivery-exceptions", query: filtersOnly(resolvedSearchParams) }} className="mt-4 inline-block text-xs font-semibold text-[#173D2E] hover:text-[#28583F]">
                View delivery exceptions →
              </Link>
            </SectionCard>
          </section>

          <SectionCard title="Order fulfilment breakdown" description="APPROVED/PICKING/READY_TO_INVOICE orders, by their latest picking session">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Row label="Fully fulfilled" value={report.orders.ordersFullyFulfilled} />
              <Row label="Partially fulfilled" value={report.orders.ordersPartiallyFulfilled} />
              <Row label="Awaiting picking" value={report.orders.ordersAwaitingPicking} />
            </div>
          </SectionCard>
        </div>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[#536158]">{label}</span>
      <span className="font-bold tabular-nums text-[#17251E]">{value}</span>
    </div>
  );
}
