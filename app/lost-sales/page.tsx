import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listUnfulfilledDemands } from "@/lib/lost-sales/queries";
import { getLostSalesReportSummary } from "@/lib/lost-sales/queries";
import {
  UNFULFILLED_DEMAND_STATUS_LABELS,
  UNFULFILLED_DEMAND_STATUS_STYLES,
} from "@/lib/lost-sales/display";
import { unfulfilledDemandStatusValues } from "@/lib/lost-sales/validation";
import { initialsFor, avatarColorFor } from "@/lib/order-display";
import Sidebar from "../components/sidebar";
import { TrendingDown, ChevronRight, ChevronLeft, Clock3, PackageX, Ban } from "lucide-react";

/**
 * Milestone 4 (Lost-Sales Management).
 *
 * The /lost-sales list page -- spec section 6's required list of
 * unavailable/unfulfilled demand, plus a handful of the spec section 7
 * figures (awaiting-decision count, total outstanding, total confirmed
 * lost) as plain stat tiles. Deliberately no chart/trend view yet --
 * "avoid unnecessary dashboard complexity... before advanced BI" (spec
 * section 6) -- the full breakdown (top products/customers/reasons)
 * lives at GET /api/lost-sales/reports for a future, explicitly-asked-for
 * reporting page to build on without any schema change.
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

  const [{ demands, pagination }, summary] = await Promise.all([
    listUnfulfilledDemands({ page, pageSize: PAGE_SIZE, status }),
    getLostSalesReportSummary(),
  ]);

  const statusQuery = (targetStatus: string | undefined) => (targetStatus ? `&status=${targetStatus}` : "");

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Lost Sales</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Lost-Sales Management</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Unfulfilled Demand</h1>
            <p className="mt-1 text-sm text-gray-500">
              What the warehouse couldn&apos;t supply, what the customer decided to do about it, and what has
              actually become a confirmed lost sale -- kept as three distinct things throughout.
            </p>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="flex items-center gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <Clock3 size={18} />
              </div>
              <div>
                <p className="text-lg font-bold text-[#17251E]">{summary.awaitingDecisionCount}</p>
                <p className="text-xs text-gray-400">Awaiting customer decision</p>
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
