import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listUnfulfilledDemands } from "@/lib/lost-sales/queries";
import { getLostSalesReportSummary, getAutomaticLostSalesValue } from "@/lib/lost-sales/queries";
import {
  UNFULFILLED_DEMAND_STATUS_LABELS,
  UNFULFILLED_DEMAND_STATUS_STYLES,
} from "@/lib/lost-sales/display";
import { unfulfilledDemandStatusValues } from "@/lib/lost-sales/validation";
import { initialsFor, avatarColorFor } from "@/lib/order-display";
import Sidebar from "../components/sidebar";
import { TrendingDown, ChevronRight, ChevronLeft, PackageX, Ban } from "lucide-react";

/**
 * Milestone 4 (Lost-Sales Management).
 *
 * The /lost-sales list page -- spec section 6's required list of
 * unavailable/unfulfilled demand, plus a handful of the spec section 7
 * figures (total unavailable, total outstanding, total confirmed lost) as
 * plain stat tiles. Deliberately no chart/trend view yet -- "avoid
 * unnecessary dashboard complexity... before advanced BI" (spec section
 * 6) -- the full breakdown (top products/customers/reasons) lives at GET
 * /api/lost-sales/reports for a future, explicitly-asked-for reporting
 * page to build on without any schema change.
 *
 * Real Business Data Onboarding round (spec PART A): the "Awaiting
 * customer decision" tile is gone -- there is no decision step left to
 * await (every shortage is automatically cancelled and confirmed lost the
 * moment it's recorded; see lib/lost-sales/create-unfulfilled-demand.ts).
 * Replaced with "Total unavailable quantity (current)," the natural
 * live-shortage figure now that there's no pending-decision count to show.
 *
 * Same "deliberately simple Server Component list, plain query-string
 * pagination" choice as app/fulfilment/page.tsx.
 */
export const instant = false;

const PAGE_SIZE = 25;

type RouteParams = { searchParams: Promise<{ page?: string; status?: string }> };

export default async function LostSalesPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolved = await searchParams;
  const requestedPage = Number(resolved.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const status =
    resolved.status && unfulfilledDemandStatusValues.includes(resolved.status as (typeof unfulfilledDemandStatusValues)[number])
      ? resolved.status
      : undefined;

  const [{ demands, pagination }, summary, automaticValue] = await Promise.all([
    listUnfulfilledDemands({ page, pageSize: PAGE_SIZE, status }),
    getLostSalesReportSummary(),
    // Real-world fix ("lost sales will also have prices not just
    // quantity... PRICE RECORD SHOULD ALSO BE THERE ON ALL NECESSARY
    // PLACES, EG LOST SALES"): this function already existed (built for
    // the spec's required automatic-estimate KPI) and is already used by
    // the Lost Sales Analytics page -- this plain list page just never
    // called it. Reusing it here, rather than adding a new value sum
    // into getLostSalesReportSummary, keeps the same "never blend a
    // money figure into the quantity-only summary" rule that function's
    // own comment documents.
    getAutomaticLostSalesValue(),
  ]);

  const statusQuery = (targetStatus: string | undefined) => (targetStatus ? `&status=${targetStatus}` : "");

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Lost Sales</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Lost-Sales Management</h2>
          </div>
          <Link
            href="/lost-sales/analytics"
            className="flex items-center gap-2 rounded-xl border border-[#D7E0D5] px-4 py-2 text-xs font-semibold text-[#17251E] transition hover:bg-gray-50"
          >
            <TrendingDown size={14} />
            View analytics
          </Link>
        </header>

        <div className="space-y-6 p-8">
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Unfulfilled Demand</h1>
            <p className="mt-1 text-sm text-gray-500">
              What the warehouse couldn&apos;t supply, automatically cancelled and recorded as a confirmed lost sale
              the moment it was found short -- no customer decision step. For trends, breakdowns and a filterable
              drilldown, see{" "}
              <Link href="/lost-sales/analytics" className="font-semibold text-[#173D2E] hover:underline">
                Lost Sales Analytics
              </Link>
              .
            </p>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="flex items-center gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <PackageX size={18} />
              </div>
              <div>
                <p className="text-lg font-bold text-[#17251E]">{summary.totalUnavailableQuantity}</p>
                <p className="text-xs text-gray-400">Total unavailable quantity (current)</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-cyan-50 text-cyan-600">
                <PackageX size={18} />
              </div>
              <div>
                <p className="text-lg font-bold text-[#17251E]">{summary.totalOutstandingQuantity}</p>
                <p className="text-xs text-gray-400">Outstanding quantity awaiting fulfilment</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <Ban size={18} />
              </div>
              <div>
                <p className="text-lg font-bold text-[#17251E]">{summary.totalConfirmedLostQuantity}</p>
                <p className="text-xs text-gray-400">Confirmed lost quantity (all time)</p>
              </div>
            </div>
            {/* Real-world fix: quantity alone doesn't tell a manager how
                much money is at stake. Deliberately labelled "estimated"
                and caveated, never blended with the quantity tiles above
                -- same "never invent/blend a value" discipline as every
                other money figure in this module (see
                getAutomaticLostSalesValue's own comment). */}
            <div className="flex items-center gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                <TrendingDown size={18} />
              </div>
              <div>
                <p className="text-lg font-bold text-[#17251E]">{automaticValue.estimatedValue}</p>
                <p className="text-xs text-gray-400">
                  Estimated lost value (current)
                  {automaticValue.demandsWithoutEstimate > 0
                    ? ` -- excludes ${automaticValue.demandsWithoutEstimate} demand(s) with no resolvable price`
                    : ""}
                </p>
              </div>
            </div>
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <Link
              href="/lost-sales"
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                !status ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"
              }`}
            >
              All
            </Link>
            {unfulfilledDemandStatusValues.map((value) => (
              <Link
                key={value}
                href={`/lost-sales?page=1${statusQuery(value)}`}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                  status === value ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"
                }`}
              >
                {UNFULFILLED_DEMAND_STATUS_LABELS[value] ?? value}
              </Link>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {demands.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <TrendingDown size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">Nothing here</p>
                <p className="mt-1 text-xs text-gray-400">
                  No unfulfilled-demand records match this filter. A record is created automatically whenever an
                  authorized picking session leaves part of an order unavailable.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Order</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Product</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Requested</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Unavailable</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Outstanding</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Lost</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Lost Value</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {demands.map((demand) => (
                      <tr key={demand.id} className="border-b border-gray-50">
                        <td className="whitespace-nowrap px-6 py-4">
                          <Link href={`/orders/${demand.orderId}`} className="text-xs font-semibold text-[#173D2E] hover:underline">
                            {demand.orderReference}
                          </Link>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div
                              className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold ${avatarColorFor(demand.customerName)}`}
                            >
                              {initialsFor(demand.customerName)}
                            </div>
                            <span className="text-xs font-medium text-gray-700">{demand.customerName}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-600">
                          <p className="font-medium text-gray-700">{demand.productDescriptionSnapshot}</p>
                          {demand.sapItemCodeSnapshot && <p className="text-[10px] text-gray-400">{demand.sapItemCodeSnapshot}</p>}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{demand.requestedQuantity}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{demand.unavailableQuantity}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{demand.outstandingQuantity}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{demand.confirmedLostQuantity}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">
                          {/* Real-world fix ("lost sales... show unit price/currency, confirm
                              valuation methodology"): "Lost Value" (renamed from "Est. Value")
                              is quantity x unit price, resolved once at creation from either
                              this order line's own price (approved, falling back to the price
                              entered at order creation) or the customer's price list -- never
                              a guessed figure (see resolveEstimatedLostSaleValue's own
                              comment). The tooltip states which of the two it came from and
                              the unit price it was computed from, so the methodology is never
                              hidden behind a single number. */}
                          {demand.estimatedValue !== null ? (
                            <span
                              title={`${demand.confirmedLostQuantity} x ${demand.estimatedUnitPrice} ${demand.currencyCode} -- priced from ${
                                demand.estimatedValueSource === "ORDER_LINE_APPROVED_PRICE"
                                  ? "this order line's own price (approved price, or the price entered at order creation if none was separately approved)"
                                  : "the customer's assigned price list"
                              }`}
                            >
                              {demand.estimatedValue} {demand.currencyCode}
                            </span>
                          ) : (
                            <span className="text-gray-300">--</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span
                            className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                              UNFULFILLED_DEMAND_STATUS_STYLES[demand.status] ?? "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {UNFULFILLED_DEMAND_STATUS_LABELS[demand.status] ?? demand.status}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <Link
                            href={`/lost-sales/${demand.id}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]"
                          >
                            Open
                            <ChevronRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {pagination.totalPages > 1 && (
            <nav className="flex items-center justify-between">
              <Link
                href={`/lost-sales?page=${Math.max(1, page - 1)}${statusQuery(status)}`}
                aria-disabled={page <= 1}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  page <= 1 ? "pointer-events-none opacity-40" : ""
                }`}
              >
                <ChevronLeft size={14} />
                Previous
              </Link>
              <p className="text-xs text-gray-400">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <Link
                href={`/lost-sales?page=${Math.min(pagination.totalPages, page + 1)}${statusQuery(status)}`}
                aria-disabled={page >= pagination.totalPages}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  page >= pagination.totalPages ? "pointer-events-none opacity-40" : ""
                }`}
              >
                Next
                <ChevronRight size={14} />
              </Link>
            </nav>
          )}

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
