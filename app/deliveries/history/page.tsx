import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDeliveredOrders } from "@/lib/fulfilment/queries";
import Sidebar from "../../components/sidebar";
import { formatOrderDate, formatOrderDateTime, initialsFor, avatarColorFor } from "@/lib/order-display";
import { Truck, ChevronRight, ChevronLeft, ArrowLeft } from "lucide-react";

/**
 * Final completion phase, section 7: the "Delivered History" surface the
 * directive names alongside order list/detail/dashboard/dispatch/reports/
 * customer history. Did not exist before this fix -- see
 * lib/fulfilment/queries.ts's listDeliveredOrders own module comment for
 * why (the active dispatch queue's own filter bug meant a fully-delivered
 * order never actually left it, so there was never a separate place for
 * one to "graduate" to). Every order shown here has every one of its
 * non-cancelled dispatches DELIVERED, with nothing left in flight --
 * listDeliveredOrders and listDispatchQueue partition every
 * READY_TO_INVOICE-or-dispatched order between them, never both, never
 * neither.
 */
export const instant = false;

const PAGE_SIZE = 25;

type RouteParams = { searchParams: Promise<{ page?: string }> };

export default async function DeliveredHistoryPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = await searchParams;
  const requestedPage = Number(resolvedSearchParams.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const { orders, pagination } = await listDeliveredOrders({ page, pageSize: PAGE_SIZE });

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Dispatch &amp; Delivery / Delivered History</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Delivered History</h2>
          </div>
          <Link
            href="/deliveries"
            className="flex items-center gap-2 rounded-lg border border-[#E8EBE6] px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
          >
            <ArrowLeft size={14} />
            Dispatch Queue
          </Link>
        </header>

        <div className="space-y-6 p-8">
          <section className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Delivered Orders</h1>
              <p className="mt-1 text-sm text-gray-500">
                Every order with every dispatch confirmed delivered -- nothing left waiting on dispatch or delivery.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-[#E8EBE6] bg-white px-4 py-2.5">
              <Truck size={16} className="text-[#173D2E]" />
              <span className="text-sm font-semibold text-[#17251E]">{pagination.totalItems}</span>
              <span className="text-xs text-gray-400">order{pagination.totalItems === 1 ? "" : "s"}</span>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {orders.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Truck size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">No delivered orders yet</p>
                <p className="mt-1 text-xs text-gray-400">Orders appear here once every one of their dispatches is confirmed delivered.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Order</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Requested Delivery</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Delivered</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order) => {
                      const customerName = order.customer?.name ?? "Unknown customer";

                      return (
                        <tr key={order.id} className="border-b border-gray-50">
                          <td className="whitespace-nowrap px-6 py-4">
                            <Link href={`/orders/${order.id}`} className="text-xs font-semibold text-[#173D2E] hover:underline">
                              {order.reference}
                            </Link>
                            {order.isDemo && (
                              <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-[9px] font-semibold text-gray-500">Demo</span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-2">
                              <div className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold ${avatarColorFor(customerName)}`}>
                                {initialsFor(customerName)}
                              </div>
                              <span className="text-xs font-medium text-gray-700">{customerName}</span>
                            </div>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <span className="rounded-full bg-teal-50 px-2.5 py-1 text-[10px] font-semibold text-teal-700">Delivered</span>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{formatOrderDate(order.requestedDeliveryDate)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{formatOrderDateTime(order.lastDeliveredAt)}</td>
                          <td className="whitespace-nowrap px-6 py-4 text-right">
                            <Link href={`/orders/${order.id}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]">
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
                href={`/deliveries/history?page=${Math.max(1, page - 1)}`}
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
                href={`/deliveries/history?page=${Math.min(pagination.totalPages, page + 1)}`}
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
