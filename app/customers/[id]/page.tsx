import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getCustomerProfile } from "@/lib/reporting/customer-insights-queries";
import { ATTRIBUTION_BUCKET_LABELS } from "@/lib/reporting/attribution";
import { RETURN_CONDITION_LABELS } from "@/lib/returns-credits/display";
import { LOST_SALE_REASON_LABELS } from "@/lib/lost-sales/display";
import { parseReportFilters } from "@/lib/reporting/filters";
import { isValidId } from "@/lib/http";
import { toFlatSearchParams, toURLSearchParams, type ReportSearchParams } from "../../reports/_components/search-params";
import Sidebar from "../../components/sidebar";
import { PageHeader, SectionCard, MetricCard, DataQualityBadge, EmptyState } from "../../reports/_components/ui";
import { ReportFilterBar } from "../../reports/_components/filter-bar";
import { AlertCircle, ArrowLeft, Building2 } from "lucide-react";

/**
 * Milestone 13 (Customer Intelligence). Customer 360 profile. Open to ALL
 * three roles (SALESPERSON, SALES_MANAGER, ADMINISTRATOR) -- unlike
 * /reports/customer-intelligence (management-only). The real access
 * control lives server-side in app/api/customers/[id]/profile/route.ts
 * (and its export sibling); this page's own getCurrentUser() check is the
 * same belt the rest of this reporting surface already wears, never the
 * sole control.
 *
 * Reads the current session and a live customer record directly (no
 * route-handler round trip), so -- same reasoning as app/orders/[id]/
 * page.tsx and app/reports/management/[reportId]/page.tsx -- it can't be
 * prerendered into the static shell.
 */
export const instant = false;

type RouteParams = {
  params: Promise<{ id: string }>;
  searchParams: Promise<ReportSearchParams>;
};

function formatList(parts: (string | null | undefined)[]): string {
  const filtered = parts.filter((p): p is string => Boolean(p && p.trim() !== ""));
  return filtered.length > 0 ? filtered.join(" · ") : "—";
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default async function CustomerProfilePage({ params, searchParams }: RouteParams) {
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
    customerId: id,
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

  const filters = parsedFilters.ok ? parsedFilters.filters : EMPTY_FILTERS;

  const profile = await getCustomerProfile(id, filters);
  if (!profile) {
    notFound();
  }

  const basePath = `/customers/${id}`;
  const { customer, revenue, purchasing, lostSales, commercialHealth, salespersonRelationship, dataQuality } = profile;

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Customers / {customer.name}</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">{customer.name}</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Customer intelligence / Customer 360"
            title={customer.name}
            description={formatList([customer.sapCustomerCode ? `SAP code ${customer.sapCustomerCode}` : null, customer.category, customer.status])}
            actions={
              <Link href="/customers" className="flex items-center gap-1.5 text-sm font-semibold text-[#718078] hover:text-[#17251E]">
                <ArrowLeft size={15} />
                Customer directory
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
            exportAction={`/api/customers/${id}/profile/export`}
            searchParams={flatSearchParams}
            customers={[]}
            salespeople={[]}
            showCustomer={false}
            showSalesperson={false}
            showProduct={false}
            showCurrency={false}
          />

          {/* --- Identity --- */}
          <SectionCard title="Account" icon={<Building2 size={18} />} description="Edited from the customer directory -- this profile is read-only.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard title="Category" value={customer.category ?? "—"} />
              <MetricCard title="Account status" value={titleCase(customer.status)} />
              <MetricCard title="Orders on record" value={String(customer.orderCount)} />
            </div>
          </SectionCard>

          {/* --- SAP invoice activity + line value by currency --- */}
          <SectionCard
            title="SAP invoice line value"
            description={`${revenue.history.periodFrom} to ${revenue.history.periodTo} -- as-of ${revenue.history.asOfDate} (${revenue.history.asOfDateSource === "live-business-date" ? "today, Africa/Harare" : "selected date range"}). Never revenue or profit -- see data-quality note below.`}
          >
            {revenue.byCurrency.length === 0 ? (
              <EmptyState message="No qualifying SAP invoice activity for this customer in the selected period." />
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
              <MetricCard title="Purchase frequency (selected period)" value={String(revenue.history.purchaseFrequencyInPeriod)} dataQuality="actual" />
              <MetricCard
                title="Average inter-purchase interval (selected period)"
                value={revenue.history.averageInterPurchaseIntervalInPeriod.status === "ok" ? `${revenue.history.averageInterPurchaseIntervalInPeriod.averageDays} days` : "Insufficient data"}
                description="Fewer than 2 qualifying invoice dates in the period -- never shown as 0."
                dataQuality="calculated"
              />
            </div>
          </SectionCard>

          {/* --- Product purchasing (period-scoped for all four figures) --- */}
          <SectionCard title="Product purchasing" description={`Selected period only (${purchasing.periodFrom} to ${purchasing.periodTo}) -- quantity, value, frequency and last-purchased are all scoped to this same period.`}>
            {purchasing.products.length === 0 ? (
              <EmptyState message="No qualifying invoice lines for this customer in the selected period." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">SAP item</th>
                      <th className="px-5 py-3 font-semibold">Description</th>
                      <th className="px-5 py-3 font-semibold">Match</th>
                      <th className="px-5 py-3 font-semibold">Category</th>
                      <th className="px-5 py-3 font-semibold">Quantity by unit</th>
                      <th className="px-5 py-3 font-semibold">{purchasing.metricLabel} by currency</th>
                      <th className="px-5 py-3 font-semibold">Frequency</th>
                      <th className="px-5 py-3 font-semibold">Last purchased</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {purchasing.products.map((p) => (
                      <tr key={p.sapItemCode} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-mono text-xs text-[#536158]">{p.sapItemCode}</td>
                        <td className="px-5 py-3 text-[#17251E]">{p.description ?? "—"}</td>
                        <td className="px-5 py-3">
                          {p.productMasterMatch.matched ? (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Matched</span>
                          ) : (
                            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Not matched to product master</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-[#536158]">{p.productMasterMatch.matched ? p.productMasterMatch.category : "—"}</td>
                        <td className="px-5 py-3 text-[#536158]">{p.quantityByUnit.map((u) => `${u.quantityTotal} ${u.unitOfMeasure}`).join(" · ")}</td>
                        <td className="px-5 py-3 text-[#536158]">{p.valueByCurrency.map((v) => `${v.lineValueTotal} ${v.currency}`).join(" · ")}</td>
                        <td className="px-5 py-3 font-semibold text-[#17251E]">{p.purchaseFrequencyInPeriod}</td>
                        <td className="px-5 py-3 text-[#536158]">{p.lastPurchasedDateInPeriod ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="mt-4 text-xs leading-5 text-[#9AA59E]">{purchasing.categoryDataQualityNote}</p>
          </SectionCard>

          {/* --- Lost sales --- */}
          <SectionCard title="Lost sales" description="Confirmed lost sales linked to this customer, via the existing LostSaleRecord -> UnfulfilledDemand relationship.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <MetricCard title="Confirmed lost sales" value={String(lostSales.confirmedCount)} dataQuality="actual" />
              <MetricCard title="Confirmed lost quantity" value={lostSales.confirmedQuantity} dataQuality="actual" />
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
            {lostSales.confirmedCount === 0 && <EmptyState message="No confirmed lost sales for this customer in the selected period." />}
          </SectionCard>

          {/* --- Commercial health: claims / returns / actual credit notes (primary evidence) --- */}
          <SectionCard
            title="Commercial health"
            description={`As of ${commercialHealth.asOfDate} (${commercialHealth.asOfDateSource === "live-business-date" ? "today, Africa/Harare" : "selected date range"}). Claims, returns and credit notes are kept as separate figures -- never merged into one score.`}
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <MetricCard title="Claims raised (selected period)" value={String(commercialHealth.claims.raisedInPeriodCount)} dataQuality="actual" />
              <MetricCard
                title={`Claims open (as of ${commercialHealth.asOfDate})`}
                value={String(commercialHealth.claims.openAsOfReportingDateCount)}
                description="Approximated from claimDate/closedAt -- this schema has no event-sourced status history."
                dataQuality="calculated"
              />
              <MetricCard
                title="Credit notes excluded from period figure"
                value={String(commercialHealth.actualCreditNotes.excludedFromPeriodNoDateCount)}
                description="Credit notes with no recorded date -- still counted in the all-time cumulative total below, never silently dropped."
                dataQuality="missing"
              />
            </div>

            {commercialHealth.claims.exposureByCurrency.length > 0 && (
              <div className="mt-5">
                <p className="mb-2 text-xs font-semibold text-[#718078]">Claim exposure by currency (all-time, current state -- claim-centric, from InvoiceClaim)</p>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                      <tr>
                        <th className="px-5 py-2 font-semibold">Currency</th>
                        <th className="px-5 py-2 font-semibold">Claims</th>
                        <th className="px-5 py-2 font-semibold">Potential credit exposure</th>
                        <th className="px-5 py-2 font-semibold">Approved credit exposure</th>
                        <th className="px-5 py-2 font-semibold">Actual SAP-credited (per-claim running total)</th>
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
                <p className="mb-2 text-xs font-semibold text-[#718078]">Physical returns by condition (selected period)</p>
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
                <p className="mb-2 text-xs font-semibold text-[#718078]">Actual credit notes -- in period (claim-linked + direct-invoice-linked, never double-counted)</p>
                {commercialHealth.actualCreditNotes.inPeriodByCurrency.length === 0 ? (
                  <EmptyState message="No credit notes with a date inside the selected period." />
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
          </SectionCard>

          {/* --- Delivery outcomes: secondary, operational signal, kept separate --- */}
          <SectionCard title={commercialHealth.delivery.label} description="Never combined with claims, returns or credit notes above, and never used to calculate a rejection rate.">
            {commercialHealth.delivery.rejectionsInPeriod.length === 0 ? (
              <EmptyState message="No rejected deliveries for this customer in the selected period." />
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {commercialHealth.delivery.rejectionsInPeriod.map((row) => (
                  <MetricCard key={row.outcome} title={titleCase(row.outcome)} value={String(row.count)} dataQuality="actual" />
                ))}
              </div>
            )}
          </SectionCard>

          {/* --- Orders + salesperson attribution --- */}
          <SectionCard title="Orders & salesperson attribution" description="Attribution confidence is reused verbatim from Milestone 12 -- never a competing classification.">
            {salespersonRelationship.ordersBySalesperson.length === 0 ? (
              <EmptyState message="No orders on record for this customer." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Salesperson</th>
                      <th className="px-5 py-3 font-semibold">Orders</th>
                      <th className="px-5 py-3 font-semibold">Attribution breakdown</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {salespersonRelationship.ordersBySalesperson.map((row) => (
                      <tr key={row.salespersonId ?? "unassigned"}>
                        <td className="px-5 py-3 font-medium text-[#17251E]">{row.salespersonName}</td>
                        <td className="px-5 py-3">{row.orderCount}</td>
                        <td className="px-5 py-3 text-[#536158]">
                          {Object.entries(row.attributionBreakdown)
                            .map(([bucket, count]) => `${ATTRIBUTION_BUCKET_LABELS[bucket as keyof typeof ATTRIBUTION_BUCKET_LABELS] ?? titleCase(bucket)}: ${count}`)
                            .join(" · ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* --- Quotations + provenance (no classification applied) --- */}
          <SectionCard title="Quotations" description="Salesperson and prepared-by are shown as recorded -- Quotation.salespersonId is a required field, and no attribution-confidence classification is applied to quotations.">
            {salespersonRelationship.quotationProvenance.length === 0 ? (
              <EmptyState message="No quotations on record for this customer." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Quotation</th>
                      <th className="px-5 py-3 font-semibold">Rev.</th>
                      <th className="px-5 py-3 font-semibold">Salesperson</th>
                      <th className="px-5 py-3 font-semibold">Prepared by</th>
                      <th className="px-5 py-3 font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {salespersonRelationship.quotationProvenance.map((row) => (
                      <tr key={row.quotationId}>
                        <td className="px-5 py-3 font-mono text-xs text-[#536158]">{row.quotationNumber}</td>
                        <td className="px-5 py-3">{row.revisionNumber}</td>
                        <td className="px-5 py-3 text-[#17251E]">{row.salespersonName}</td>
                        <td className="px-5 py-3 text-[#536158]">{row.preparedByName}</td>
                        <td className="px-5 py-3 text-[#536158]">{titleCase(row.status)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {/* --- Data quality --- */}
          <SectionCard title="Data quality for this customer" description="Scoped to this customer only -- reuses the exact unmatched/no-usable-date definitions established in Milestone 12.">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MetricCard title="Unattributed invoices" value={String(dataQuality.unattributedInvoiceCount)} dataQuality="missing" />
              <MetricCard title={`Unattributed ${dataQuality.unattributedInvoiceValueLabel.toLowerCase()}`} value={dataQuality.unattributedInvoiceValue} dataQuality="missing" />
              <MetricCard title="Invoices with no usable date" value={String(dataQuality.invoicesWithNoUsableDateCount)} dataQuality="missing" />
            </div>
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
