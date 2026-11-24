import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getInvoiceClaimsDashboard } from "@/lib/invoice-claims/dashboard";
import { getClaimComposition } from "@/lib/invoice-claims/composition-queries";
import { CLAIM_STATUS_LABELS, CLAIM_CATEGORY_LABELS } from "@/lib/invoice-claims/display";
import { CLAIM_LINE_REASON_CATEGORY_LABELS } from "@/lib/invoice-claims/validation";
import { formatCount, formatMoney } from "@/lib/format/analytics";
import { KpiCard } from "@/components/kpi/kpi-card";
import Sidebar from "../../components/sidebar";
import { SectionCard } from "../../reports/_components/ui";
import { ClaimCompositionChart, ClaimExposureChart } from "./_components/claims-charts";
import { getUnifiedLostSalesReport } from "@/lib/lost-sales/unified-queries";
import { ReasonAnalyticsSection } from "../../reports/_components/reason-analytics-section";
import { UnifiedLostSalesSummary } from "../../reports/_components/unified-lost-sales-summary";
import { ArrowLeft } from "lucide-react";

/**
 * Milestone 6A. Claims dashboard (spec section 8): counts by status/
 * category, top customers and departments, products with recurring
 * quality problems, financial exposure by currency, average resolution
 * time, repeat complaints. Every bucket drills down by linking to
 * /invoice-claims with the matching filter.
 */
export const instant = false;

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function readDate(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !DATE_ONLY.test(v)) return null;
  return Number.isNaN(new Date(`${v}T00:00:00.000Z`).getTime()) ? null : v;
}

export default async function InvoiceClaimsDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const params = await searchParams;
  let dateFrom = readDate(params.dateFrom);
  let dateTo = readDate(params.dateTo);
  if (dateFrom && dateTo && dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
  const periodLabel = dateFrom || dateTo ? `${dateFrom ?? "start"} to ${dateTo ?? "today"}` : "All dates";

  const [dashboard, composition, unresolved, unifiedReport] = await Promise.all([
    getInvoiceClaimsDashboard({}),
    getClaimComposition({ topProducts: 8 }),
    getClaimComposition({ unresolvedOnly: true, topProducts: 1 }),
    getUnifiedLostSalesReport({ includeDemo: false, customerId: null, dateFrom, dateTo }),
  ]);

  const reasonLabels = CLAIM_LINE_REASON_CATEGORY_LABELS as Record<string, string>;
  const compositionRows = composition.rows.map((row) => ({
    label: row.description ?? row.sapItemCode ?? "(unnamed product)",
    unit: row.unit,
    delivered: row.delivered,
    deliveredComplete: row.deliveredComplete,
    accepted: row.accepted,
    rejected: row.rejected,
    returned: row.returned,
    value: row.valueByCurrency[0]?.value ?? null,
    currency: row.valueByCurrency[0]?.currency ?? null,
    reason: row.topReason ? reasonLabels[row.topReason.reasonCategory] ?? row.topReason.reasonCategory : null,
  }));

  const totalClaims = Object.values(dashboard.statusCounts).reduce((sum, n) => sum + n, 0);
  const terminal = (dashboard.statusCounts.RESOLVED ?? 0) + (dashboard.statusCounts.REJECTED ?? 0) + (dashboard.statusCounts.CLOSED ?? 0);
  const unresolvedCount = totalClaims - terminal;
  const unresolvedExposure = unresolved.summary.valueByCurrency;
  const unresolvedExposureText =
    unresolvedExposure.length === 0
      ? formatMoney(0)
      : unresolvedExposure.length === 1
        ? formatMoney(unresolvedExposure[0].value, unresolvedExposure[0].currency)
        : `${formatMoney(unresolvedExposure[0].value, unresolvedExposure[0].currency)} +${unresolvedExposure.length - 1} more`;

  const statusEntries = Object.entries(dashboard.statusCounts).filter(([, count]) => count > 0);
  const categoryEntries = Object.entries(dashboard.categoryCounts).filter(([, count]) => count > 0);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Invoice Claims / Dashboard</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Claims Dashboard</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/invoice-claims" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to claims queue
          </Link>

          <section aria-label="Key figures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <KpiCard title="Total claims" value={formatCount(totalClaims)} description="Every claim raised, any status." href="/invoice-claims" hrefLabel="Open the claims queue" />
            <KpiCard
              title="Unresolved claims"
              value={formatCount(unresolvedCount)}
              description="Not yet resolved, rejected or closed."
              href="/invoice-claims?status=OPEN"
              hrefLabel="View open claims"
              polarity="down-good"
            />
            <KpiCard
              title="Unresolved claim exposure"
              value={unresolvedExposureText}
              description={
                unresolved.summary.valueIncompleteLines > 0
                  ? `Disputed value of unresolved claims at invoice prices. ${unresolved.summary.valueIncompleteLines} line(s) have no price and are excluded. Not a SAP credit note.`
                  : "Disputed value of unresolved claims at invoice prices. Not a SAP credit note."
              }
            />
            <KpiCard
              title="Average resolution time"
              value={dashboard.averageResolutionDays !== null ? `${dashboard.averageResolutionDays.toFixed(1)} days` : null}
              stateMessage="No concluded claims yet."
              description="Claim date to resolution, concluded claims only."
            />
          </section>

          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {statusEntries.map(([status, count]) => (
              <Link
                key={status}
                href={`/invoice-claims?status=${status}`}
                className="rounded-xl border border-[#E8EBE6] bg-white p-4 transition hover:border-[#173D2E]/30"
              >
                <p className="text-2xl font-bold text-[#17251E]">{count}</p>
                <p className="mt-1 text-[11px] text-gray-500">{CLAIM_STATUS_LABELS[status] ?? status}</p>
              </Link>
            ))}
          </section>

          <SectionCard
            title="Claim composition by rejected product"
            description={`Delivered, accepted, rejected and returned quantity for the ${compositionRows.length} most-rejected product(s). Each product is in its own unit; quantities are never added across products.${composition.truncated ? " Showing the first 20,000 claim lines only." : ""}`}
          >
            <ClaimCompositionChart rows={compositionRows} />
          </SectionCard>

          <form method="get" className="flex flex-wrap items-end gap-3 rounded-2xl border border-[#E7ECE7] bg-white p-4" aria-label="Date range for reason analysis">
            <label className="text-xs font-semibold text-[#718078]">From<input type="date" name="dateFrom" defaultValue={dateFrom ?? ""} className="mt-1 block rounded-lg border border-[#E7ECE7] px-3 py-2 text-sm text-[#17251E]" /></label>
            <label className="text-xs font-semibold text-[#718078]">To<input type="date" name="dateTo" defaultValue={dateTo ?? ""} className="mt-1 block rounded-lg border border-[#E7ECE7] px-3 py-2 text-sm text-[#17251E]" /></label>
            <button type="submit" className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#223A2E]">Apply</button>
            {(dateFrom || dateTo) && <Link href="/invoice-claims/dashboard" className="py-2 text-sm font-semibold text-[#718078] hover:text-[#17251E]">Clear</Link>}
            <p className="basis-full text-[11px] text-[#718078]">The date range (by claim date) applies to the lost-sales and reason analysis below. The counts, composition and exposure tables above and below it show all claims.</p>
          </form>

          <UnifiedLostSalesSummary unified={unifiedReport.unified} periodLabel={periodLabel} />

          <ReasonAnalyticsSection breakdown={unifiedReport.reasons} periodLabel={periodLabel} truncated={unifiedReport.truncated} />

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Financial impact" description="Claimed vs approved vs actually credited by SAP, one chart per currency -- never blended">
              {dashboard.exposureByCurrency.length === 0 ? (
                <p className="p-10 text-center text-sm text-[#849087]">No claims yet.</p>
              ) : (
                <div className="space-y-4">
                  {dashboard.exposureByCurrency.map((row) => (
                    <div key={row.currencyCode}>
                      <p className="mb-1 text-xs font-semibold text-gray-600">{row.currencyCode} · {row.claimCount} claim(s)</p>
                      <ClaimExposureChart row={{ currency: row.currencyCode, potential: row.potentialCreditExposure, approved: row.approvedCreditExposure, credited: row.actualSapCreditedAmount }} />
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">By category</h3>
              <ul className="mt-3 space-y-1.5 text-xs">
                {categoryEntries.map(([category, count]) => (
                  <li key={category} className="flex justify-between">
                    <span className="text-gray-600">{CLAIM_CATEGORY_LABELS[category] ?? category}</span>
                    <span className="font-semibold text-gray-700">{count}</span>
                  </li>
                ))}
                {categoryEntries.length === 0 && <li className="text-gray-400">No claims yet.</li>}
              </ul>
            </div>

            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Top customers by claim volume</h3>
              <ul className="mt-3 space-y-1.5 text-xs">
                {dashboard.byCustomer.slice(0, 10).map((row) => (
                  <li key={row.customerId} className="flex justify-between">
                    <Link href={`/invoice-claims?customerId=${row.customerId}`} className="text-gray-600 hover:underline">{row.customerName}</Link>
                    <span className="font-semibold text-gray-700">{row.claimCount}</span>
                  </li>
                ))}
                {dashboard.byCustomer.length === 0 && <li className="text-gray-400">No claims yet.</li>}
              </ul>
            </div>

            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Products with recurring quality problems</h3>
              <ul className="mt-3 space-y-1.5 text-xs">
                {dashboard.byProduct.slice(0, 10).map((row) => (
                  <li key={row.sapItemCode} className="flex justify-between">
                    <span className="text-gray-600">{row.sapItemCode} {row.sapItemDescription ? `-- ${row.sapItemDescription}` : ""}</span>
                    <span className="font-semibold text-gray-700">{row.claimLineCount} claim lines ({row.qualityIssueCount} quality)</span>
                  </li>
                ))}
                {dashboard.byProduct.length === 0 && <li className="text-gray-400">No disputed lines yet.</li>}
              </ul>
            </div>

            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Responsible departments</h3>
              <ul className="mt-3 space-y-1.5 text-xs">
                {dashboard.byResponsibleDepartment.map((row) => (
                  <li key={row.department} className="flex justify-between">
                    <span className="text-gray-600">{row.department}</span>
                    <span className="font-semibold text-gray-700">{row.claimCount}</span>
                  </li>
                ))}
                {dashboard.byResponsibleDepartment.length === 0 && <li className="text-gray-400">No resolution has named a responsible department yet.</li>}
              </ul>
            </div>
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h3 className="text-sm font-bold text-[#17251E]">Financial exposure by currency</h3>
            <p className="mt-1 text-[11px] text-gray-400">Never converted between currencies. &ldquo;Potential&rdquo; and &ldquo;approved&rdquo; are internal estimates; &ldquo;Actual SAP credited&rdquo; is the sum of credit notes recorded against these claims. Claims are not credit notes.</p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-gray-400">
                    <th className="py-2 pr-4 font-semibold uppercase tracking-wider">Currency</th>
                    <th className="py-2 pr-4 text-right font-semibold uppercase tracking-wider">Claims</th>
                    <th className="py-2 pr-4 text-right font-semibold uppercase tracking-wider">Potential credit exposure</th>
                    <th className="py-2 pr-4 text-right font-semibold uppercase tracking-wider">Approved credit exposure</th>
                    <th className="py-2 text-right font-semibold uppercase tracking-wider">Actual SAP credited</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.exposureByCurrency.map((row) => (
                    <tr key={row.currencyCode} className="border-t border-gray-100">
                      <td className="py-2 pr-4 font-semibold text-gray-700">{row.currencyCode}</td>
                      <td className="py-2 pr-4 text-right text-gray-600">{row.claimCount}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{formatMoney(row.potentialCreditExposure, row.currencyCode)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{formatMoney(row.approvedCreditExposure, row.currencyCode)}</td>
                      <td className="py-2 text-right tabular-nums text-gray-600">{formatMoney(row.actualSapCreditedAmount, row.currencyCode)}</td>
                    </tr>
                  ))}
                  {dashboard.exposureByCurrency.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-4 text-center text-gray-400">No claims yet.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Average resolution time</h3>
              <p className="mt-2 text-2xl font-bold text-[#17251E]">
                {dashboard.averageResolutionDays !== null ? `${dashboard.averageResolutionDays.toFixed(1)} days` : "No concluded claims yet"}
              </p>
            </div>
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h3 className="text-sm font-bold text-[#17251E]">Repeat complaints</h3>
              {dashboard.repeatComplaintCustomers.length === 0 ? (
                <p className="mt-2 text-xs text-gray-400">No customer has filed more than one claim yet.</p>
              ) : (
                <ul className="mt-2 space-y-1.5 text-xs">
                  {dashboard.repeatComplaintCustomers.slice(0, 10).map((row) => (
                    <li key={row.customerId} className="flex justify-between">
                      <Link href={`/invoice-claims?customerId=${row.customerId}`} className="text-gray-600 hover:underline">{row.customerName}</Link>
                      <span className="font-semibold text-gray-700">{row.claimCount} claims</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
