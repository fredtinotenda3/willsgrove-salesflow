import { fmtMoney } from "@/lib/admin/format";
import type { OrderTotalSummary } from "@/lib/order-totals";

/**
 * Renders an order total from the shared summary. Currency is always shown;
 * an unavailable total is a visible data-quality warning, never "0.00" or a
 * silent dash; a partial total is labelled as such.
 */
export function OrderTotalCell({ total }: { total: OrderTotalSummary }) {
  if (total.amount === null) {
    return <span title={total.warning ?? undefined} className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">No price</span>;
  }
  return (
    <span title={total.warning ?? undefined}>
      <span className="tabular-nums">{fmtMoney(total.currency, total.amount)}</span>
      {total.basis === "PARTIAL" ? <span className="ml-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">partial</span> : null}
      {total.basis === "CALCULATED" ? <span className="ml-1 text-[10px] text-[#849087]">calc.</span> : null}
    </span>
  );
}
