import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listPickingQueue } from "@/lib/picking/queries";
import Sidebar from "../components/sidebar";
import {
  ORDER_STATUS_LABELS,
  ORDER_STATUS_STYLES,
  formatOrderDate,
  initialsFor,
  avatarColorFor,
  type OrderStatusValue,
} from "@/lib/order-display";
import { ClipboardList, ChevronRight, ChevronLeft } from "lucide-react";

/**
 * Milestone 3B (SAP Invoice Handover Specification -- warehouse
 * picking). Builds out the sidebar's previously-dead "Picking &
 * Fulfilment" nav entry. A deliberately simple Server Component list --
 * no client-side search/filter box yet (unlike app/orders/page.tsx) --
 * since this queue is already narrowly scoped by lib/picking/queries.ts's
 * listPickingQueue() to just the orders that could still need picking
 * attention. Pagination is plain query-string links, same reason: no
 * client interactivity needed for that alone.
 *
 * Reads the session directly (not prerendered), same reason as
 * app/orders/[id]/page.tsx.
 */
export const instant = false;

const PAGE_SIZE = 25;

type RouteParams = { searchParams: Promise<{ page?: string }> };

function pickingProgressLabel(status: string): { label: string; style: string } {
  switch (status) {
    case "PICKING":
      return { label: "Picking in progress", style: "bg-cyan-50 text-cyan-700" };
    case "READY_TO_INVOICE":
      return { label: "Ready to invoice", style: "bg-emerald-50 text-emerald-700" };
    default:
      return { label: "Not started", style: "bg-gray-100 text-gray-500" };
  }
}

export default async function FulfilmentQueuePage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const requestedPage = Number(resolvedSearchParams.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const { orders, pagination } = await listPickingQueue({ page, pageSize: PAGE_SIZE });

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Picking &amp; Fulfilment</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Picking &amp; Fulfilment</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <section className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Picking Queue</h1>
              <p className="mt-1 text-sm text-gray-500">
                Every live order not yet handed to SAP -- warehouse picking, then authorization, happens here
                before an invoice handover can be generated.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[#E8EBE6] bg-white px-4 py-2.5">
              <ClipboardList size={16} className="text-[#173D2E]" />
              <span className="text-sm font-semibold text-[#17251E]">{pagination.totalItems}</span>
              <span className="text-xs text-gray-400">order{pagination.totalItems === 1 ? "" : "s"}</span>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {orders.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <ClipboardList size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">Nothing waiting on picking</p>
                <p className="mt-1 text-xs text-gray-400">
                  Every live order has already been handed to SAP, or there are no orders yet.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        Order
                      </th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        Customer
                      </th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        Order Status
                      </th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        Picking
                      </th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        Requested Delivery
                      </th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        Lines
                      </th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const customerName = order.customer?.name ?? "Unknown customer";
                      const statusLabel = ORDER_STATUS_LABELS[order.status as OrderStatusValue] ?? order.status;
                      const statusStyle =
                        ORDER_STATUS_STYLES[order.status as OrderStatusValue] ?? "bg-gray-100 text-gray-500";
                      const progress = pickingProgressLabel(order.status);

                      return (
                        <tr key={order.id} className="border-b border-gray-50">
                          <td className="whitespace-nowrap px-6 py-4">
                            <Link
                              href={`/fulfilment/${order.id}`}
                              className="text-xs font-semibold text-[#173D2E] hover:underline"
                            >
                              {order.reference}
                            </Link>
                            {order.isDemo && (
                              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-semibold text-gray-500">
                                Demo
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div
                                className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold ${avatarColorFor(customerName)}`}
                              >
                                {initialsFor(customerName)}
                              </div>
                              <span className="text-xs font-medium text-gray-700">{customerName}</span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusStyle}`}>
                              {statusLabel}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <span className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${progress.style}`}>
                              {progress.label}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                            {formatOrderDate(order.requestedDeliveryDate)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{order.lineCount}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right">
                            <Link
                              href={`/fulfilment/${order.id}`}
                              className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]"
                            >
                              Open
                              <ChevronRight size={13} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {pagination.totalPages > 1 && (
            <nav className="flex items-center justify-between">
              <Link
                href={`/fulfilment?page=${Math.max(1, page - 1)}`}
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
                href={`/fulfilment?page=${Math.min(pagination.totalPages, page + 1)}`}
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
