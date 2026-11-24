import Link from "next/link";
import type { ReasonBreakdown } from "@/lib/lost-sales/unified-core";
import { formatMoney, formatQuantity } from "@/lib/format/analytics";
import { ClaimsByReasonChart, ExposureByReasonChart, QuantityByReasonChart, ReasonTrendChart } from "@/components/charts/claim-reason-charts";
import { SectionCard } from "./ui";

/**
 * The four standardised-reason visuals, rendered identically on the Invoice
 * Claims dashboard and on Lost Sales Analytics (same component, same
 * calculation: lib/lost-sales/unified-core.ts). Currencies get one chart
 * each and quantities one chart per unit, never blended.
 */
export function ReasonAnalyticsSection({ breakdown, periodLabel, truncated }: { breakdown: ReasonBreakdown; periodLabel: string; truncated?: boolean }) {
  const { rows } = breakdown;
  const currencies = [...new Set(rows.flatMap((r) => r.exposureByCurrency.map((e) => e.currency)))].sort();
  const unitTotals = new Map<string, { unit: string | null; total: number }>();
  for (const r of rows) for (const q of r.quantityByUnit) unitTotals.set(q.unit ?? "", { unit: q.unit, total: (unitTotals.get(q.unit ?? "")?.total ?? 0) + Number(q.rejected) });
  const units = [...unitTotals.values()].sort((a, b) => b.total - a.total);
  const unitChartRows = (unit: string | null) =>
    rows.flatMap((r) => {
      const q = r.quantityByUnit.find((x) => x.unit === unit);
      return q ? [{ label: r.label, rejected: q.rejected, returned: q.returned }] : [];
    });

  return (
    <div className="space-y-6">
      <SectionCard
        title="Claims by standardised reason"
        description={`${periodLabel}. Real reason values recorded on claim lines, ranked by number of claims. ${breakdown.totalClaims} claim(s), ${breakdown.totalClaimLines} claim line(s).${truncated ? " Showing the most recent 5,000 claims only." : ""}`}
      >
        <ClaimsByReasonChart rows={rows} totalClaims={breakdown.totalClaims} />
        {rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-gray-500">
                  <th className="py-2 pr-4">Reason</th>
                  <th className="py-2 pr-4 text-right">Claims</th>
                  <th className="py-2 pr-4 text-right">Share</th>
                  <th className="py-2 pr-4 text-right">Open</th>
                  <th className="py-2 pr-4 text-right">Concluded</th>
                  <th className="py-2">Most affected</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.reasonCategory} className="border-b border-[#EEF1ED] align-top">
                    <td className="py-2 pr-4 font-medium">{r.label}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.claimCount}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.claimSharePercent === null ? "—" : `${r.claimSharePercent.toFixed(1)}%`}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.openClaimCount}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{r.concludedClaimCount}</td>
                    <td className="py-2 text-xs text-[#718078]">
                      {r.topProducts[0] ? `${r.topProducts[0].description ?? r.topProducts[0].sapItemCode ?? "Unknown product"} (${r.topProducts[0].claimLineCount})` : "—"}
                      {r.topCustomers[0] ? ` · ${r.topCustomers[0].customerName} (${r.topCustomers[0].claimLineCount})` : ""}
                      {r.claimCount > 0 && <> · <Link className="underline" href={`/invoice-claims?q=${encodeURIComponent(r.label)}`}>claims</Link></>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-[#718078]">A claim whose lines have several reasons is counted under each, so shares can add to more than 100%.</p>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Financial exposure by reason" description="Disputed value at the real invoice unit price, one chart per currency. A claim is a dispute, not a credit note, and USD and ZWG are never added together.">
        {currencies.length === 0 ? (
          <p className="p-6 text-center text-sm text-[#849087]">No priced disputed value in this period.</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {currencies.map((currency) => (
              <div key={currency}>
                <p className="mb-1 text-xs font-semibold text-gray-600">
                  {currency} · total {formatMoney(rows.reduce((s, r) => s + Number(r.exposureByCurrency.find((e) => e.currency === currency)?.value ?? 0), 0), currency)}
                </p>
                <ExposureByReasonChart currency={currency} rows={rows.flatMap((r) => { const e = r.exposureByCurrency.find((x) => x.currency === currency); return e ? [{ label: r.label, value: e.value }] : []; })} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Rejected and returned quantity by reason" description="Rejected quantity and physically returned quantity are separate measures: a rejected product is not assumed to have come back. One chart per unit of measure.">
        {units.length === 0 ? (
          <p className="p-6 text-center text-sm text-[#849087]">No rejected quantity in this period.</p>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
            {units.map(({ unit }) => (
              <div key={unit ?? "none"}>
                <p className="mb-1 text-xs font-semibold text-gray-600">Unit: {unit ?? "not recorded"} · rejected {formatQuantity(rows.reduce((s, r) => s + Number(r.quantityByUnit.find((q) => q.unit === unit)?.rejected ?? 0), 0), unit)}</p>
                <QuantityByReasonChart unit={unit} rows={unitChartRows(unit)} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Reason trend"
        description={`Distinct claims per reason by ${breakdown.trend.granularity === "day" ? "day" : breakdown.trend.granularity === "week" ? "week (Monday start)" : "month"}, using the claim date. Periods with no claims show zero because none were recorded; nothing is estimated.`}
      >
        <ReasonTrendChart trend={breakdown.trend} />
      </SectionCard>
    </div>
  );
}
