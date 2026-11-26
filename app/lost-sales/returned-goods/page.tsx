import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDeliveryReturnRows, getDeliveryReturnSummary } from "@/lib/lost-sales/delivery-returns";
import { getReturnedGoodsLostSalesValue } from "@/lib/returns-credits/lost-sale-analytics";
import { getAutomaticLostSalesValue } from "@/lib/lost-sales/queries";
import { combineLostSales } from "@/lib/lost-sales/overall";
import { CLAIM_LINE_REASON_CATEGORY_LABELS, type AnyStoredClaimLineReasonCategory } from "@/lib/invoice-claims/validation";
import Sidebar from "../../components/sidebar";
import { PackageX, RotateCcw } from "lucide-react";
import { formatCurrencyAmount } from "@/lib/format/currency";

/**
 * Confirmed Loss (Returned Goods) -- the drill-down behind the dashboard card.
 *
 * Every row is one DeliveryLine with a rejected quantity: the product-level
 * outcome recorded in Record Delivery. The headline figures are computed by
 * the same service (lib/lost-sales/delivery-returns.ts) the dashboard card
 * uses, so the card and this list always reconcile.
 *
 * Unfulfilled Demand is a DIFFERENT business event (never supplied) and is
 * shown in its own section; the combined table adds the two per currency,
 * which cannot double count because the quantities are disjoint.
 */
export const instant = false;

const PAGE_SIZE = 25;

type RouteParams = { searchParams: Promise<{ page?: string; customerId?: string; from?: string; to?: string }> };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export default async function ReturnedGoodsPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const requestedPage = Number(params.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const from = params.from && DATE_ONLY.test(params.from) ? params.from : undefined;
  const to = params.to && DATE_ONLY.test(params.to) ? params.to : undefined;
  const dateRange = {
    ...(from ? { gte: new Date(`${from}T00:00:00.000Z`) } : {}),
    ...(to ? { lt: new Date(new Date(`${to}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000) } : {}),
  };
  const filters = { includeDemo: false, customerId: params.customerId || undefined, dateRange };

  const [{ rows, totalMatching }, summary, headline, unfulfilled] = await Promise.all([
    listDeliveryReturnRows(filters, { take: PAGE_SIZE, skip: (page - 1) * PAGE_SIZE }),
    getDeliveryReturnSummary(filters),
    getReturnedGoodsLostSalesValue(),
    getAutomaticLostSalesValue(),
  ]);

  const combined = combineLostSales(
    headline.byCurrency.map((bucket) => ({ currencyCode: bucket.currencyCode, value: bucket.estimatedValue })),
    unfulfilled.estimatedValue
  );
  const totalPages = Math.max(1, Math.ceil(totalMatching / PAGE_SIZE));
  const query = (next: number) => {
    const q = new URLSearchParams();
    if (params.customerId) q.set("customerId", params.customerId);
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    q.set("page", String(next));
    return `/lost-sales/returned-goods?${q.toString()}`;
  };

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Lost Sales</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Confirmed Loss (Returned Goods)</h2>
          </div>
          <Link href="/lost-sales" className="flex items-center gap-2 rounded-xl border border-[#D7E0D5] px-4 py-2 text-xs font-semibold text-[#17251E] hover:bg-gray-50">
            <PackageX size={14} /> Unfulfilled Demand
          </Link>
        </header>

        <div className="space-y-6 p-8">
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Returned goods</h1>
            <p className="mt-1 text-sm text-gray-500">
              Products rejected at delivery and returned to Willsgrove. Each row is the product-level outcome recorded in Record Delivery:
              ordered, delivered, and returned quantities, with the reason. Only the returned quantity counts as lost -- delivered units never do.
            </p>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-4">
              <p className="text-xs text-gray-400">Confirmed loss (all time, by currency)</p>
              {headline.byCurrency.length === 0 ? (
                <p className="mt-1 text-lg font-bold text-[#17251E]">0.00</p>
              ) : (
                headline.byCurrency.map((bucket) => (
                  <p key={bucket.currencyCode} className="mt-1 text-lg font-bold text-[#17251E]">
                    {formatCurrencyAmount(bucket.currencyCode, bucket.estimatedValue)}
                  </p>
                ))
              )}
              <p className="mt-1 text-[11px] text-gray-400">
                {headline.sources.deliveryRejections.recordCount} delivery rejection(s)
                {headline.sources.manualReturns.recordCount > 0 ? ` + ${headline.sources.manualReturns.recordCount} legacy manual return(s)` : ""}
                {headline.recordsWithoutEstimate > 0 ? ` · ${headline.recordsWithoutEstimate} without a price are not valued` : ""}
              </p>
            </div>
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-4">
              <p className="text-xs text-gray-400">In this filter</p>
              <p className="mt-1 text-lg font-bold text-[#17251E]">{summary.recordCount} returned line(s)</p>
              {summary.byCurrency.map((bucket) => (
                <p key={bucket.currencyCode} className="text-xs text-gray-500">
                  {formatCurrencyAmount(bucket.currencyCode, bucket.value)}
                </p>
              ))}
              {summary.unpricedRecordCount > 0 && <p className="mt-1 text-[11px] text-amber-700">{summary.unpricedRecordCount} line(s) have no unit price and carry no value (never counted as zero).</p>}
            </div>
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-4">
              <p className="text-xs text-gray-400">Unfulfilled Demand (separate category)</p>
              <p className="mt-1 text-lg font-bold text-[#17251E]">USD {unfulfilled.estimatedValue}</p>
              <p className="mt-1 text-[11px] text-gray-400">Never supplied -- not counted as returned goods. {unfulfilled.demandsWithoutEstimate > 0 ? `${unfulfilled.demandsWithoutEstimate} without a price.` : ""}</p>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-gray-100 px-6 py-3">
              <h3 className="text-sm font-bold text-[#17251E]">Overall lost sales, per currency (no double counting)</h3>
              <p className="text-[11px] text-gray-400">Returned goods and unfulfilled demand describe different units, so their values add. Unfulfilled demand is priced from USD price lists.</p>
            </div>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="bg-gray-50/70 text-[10px] uppercase tracking-wider text-gray-400">
                  <th className="px-6 py-2">Currency</th>
                  <th className="px-6 py-2 text-right">Returned goods</th>
                  <th className="px-6 py-2 text-right">Unfulfilled demand</th>
                  <th className="px-6 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {combined.length === 0 ? (
                  <tr><td colSpan={4} className="px-6 py-6 text-center text-xs text-gray-400">No lost sales recorded yet.</td></tr>
                ) : (
                  combined.map((row) => (
                    <tr key={row.currencyCode} className="border-t border-gray-100">
                      <td className="px-6 py-2 font-semibold">{row.currencyCode}</td>
                      <td className="px-6 py-2 text-right tabular-nums">{row.returnedGoods}</td>
                      <td className="px-6 py-2 text-right tabular-nums">{row.unfulfilledDemand}</td>
                      <td className="px-6 py-2 text-right font-semibold tabular-nums">{row.total}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>

          <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
            <label className="text-xs text-gray-500">From<input type="date" name="from" defaultValue={from} className="mt-1 block rounded-lg border border-gray-200 px-2 py-1 text-sm" /></label>
            <label className="text-xs text-gray-500">To<input type="date" name="to" defaultValue={to} className="mt-1 block rounded-lg border border-gray-200 px-2 py-1 text-sm" /></label>
            {params.customerId && <input type="hidden" name="customerId" value={params.customerId} />}
            <button type="submit" className="rounded-xl bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white">Apply</button>
            <Link href="/lost-sales/returned-goods" className="text-xs font-semibold text-[#173D2E] hover:underline">Reset</Link>
          </form>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {rows.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <RotateCcw size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">No returned goods</p>
                <p className="mt-1 text-xs text-gray-400">Rejected quantities recorded in Record Delivery appear here automatically.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70 text-[10px] uppercase tracking-wider text-gray-400">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Product</th>
                      <th className="px-4 py-3 text-right">Ordered</th>
                      <th className="px-4 py-3 text-right">Delivered</th>
                      <th className="px-4 py-3 text-right">Returned</th>
                      <th className="px-4 py-3 text-right">Unit price</th>
                      <th className="px-4 py-3 text-right">Value</th>
                      <th className="px-4 py-3">Reason</th>
                      <th className="px-4 py-3">Order</th>
                      <th className="px-4 py-3">Claim</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-gray-100 align-top">
                        <td className="px-4 py-3 text-xs text-gray-500">{row.recordedAt.toISOString().slice(0, 10)}</td>
                        <td className="px-4 py-3 text-xs font-semibold text-[#17251E]">{row.customerName}</td>
                        <td className="px-4 py-3 text-xs">{row.description}{row.sapItemCode ? <span className="block text-[10px] text-gray-400">{row.sapItemCode}</span> : null}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.orderedQuantity}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.deliveredQuantity}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-700">{row.returnedQuantity}{row.unitOfMeasure ? <span className="ml-1 text-[10px] font-normal text-gray-400">{row.unitOfMeasure}</span> : null}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.unitPrice ? formatCurrencyAmount(row.currencyCode, row.unitPrice) : <span className="text-amber-700">No price</span>}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{row.totalValue ? formatCurrencyAmount(row.currencyCode, row.totalValue) : "—"}</td>
                        <td className="px-4 py-3 text-xs">
                          {row.reasonCategory ? CLAIM_LINE_REASON_CATEGORY_LABELS[row.reasonCategory as AnyStoredClaimLineReasonCategory] : (row.reason ?? "—")}
                        </td>
                        <td className="px-4 py-3 text-xs"><Link href={`/orders/${row.orderId}`} className="font-semibold text-[#173D2E] hover:underline">{row.orderReference}</Link></td>
                        <td className="px-4 py-3 text-xs">
                          {row.claimId ? <Link href={`/invoice-claims/${row.claimId}`} className="font-semibold text-[#173D2E] hover:underline">{row.claimReference}</Link> : <span className="text-gray-400">Not yet created</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-3 text-xs text-gray-500">
              <span>Page {page} of {totalPages} · {totalMatching} line(s)</span>
              <span className="flex gap-3">
                {page > 1 && <Link href={query(page - 1)} className="font-semibold text-[#173D2E] hover:underline">Previous</Link>}
                {page < totalPages && <Link href={query(page + 1)} className="font-semibold text-[#173D2E] hover:underline">Next</Link>}
              </span>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
