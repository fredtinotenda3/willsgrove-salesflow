import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getProductProfile } from "@/lib/reporting/product-insights-queries";
import { RETURN_CONDITION_LABELS } from "@/lib/returns-credits/display";
import { LOST_SALE_REASON_LABELS } from "@/lib/lost-sales/display";
import { parseReportFilters } from "@/lib/reporting/filters";
import { isValidId } from "@/lib/http";
import { toFlatSearchParams, toURLSearchParams, type ReportSearchParams } from "../../reports/_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, MetricCard, DataQualityBadge, EmptyState } from "../../reports/_components/ui";
import { ReportFilterBar } from "../../reports/_components/filter-bar";
import { AlertCircle, ArrowLeft, Package } from "lucide-react";

/**
 * Milestone 14 (Product Intelligence). Product 360 profile. Open to ALL
 * three roles (SALESPERSON, SALES_MANAGER, ADMINISTRATOR) -- unlike
 * /reports/product-intelligence (management-only). The real access
 * control lives server-side in app/api/products/[id]/profile/route.ts
 * (and its export sibling); this page's own getCurrentUser() check is the
 * same belt the rest of this reporting surface already wears, never the
 * sole control.
 *
 * [id] is the Product MASTER record's own id (Product.id, a cuid) -- see
 * lib/product-queries.ts's getProductById for why this is never a
 * sapItemCode lookup. A SAP item code with real invoice activity but no
 * Product master row has no master record to show a profile of; it
 * surfaces instead on /reports/product-intelligence's own master-data-
 * quality ranking (spec section 4.B item 10), never through this page.
 *
 * Reads the current session and a live product record directly (no
 * route-handler round trip) -- same reasoning as app/customers/[id]/page.tsx.
 */
export const instant = false;

type RouteParams = {
  params: Promise<{ id: string }>;
  searchParams: Promise<ReportSearchParams>;
};

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

const INSIGHT_CATEGORY_LABELS: Record<string, string> = {
  "activity-with-repeated-claims": "Repeated claims",
  "demand-with-repeated-unfulfilled-quantities": "Repeated unfulfilled demand",
  "broad-customer-base-declining-activity": "Declining activity across a broad customer base",
  "credit-notes-reach-or-exceed-invoiced-value": "Credit notes reach or exceed invoiced value",
  "repeated-delivery-rejections": "Repeated delivery rejections",
  "insufficient-data": "Insufficient data",
};

export default async function ProductProfilePage({ params, searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const resolvedSearchParams = await searchParams;
  const flatSearchParams = toFlatSearchParams(resolvedSearchParams);
  const urlSearchParams = toURLSearchParams(resolvedSearchParams);
  const parsedFilters = parseReportFilters(urlSearchParams);

  const EMPTY_FILTERS = {
    dateFrom: null,
    dateTo: null,
    customerId: null,
    productId: id,
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

  const filters = parsedFilters.ok ? parsedFilters.filters : EMPTY_FILTERS;

  const profile = await getProductProfile(id, filters);
  if (!profile) {
    notFound();
  }

  const basePath = `/products/${id}`;
  const { product, revenue, customerDemand, requestedDemand, lostSales, commercialHealth, fulfilment, insights } = profile;

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Products / {product.sapItemCode}</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">{product.itemName}</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Product intelligence / Product 360"
            title={product.itemName}
            description={`SAP item code ${product.sapItemCode}${product.category ? ` · ${product.category}` : ""} · ${titleCase(product.status)}`}
            actions={
              <Link href="/products" className="flex items-center gap-1.5 text-sm font-semibold text-[#718078] hover:text-[#17251E]">
                <ArrowLeft size={15} />
                Product catalogue
              </Link>
            }
          />

          {!parsedFilters.ok && (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <p>{parsedFilters.message} Showing the default view instead.</p>
            </div>
          )}

          <ReportFilterBar
            viewAction={basePath}
            exportAction={`/api/products/${id}/profile/export`}
            searchParams={flatSearchParams}
            customers={[]}
            salespeople={[]}
            showCustomer={false}
            showSalesperson={false}
            showProduct={false}
            showCurrency={false}
          />

          {/* --- Identity --- */}
          <SectionCard title="Product identity" icon={<Package size={18} />} description="Edited from the product catalogue -- this profile is read-only. SAP item code is the canonical identity; never matched by description.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard title="SAP item code" value={product.sapItemCode} />
              <MetricCard title="Category" value={product.category ?? "—"} description={product.category === null ? "No category recorded -- surfaces on the management overview's master-data-quality ranking." : undefined} dataQuality={product.category === null ? "missing" : undefined} />
              <MetricCard title="Status" value={titleCase(product.status)} />
            </div>
          </SectionCard>

          {/* --- SAP invoice activity + line value by currency --- */}
          <SectionCard
            title="SAP invoice line value"
            description={`${revenue.history.periodFrom} to ${revenue.history.periodTo} -- as-of ${revenue.history.asOfDate} (${revenue.history.asOfDateSource === "live-business-date" ? "today, Africa/Harare" : "selected date range"}). Never revenue or profit.`}
          >
            {revenue.byCurrency.length === 0 ? (
              <EmptyState message="No qualifying SAP invoice activity for this product in the selected period." />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {revenue.byCurrency.map((row) => (
                  <MetricCard
                    key={row.currency}
                    title={`${row.currency} invoice line value`}
                    value={row.lineValueTotal}
                    description={row.excludedLineCount > 0 ? `${row.excludedLineCount} line(s) excluded (no line value recorded)` : undefined}
                    dataQuality="actual"
                  />
                ))}
              </div>
            )}
            <div className="mt-5">
              <p className="mb-2 text-xs font-semibold text-[#718078]">Quantity invoiced, by unit of measure as recorded on the invoice line (never Product-master UoM)</p>
              {revenue.quantityByUnit.length === 0 ? (
                <EmptyState message="No quantity recorded in the selected period." />
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {revenue.quantityByUnit.map((row) => (
                    <div key={row.unitOfMeasure} className="rounded-xl border border-[#E9EDE8] p-4">
                      <p className="text-xs font-medium text-[#849087]">{row.unitOfMeasure}</p>
                      <p className="mt-1 text-sm font-semibold text-[#17251E]">{row.quantityTotal}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </SectionCard>

          {/* --- Invoice history --- */}
          <SectionCard title="Invoice history" description="All-time and as-of-bounded figures are kept separate -- never conflated.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard title="First qualifying invoice (all-time)" value={revenue.history.firstQualifyingInvoiceDate ?? "No qualifying invoice on record"} dataQuality="actual" />
              <MetricCard
                title={`Last qualifying invoice (as of ${revenue.history.asOfDate})`}
                value={revenue.history.lastQualifyingInvoiceDateAsOf ?? "No qualifying invoice on record"}
                dataQuality="actual"
              />
              <MetricCard
                title="Days since last qualifying invoice"
                value={revenue.history.daysSinceLastQualifyingInvoice === null ? "No qualifying invoice on record" : String(revenue.history.daysSinceLastQualifyingInvoice)}
                dataQuality="calculated"
              />
              <MetricCard title="Purchase frequency (selected period, distinct invoices)" value={String(revenue.history.purchaseFrequencyInPeriod)} dataQuality="actual" />
              <MetricCard
                title="Average inter-purchase interval (selected period)"
                value={revenue.history.averageInterPurchaseIntervalInPeriod.status === "ok" ? `${revenue.history.averageInterPurchaseIntervalInPeriod.averageDays} days` : "Insufficient data"}
                description="Fewer than 2 qualifying invoice dates in the period -- never shown as 0."
                dataQuality="calculated"
              />
              <MetricCard title="Distinct purchasing customers (selected period)" value={String(revenue.distinctCustomerCountInPeriod)} dataQuality="actual" />
            </div>
          </SectionCard>

          {/* --- Customer demand (who actually purchased) --- */}
          <SectionCard title="Customers who purchased this product" description={`Selected period only (${customerDemand.periodFrom} to ${customerDemand.periodTo}).`}>
            {customerDemand.customers.length === 0 ? (
              <EmptyState message="No customers purchased this product in the selected period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Customer</th>
                      <th className="px-5 py-3 font-semibold">Purchase frequency</th>
                      <th className="px-5 py-3 font-semibold">Last purchase date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {customerDemand.customers.map((c) => (
                      <tr key={c.customerId} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-[#17251E]">{c.customerName}</td>
                        <td className="px-5 py-3 tabular-nums">{c.purchaseFrequency}</td>
                        <td className="px-5 py-3 text-[#536158]">{c.lastPurchaseDate ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* --- Requested demand: quotations and orders (kept separate from invoiced) --- */}
          <SectionCard title="Requested demand" description="Quotations and orders, kept separate from invoiced demand above -- this schema has no direct quotation-to-order-to-invoice link, so no conversion rate is computed (never guessed).">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-[#718078]">Quotations (selected period)</p>
                <div className="grid grid-cols-1 gap-3">
                  <MetricCard title="Quotation lines" value={String(requestedDemand.quotationLineCount)} dataQuality="actual" />
                  <MetricCard title="Distinct quoting customers" value={String(requestedDemand.distinctQuotingCustomerCount)} dataQuality="actual" />
                  {requestedDemand.quotationRequestedQuantityByUnit.map((q) => (
                    <MetricCard key={q.unitOfMeasure} title={`Requested quantity (${q.unitOfMeasure})`} value={q.quantityTotal} dataQuality="actual" />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-[#718078]">Orders (selected period)</p>
                <div className="grid grid-cols-1 gap-3">
                  <MetricCard title="Order lines" value={String(requestedDemand.orderLineCount)} dataQuality="actual" />
                  <MetricCard title="Distinct ordering customers" value={String(requestedDemand.distinctOrderingCustomerCount)} dataQuality="actual" />
                  {requestedDemand.orderRequestedQuantityByUnit.map((q) => (
                    <MetricCard key={q.unitOfMeasure} title={`Requested quantity (${q.unitOfMeasure})`} value={q.quantityTotal} dataQuality="actual" />
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          {/* --- Lost sales (kept strictly separate from unfulfilled/requested) --- */}
          <SectionCard title="Unfulfilled demand & lost sales" description="Unfulfilled demand, confirmed lost sales and requested/ordered/invoiced quantities are kept strictly separate -- never assume every unfulfilled order became a lost sale.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard title="Unfulfilled demand records" value={String(lostSales.unfulfilledDemandRecordCount)} dataQuality="actual" />
              <MetricCard title="Outstanding quantity" value={lostSales.outstandingQuantityTotal} dataQuality="actual" />
              <MetricCard title="Confirmed lost sales" value={String(lostSales.confirmedLostSaleCount)} dataQuality="actual" />
              <MetricCard title="Confirmed lost quantity" value={lostSales.confirmedLostSaleQuantityTotal} dataQuality="actual" />
            </div>
            {Object.keys(lostSales.byReason).length > 0 && (
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {Object.entries(lostSales.byReason).map(([reason, data]) => (
                  <div key={reason} className="rounded-xl border border-[#E9EDE8] p-4">
                    <p className="text-xs font-medium text-[#849087]">{LOST_SALE_REASON_LABELS[reason] ?? titleCase(reason)}</p>
                    <p className="mt-1 text-sm font-semibold text-[#17251E]">
                      {data.count} record(s) · {data.quantity} units
                    </p>
                  </div>
                ))}
              </div>
            )}
            {lostSales.estimatedValueByCurrency.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold text-[#718078]">Estimated lost value (never authoritative SAP data)</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {lostSales.estimatedValueByCurrency.map((row) => (
                    <MetricCard
                      key={row.currency}
                      title={`Estimated value (${row.currency})`}
                      value={row.totalEstimatedValue}
                      description={row.excludedCount > 0 ? `${row.excludedCount} record(s) excluded -- no estimated value recorded` : undefined}
                      dataQuality="provisional"
                    />
                  ))}
                </div>
              </div>
            )}
          </SectionCard>

          {/* --- Commercial health: claims / returns / actual credit notes --- */}
          <SectionCard
            title="Quality & commercial issues"
            description={`As of ${commercialHealth.asOfDate} (${commercialHealth.asOfDateSource === "live-business-date" ? "today, Africa/Harare" : "selected date range"}). A claim/return/credit note spanning more than one product cannot be attributed to this product alone and is counted separately below -- never guessed or split.`}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard title="Claims raised (selected period)" value={String(commercialHealth.claims.raisedInPeriodCount)} dataQuality="actual" />
              <MetricCard
                title={`Claims open (as of ${commercialHealth.asOfDate})`}
                value={String(commercialHealth.claims.openAsOfReportingDateCount)}
                description="Approximated from claimDate/closedAt -- this schema has no event-sourced status history."
                dataQuality="calculated"
              />
              <MetricCard
                title="Multi-product claims (excluded from exposure below)"
                value={String(commercialHealth.claims.multiProductClaimCount)}
                description="Touches this product AND at least one other -- not attributed here, never guessed."
                dataQuality="missing"
              />
              <MetricCard
                title="Unattributable returns (claim-level, multi-product)"
                value={String(commercialHealth.returns.unattributableReturnCountInPeriod)}
                dataQuality="missing"
              />
            </div>

            {commercialHealth.claims.exposureByCurrency.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold text-[#718078]">Claim exposure by currency (all-time, current state -- single-product claims only)</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                      <tr>
                        <th className="px-5 py-2 font-semibold">Currency</th>
                        <th className="px-5 py-2 font-semibold">Claims</th>
                        <th className="px-5 py-2 font-semibold">Potential credit exposure</th>
                        <th className="px-5 py-2 font-semibold">Approved credit exposure</th>
                        <th className="px-5 py-2 font-semibold">Actual SAP-credited</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF1ED]">
                      {commercialHealth.claims.exposureByCurrency.map((row) => (
                        <tr key={row.currencyCode}>
                          <td className="px-5 py-2 font-semibold">{row.currencyCode}</td>
                          <td className="px-5 py-2">{row.claimCount}</td>
                          <td className="px-5 py-2">{row.potentialCreditExposure}</td>
                          <td className="px-5 py-2">{row.approvedCreditExposure}</td>
                          <td className="px-5 py-2">{row.actualSapCreditedAmount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {commercialHealth.returns.inPeriodByCondition.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold text-[#718078]">Physical returns by condition (selected period, attributable to this product)</p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {commercialHealth.returns.inPeriodByCondition.map((row) => (
                    <div key={row.condition} className="rounded-xl border border-[#E9EDE8] p-4">
                      <p className="text-xs font-medium text-[#849087]">{RETURN_CONDITION_LABELS[row.condition] ?? titleCase(row.condition)}</p>
                      <p className="mt-1 text-sm font-semibold text-[#17251E]">{row.count} return(s)</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-[#718078]">Actual credit notes -- in period</p>
                {commercialHealth.actualCreditNotes.inPeriodByCurrency.length === 0 ? (
                  <EmptyState message="No attributable credit notes with a date inside the selected period." />
                ) : (
                  <div className="space-y-2">
                    {commercialHealth.actualCreditNotes.inPeriodByCurrency.map((row) => (
                      <MetricCard key={row.currency} title={`${row.currency} (in period)`} value={row.total} dataQuality="actual" />
                    ))}
                  </div>
                )}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-[#718078]">Actual credit notes -- all-time cumulative</p>
                <div className="space-y-2">
                  {commercialHealth.actualCreditNotes.allTimeCumulativeByCurrency.map((row) => (
                    <MetricCard key={row.currency} title={`${row.currency} (cumulative)`} value={row.total} dataQuality="actual" />
                  ))}
                </div>
              </div>
            </div>
            <p className="mt-4 text-xs leading-5 text-[#9AA59E]">
              {commercialHealth.actualCreditNotes.excludedFromPeriodNoDateCount} credit note(s) excluded from the in-period figure (no recorded date, still in the cumulative total) ·{" "}
              {commercialHealth.actualCreditNotes.unattributableCreditNoteCount} credit note(s) exist but span more than one product -- never guessed or split.
            </p>
          </SectionCard>

          {/* --- Fulfilment and delivery performance --- */}
          <SectionCard title="Fulfilment & delivery performance" description={`${fulfilment.periodFrom} to ${fulfilment.periodTo}. Line-level delivery outcomes only -- never the header-level DeliveryRecord.outcome, which can span several products in one shipment.`}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <p className="mb-2 text-xs font-semibold text-[#718078]">Dispatched quantity by unit</p>
                {fulfilment.dispatchedQuantityByUnit.length === 0 ? <EmptyState message="None recorded." /> : fulfilment.dispatchedQuantityByUnit.map((q) => (
                  <MetricCard key={q.unitOfMeasure} title={q.unitOfMeasure} value={q.quantityTotal} dataQuality="actual" />
                ))}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-[#718078]">Delivered & accepted quantity by unit</p>
                {fulfilment.deliveredAcceptedQuantityByUnit.length === 0 ? <EmptyState message="None recorded." /> : fulfilment.deliveredAcceptedQuantityByUnit.map((q) => (
                  <MetricCard key={q.unitOfMeasure} title={q.unitOfMeasure} value={q.quantityTotal} dataQuality="actual" />
                ))}
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold text-[#718078]">Delivered & rejected quantity by unit</p>
                {fulfilment.deliveredRejectedQuantityByUnit.length === 0 ? <EmptyState message="None recorded." /> : fulfilment.deliveredRejectedQuantityByUnit.map((q) => (
                  <MetricCard key={q.unitOfMeasure} title={q.unitOfMeasure} value={q.quantityTotal} dataQuality="actual" />
                ))}
              </div>
            </div>
            <p className="mt-4 text-xs font-semibold text-[#718078]">{fulfilment.deliveryLinesWithRejectionCount} delivery line(s) with a recorded rejection (an event count, never a rate)</p>
            {fulfilment.rejectionReasons.length > 0 && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {fulfilment.rejectionReasons.map((r) => (
                  <div key={r.reason} className="rounded-xl border border-[#E9EDE8] p-4">
                    <p className="text-xs font-medium text-[#849087]">{r.reason}</p>
                    <p className="mt-1 text-sm font-semibold text-[#17251E]">{r.count} occurrence(s)</p>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* --- Deterministic insights --- */}
          <SectionCard title="Trend & attention indicators" description="Deterministic, explainable insights only -- no arbitrary thresholds, invented risk scores, or AI-fabricated predictions (spec section 7).">
            {insights.length === 0 ? (
              <EmptyState message="No insights apply to this product for the selected period." />
            ) : (
              <div className="space-y-3">
                {insights.map((insight, idx) => (
                  <div key={idx} className="rounded-xl border border-[#E9EDE8] p-4">
                    <p className="text-xs font-semibold text-[#496A42]">{INSIGHT_CATEGORY_LABELS[insight.category] ?? titleCase(insight.category)}</p>
                    <p className="mt-1 text-sm text-[#17251E]">{insight.reason}</p>
                    {insight.dataLimitations && <p className="mt-2 text-xs text-[#9AA59E]">{insight.dataLimitations}</p>}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          <p className="text-xs leading-5 text-[#9AA59E]">
            <DataQualityBadge quality="actual" /> actual recorded values &middot; <DataQualityBadge quality="calculated" /> derived from recorded data &middot;{" "}
            <DataQualityBadge quality="provisional" /> estimated, not authoritative SAP data &middot; <DataQualityBadge quality="missing" /> data-quality gap, never silently hidden.
          </p>
        </div>
      </main>
    </div>
  );
}
