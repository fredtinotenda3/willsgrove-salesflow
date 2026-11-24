import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getManagementPack } from "@/lib/reporting/management-pack";
import { isPackPeriodKind, resolvePackPeriod, shiftPackAnchor } from "@/lib/reporting/management-pack-period";
import { formatMoney, formatPercent, formatQuantity } from "@/lib/format/analytics";
import { KpiCard } from "@/components/kpi/kpi-card";
import Sidebar from "../../../components/sidebar";
import { PageHeader, SectionCard } from "../../_components/ui";
import { PrintButton } from "./print-button";
import { ChevronLeft, ChevronRight, Download } from "lucide-react";

export const instant = false;

type PackSearchParams = { kind?: string | string[]; anchor?: string | string[] };

function first(value: string | string[] | undefined): string | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

// Print layout: hide the app chrome, drop the sidebar offset, keep cards whole across pages.
const PRINT_CSS = `
@media print {
  aside, [data-print-hide] { display: none !important; }
  main { padding-left: 0 !important; }
  header.sticky { position: static !important; }
  section, table, tr { break-inside: avoid; }
  body { background: #fff !important; }
}`;

export default async function ManagementPackPage({ searchParams }: { searchParams: Promise<PackSearchParams> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  // UX redirect only; the export route and every management API re-check the role server-side.
  if (user.role !== "SALES_MANAGER" && user.role !== "ADMINISTRATOR") redirect("/reports");

  const params = await searchParams;
  const rawKind = first(params.kind);
  const kind = isPackPeriodKind(rawKind) ? rawKind : "week";
  const period = resolvePackPeriod(kind, first(params.anchor));
  const pack = await getManagementPack(user.id, user.role, period);

  const prev = shiftPackAnchor(period, -1);
  const next = shiftPackAnchor(period, 1);
  const nextIsFuture = next > new Date().toISOString().slice(0, 10);
  const q = (k: string, anchor?: string) => `/reports/management/pack?kind=${k}${anchor ? `&anchor=${anchor}` : ""}`;
  const exportHref = `/api/reports/management/pack/export?kind=${kind}&anchor=${period.dateFrom}`;

  const tab = (k: "week" | "month", label: string) => (
    <Link href={q(k)} aria-current={kind === k ? "page" : undefined} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${kind === k ? "bg-[#17251E] text-white" : "text-[#718078] hover:bg-gray-100"}`}>
      {label}
    </Link>
  );

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <style>{PRINT_CSS}</style>
      <Sidebar />
      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Management Reports / Management pack</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Management pack</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Management Reports"
            title={`${kind === "week" ? "Weekly" : "Monthly"} management pack`}
            description={`${pack.period.label} (${pack.period.dateFrom} to ${pack.period.dateTo})${pack.period.isComplete ? "" : " - period still running, figures are to date"}. Compared with ${pack.period.priorLabel}.`}
            actions={
              <div data-print-hide className="flex flex-wrap items-center gap-3">
                <PrintButton />
                <a href={exportHref} className="inline-flex items-center gap-2 rounded-xl bg-[#17251E] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#223A2E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#496A42]">
                  <Download size={15} aria-hidden /> Download Excel
                </a>
              </div>
            }
          />

          <nav data-print-hide aria-label="Pack period" className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-xl border border-[#E7ECE7] bg-white p-1">{tab("week", "Weekly")}{tab("month", "Monthly")}</div>
            <Link href={q(kind, prev)} className="inline-flex items-center gap-1 rounded-lg border border-[#E7ECE7] bg-white px-3 py-1.5 text-sm text-[#17251E] hover:bg-gray-50"><ChevronLeft size={14} aria-hidden /> Previous</Link>
            {nextIsFuture ? (
              <span aria-disabled className="inline-flex items-center gap-1 rounded-lg border border-[#E7ECE7] bg-gray-50 px-3 py-1.5 text-sm text-gray-400">Next <ChevronRight size={14} aria-hidden /></span>
            ) : (
              <Link href={q(kind, next)} className="inline-flex items-center gap-1 rounded-lg border border-[#E7ECE7] bg-white px-3 py-1.5 text-sm text-[#17251E] hover:bg-gray-50">Next <ChevronRight size={14} aria-hidden /></Link>
            )}
          </nav>

          <section aria-label="Key measures" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {pack.kpis.map((kpi) => (
              <KpiCard
                key={kpi.id}
                title={kpi.label}
                value={kpi.value}
                description={kpi.definition}
                variant={kpi.previousValue !== null ? "comparison" : "default"}
                change={kpi.changePercent}
                polarity={kpi.polarity}
                comparisonLabel="vs. previous period"
                previousValue={kpi.previousValue ?? undefined}
              />
            ))}
          </section>

          <SectionCard title="Invoiced revenue" description="SAP invoice line values for invoices dated in the period, per currency. Never added across currencies.">
            {pack.revenue.length === 0 ? (
              <p className="text-sm text-[#718078]">No invoiced revenue recorded for this period.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-2 pr-4">Currency</th><th className="py-2 pr-4 text-right">This period</th><th className="py-2 pr-4 text-right">Previous period</th><th className="py-2 text-right">Change</th></tr></thead>
                <tbody>
                  {pack.revenue.map((row) => (
                    <tr key={row.currency} className="border-b border-[#EEF1ED]">
                      <td className="py-2 pr-4 font-semibold">{row.currency}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatMoney(row.value, row.currency)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-gray-600">{row.previousValue ? formatMoney(row.previousValue, row.currency) : "n/a"}</td>
                      <td className="py-2 text-right tabular-nums">{row.changePercent === null ? "n/a" : `${row.changePercent >= 0 ? "+" : ""}${formatPercent(row.changePercent, 1)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>

          <SectionCard title="Unresolved claims exposure" description="As at generation time, not limited to the period. Disputed value at invoice prices; a claim is not a SAP credit note.">
            <p className="mb-4 text-sm text-[#17251E]">
              <span className="font-bold tabular-nums">{pack.unresolvedClaims.claimLineCount}</span> unresolved claim line(s) ·{" "}
              {pack.unresolvedClaims.exposure.length === 0 ? "no priced disputed value" : pack.unresolvedClaims.exposure.map((e) => formatMoney(e.value, e.currency)).join(" + ")}
              {pack.unresolvedClaims.linesWithoutPrice > 0 && <span className="text-[#718078]"> · {pack.unresolvedClaims.linesWithoutPrice} line(s) have no price and are excluded</span>}
            </p>
            {pack.unresolvedClaims.topProducts.length > 0 && (
              <table className="w-full text-sm">
                <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-2 pr-4">Rejected product</th><th className="py-2 pr-4 text-right">Delivered</th><th className="py-2 pr-4 text-right">Accepted</th><th className="py-2 pr-4 text-right">Rejected</th><th className="py-2 pr-4 text-right">Returned</th><th className="py-2 text-right">Value</th></tr></thead>
                <tbody>
                  {pack.unresolvedClaims.topProducts.map((p) => (
                    <tr key={p.name} className="border-b border-[#EEF1ED]">
                      <td className="py-2 pr-4 font-medium">{p.name}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatQuantity(p.delivered, p.unit)}{!p.deliveredComplete && "*"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatQuantity(p.accepted, p.unit)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatQuantity(p.rejected, p.unit)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatQuantity(p.returned, p.unit)}</td>
                      <td className="py-2 text-right tabular-nums">{p.value.length === 0 ? "n/a" : p.value.map((v) => formatMoney(v.value, v.currency)).join(" + ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {pack.unresolvedClaims.topProducts.some((p) => !p.deliveredComplete) && <p className="mt-2 text-[11px] text-[#718078]">*Some claim lines have no linked invoice line, so delivered quantity is understated.</p>}
          </SectionCard>

          <section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            <SectionCard title="Repeated shortages" description="Products that ran short on three or more separate orders in the period.">
              {pack.repeatedShortages.length === 0 ? (
                <p className="text-sm text-[#718078]">No product ran short repeatedly in this period.</p>
              ) : (
                <ul className="divide-y divide-[#EEF1ED] text-sm">
                  {pack.repeatedShortages.map((s) => (
                    <li key={`${s.sapItemCode ?? s.name}`} className="flex justify-between gap-3 py-2"><span className="font-medium">{s.name}</span><span className="tabular-nums text-[#718078]">{s.demandCount} orders · {formatQuantity(s.unavailableQuantity, s.unit)}</span></li>
                  ))}
                </ul>
              )}
            </SectionCard>
            <SectionCard title="Exceptions" description="Open items as at generation time.">
              {pack.exceptions.length === 0 ? (
                <p className="text-sm text-[#718078]">No open exceptions.</p>
              ) : (
                <ul className="divide-y divide-[#EEF1ED] text-sm">
                  {pack.exceptions.map((e) => (
                    <li key={e.label} className="flex justify-between gap-3 py-2"><span>{e.label}</span><span className="font-semibold tabular-nums">{e.count}</span></li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </section>

          <SectionCard title="Notes on these figures">
            <ul className="list-disc space-y-1 pl-5 text-xs text-[#718078]">
              {pack.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
            <p className="mt-3 text-[11px] text-[#A6AFA4]">Generated {new Date(pack.generatedAt).toUTCString()}</p>
          </SectionCard>
        </div>
      </main>
    </div>
  );
}
