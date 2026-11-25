import Link from "next/link";
import type { MoneyRow, UnifiedLostSales, UnitQuantityRow } from "@/lib/lost-sales/unified-core";
import { formatMoney, formatQuantity } from "@/lib/format/analytics";
import { SectionCard } from "./ui";

function Qty({ rows }: { rows: UnitQuantityRow[] }) {
  if (rows.length === 0) return <span className="text-[#849087]">None</span>;
  return <>{rows.map((r, i) => <span key={r.unit ?? "none"}>{i > 0 && " · "}{formatQuantity(r.quantity, r.unit)}</span>)}</>;
}
function Money({ rows }: { rows: MoneyRow[] }) {
  if (rows.length === 0) return <span className="text-[#849087]">None</span>;
  return <>{rows.map((r, i) => <span key={r.currency}>{i > 0 && " · "}{formatMoney(r.value, r.currency)}</span>)}</>;
}

/**
 * The six lost-sales measures side by side, each with what it means. They are
 * deliberately NOT added into one number: a rejected quantity is not a
 * confirmed loss, a claim is not a credit note, and currencies/units differ.
 */
export function UnifiedLostSalesSummary({ unified, periodLabel }: { unified: UnifiedLostSales; periodLabel: string }) {
  const items: { title: string; meaning: string; body: React.ReactNode; note?: string }[] = [
    {
      title: "1. Unfulfilled demand",
      meaning: "Requested, but not supplied (never dispatched).",
      body: (
        <>
          <p className="text-lg font-bold"><Qty rows={unified.unfulfilled.quantityByUnit} /></p>
          <p className="text-xs text-[#718078]">{unified.unfulfilled.demandCount} demand record(s) · <Money rows={unified.unfulfilled.value} /> estimated (USD)</p>
        </>
      ),
      note: unified.unfulfilled.demandsWithoutPrice > 0 ? `${unified.unfulfilled.demandsWithoutPrice} record(s) have no price and carry no value.` : undefined,
    },
    {
      title: "2. Rejected after delivery",
      meaning: "Delivered, then rejected on a claim (quantity claims only).",
      body: (
        <>
          <p className="text-lg font-bold"><Qty rows={unified.rejectedAfterDelivery.quantityByUnit} /></p>
          <p className="text-xs text-[#718078]">{unified.rejectedAfterDelivery.claimLineCount} line(s) · <Money rows={unified.rejectedAfterDelivery.valueByCurrency} /> at invoice prices</p>
        </>
      ),
      note: unified.rejectedAfterDelivery.linesWithoutPrice > 0 ? `${unified.rejectedAfterDelivery.linesWithoutPrice} line(s) cannot be priced and carry no value.` : undefined,
    },
    {
      title: "3. Returned goods",
      meaning: "Goods rejected at delivery and returned to Willsgrove (from Record Delivery). Part of rejected, never added to it.",
      body: <p className="text-lg font-bold"><Qty rows={unified.returned.quantityByUnit} /></p>,
    },
    {
      title: "4. Confirmed lost",
      meaning: "Shortage confirmed lost, plus goods returned from delivery (and any legacy manual non-resalable returns). A rejected quantity that was not returned is not confirmed lost.",
      body: (
        <>
          <p className="text-xs"><span className="font-semibold">Shortage:</span> <Qty rows={unified.confirmedLost.shortage.quantityByUnit} /> · <Money rows={unified.confirmedLost.shortage.value} /></p>
          <p className="text-xs"><span className="font-semibold">Returned goods:</span> <Qty rows={unified.confirmedLost.nonResalableReturns.quantityByUnit} /> · <Money rows={unified.confirmedLost.nonResalableReturns.valueByCurrency} /></p>
        </>
      ),
    },
    {
      title: "5. Under dispute / pending",
      meaning: "Disputed value on claims not yet concluded, less what SAP actually credited.",
      body: (
        <>
          <p className="text-lg font-bold"><Money rows={unified.underDisputeByCurrency} /></p>
          <p className="text-xs text-[#718078]">{unified.openClaimCount} open claim(s) of {unified.claimCount}</p>
        </>
      ),
      note: unified.approvedNotYetCreditedByCurrency.length > 0 ? "Approved but not yet credited is shown separately below." : undefined,
    },
    {
      title: "6. Recovered / retained",
      meaning: "Concluded claims where the recorded outcome means the sale was kept (rejected claim, no action, claim rejected, price correction).",
      body: (
        <>
          <p className="text-lg font-bold"><Money rows={unified.retainedByCurrency} /></p>
          <p className="text-xs text-[#718078]">Replacement: <Money rows={unified.replacementByCurrency} /></p>
        </>
      ),
      note: unified.unclassifiedConcludedByCurrency.length > 0 ? "Some concluded claims record no outcome that says kept or lost; they are listed as unclassified below, not guessed." : undefined,
    },
  ];

  return (
    <SectionCard
      title="Lost sales, unified"
      description={`${periodLabel}. Unfulfilled demand and invoice claims in one place, as six separate measures. They are never added into one unexplained number, and currencies and units are never mixed.`}
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <div key={item.title} className="rounded-xl border border-[#E7ECE7] p-4">
            <p className="text-sm font-bold text-[#17251E]">{item.title}</p>
            <p className="mb-2 mt-0.5 text-[11px] text-[#718078]">{item.meaning}</p>
            {item.body}
            {item.note && <p className="mt-2 text-[11px] text-amber-700">{item.note}</p>}
          </div>
        ))}
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 border-t border-[#EEF1ED] pt-3 text-xs sm:grid-cols-2">
        <div className="flex justify-between gap-3"><dt className="text-[#718078]">Disputed value (all claim lines)</dt><dd className="font-semibold tabular-nums"><Money rows={unified.disputedValueByCurrency} /></dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[#718078]">Actually credited (credit notes)</dt><dd className="font-semibold tabular-nums"><Money rows={unified.creditedByCurrency} /></dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[#718078]">Approved, not yet credited</dt><dd className="font-semibold tabular-nums"><Money rows={unified.approvedNotYetCreditedByCurrency} /></dd></div>
        <div className="flex justify-between gap-3"><dt className="text-[#718078]">Concluded, outcome not classified</dt><dd className="font-semibold tabular-nums"><Money rows={unified.unclassifiedConcludedByCurrency} /></dd></div>
      </dl>
      {unified.claimsWhereCreditExceedsDisputed > 0 && (
        <p className="mt-2 text-xs text-amber-700">{unified.claimsWhereCreditExceedsDisputed} claim(s) have more credited than disputed. Review them in <Link className="underline" href="/invoice-claims">Invoice Claims</Link>.</p>
      )}
    </SectionCard>
  );
}
