"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Sidebar from "../components/sidebar";
import {
  ORDER_STATUSES,
  ORDER_STATUS_LABELS as STATUS_LABELS,
  ORDER_STATUS_STYLES as STATUS_STYLES,
  orderSourceLabel,
  type OrderStatusValue,
  formatOrderDate as formatDate,
  formatOrderAmount as formatAmount,
  initialsFor,
  avatarColorFor,
} from "@/lib/order-display";

import {
  Search,
  Bell,
  Plus,
  FileText,
  MessageCircle,
  Mail,
  CheckCircle2,
  Clock3,
  PackageCheck,
  ShoppingCart,
  Eye,
  AlertCircle,
  Loader2,
} from "lucide-react";

function SourceIcon({ source }: { source: string }) {
  if (source === "EMAIL") return <Mail size={14} className="text-blue-500" />;
  if (source === "WHATSAPP") return <MessageCircle size={14} className="text-green-600" />;
  return <FileText size={14} className="text-gray-500" />;
}

type ApiOrderSummary = {
  id: string;
  reference: string;
  customerPoReference: string | null;
  status: OrderStatusValue;
  source: string;
  orderDate: string | null;
  requestedDeliveryDate: string | null;
  total: string | null;
  currency: string;
  isDemo: boolean;
  createdAt: string;
  customer: { id: string; name: string } | null;
  lineCount: number;
};

type OrderListResponse = {
  success: boolean;
  message?: string;
  orders: ApiOrderSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

async function fetchOrderCount(status: OrderStatusValue | null): Promise<number | null> {
  const params = new URLSearchParams({ pageSize: "1" });
  if (status) params.set("status", status);
  try {
    const response = await fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });
    const data = (await response.json()) as OrderListResponse;
    if (!response.ok || !data.success) return null;
    return data.pagination.totalItems;
  } catch {
    return null;
  }
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<ApiOrderSummary[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, totalItems: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [activeStatus, setActiveStatus] = useState<OrderStatusValue | "ALL">("ALL");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const [counts, setCounts] = useState<{
    total: number | null;
    pendingVerification: number | null;
    readyForApproval: number | null;
    approved: number | null;
  }>({ total: null, pendingVerification: null, readyForApproval: null, approved: null });

  // Debounce the search box so every keystroke doesn't fire a request.
  // Resetting to page 1 happens here (and in the status-tab click
  // handlers below) rather than in a separate effect keyed on
  // [activeStatus, debouncedSearch] -- an effect whose whole job is
  // mirroring one piece of state into another, with no real
  // subscription, is exactly the "derived state via effect" anti-pattern
  // react-hooks/set-state-in-effect flags (see CHANGES.md).
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let ignore = false;

    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (activeStatus !== "ALL") params.set("status", activeStatus);
    if (debouncedSearch) params.set("search", debouncedSearch);

    Promise.resolve()
      .then(() => {
        setLoading(true);
        setLoadError(null);
        return fetch(`/api/orders?${params.toString()}`, { cache: "no-store" });
      })
      .then((response) => response.json().then((data: OrderListResponse) => ({ response, data })))
      .then(({ response, data }) => {
        if (ignore) return;
        if (!response.ok || !data.success) {
          setLoadError(data.message ?? "Unable to load orders.");
          setOrders([]);
          return;
        }
        setOrders(data.orders);
        setPagination(data.pagination);
      })
      .catch(() => {
        if (!ignore) {
          setLoadError("Could not reach the server. Check your connection and try again.");
          setOrders([]);
        }
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });

    return () => {
      ignore = true;
    };
  }, [activeStatus, debouncedSearch, page]);

  // Summary-card counts: four cheap (pageSize=1) calls to the same /api/orders
  // endpoint used above, reading only pagination.totalItems -- real numbers
  // from the database, not estimated or fabricated, and no new API route.
  useEffect(() => {
    let ignore = false;
    Promise.all([
      fetchOrderCount(null),
      fetchOrderCount("PENDING_VERIFICATION"),
      fetchOrderCount("READY_FOR_APPROVAL"),
      fetchOrderCount("APPROVED"),
    ]).then(([total, pendingVerification, readyForApproval, approved]) => {
      if (ignore) return;
      setCounts({ total, pendingVerification, readyForApproval, approved });
    });
    return () => {
      ignore = true;
    };
  }, []);

  const summaryCards = useMemo(
    () => [
      {
        title: "Total Orders",
        value: counts.total,
        icon: ShoppingCart,
        color: "bg-blue-50 text-blue-600",
        note: "All recorded orders",
      },
      {
        title: "Pending Verification",
        value: counts.pendingVerification,
        icon: Clock3,
        color: "bg-amber-50 text-amber-600",
        note: "Requires sales review",
      },
      {
        title: "Ready for Approval",
        value: counts.readyForApproval,
        icon: CheckCircle2,
        color: "bg-purple-50 text-purple-600",
        note: "Verification complete",
      },
      {
        title: "Approved Orders",
        value: counts.approved,
        icon: PackageCheck,
        color: "bg-green-50 text-green-600",
        note: "Ready for fulfilment",
      },
    ],
    [counts]
  );

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Sales Management / Orders</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Orders</h2>
          </div>

          <div className="flex items-center gap-5">
            <button className="text-gray-400 hover:text-gray-700">
              <Search size={19} />
            </button>
            <button className="relative text-gray-400 hover:text-gray-700">
              <Bell size={19} />
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <div className="space-y-7 p-8">
          {/* Page heading */}
          <section className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Order Management</h1>
              <p className="mt-2 text-sm text-gray-500">
                Receive, verify and manage customer purchase orders.
              </p>
            </div>

            <Link
              href="/orders/new"
              className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#24543F]"
            >
              <Plus size={16} />
              Receive New Order
            </Link>
          </section>

          {/* Summary cards */}
          <section className="grid grid-cols-4 gap-5">
            {summaryCards.map((card) => {
              const Icon = card.icon;
              return (
                <div key={card.title} className="rounded-xl border border-[#E8EBE6] bg-white p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">{card.title}</p>
                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.color}`}>
                      <Icon size={18} />
                    </div>
                  </div>

                  <h3 className="mt-4 text-3xl font-bold text-[#17251E]">
                    {card.value === null ? "—" : card.value}
                  </h3>

                  <p className="mt-2 text-[11px] text-gray-400">{card.note}</p>
                </div>
              );
            })}
          </section>

          {/* Orders table */}
          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {/* Table heading */}
            <div className="p-6">
              <h2 className="text-[15px] font-bold text-[#17251E]">Customer Orders</h2>
              <p className="mt-1 text-xs text-gray-400">
                View and manage incoming customer purchase orders.
              </p>
            </div>

            {/* Status tabs */}
            <div className="flex gap-6 overflow-x-auto border-b border-gray-100 px-6">
              <button
                onClick={() => {
                  setActiveStatus("ALL");
                  setPage(1);
                }}
                className={`shrink-0 border-b-2 py-4 text-xs font-medium transition ${
                  activeStatus === "ALL"
                    ? "border-[#28583F] text-[#28583F]"
                    : "border-transparent text-gray-400 hover:text-gray-700"
                }`}
              >
                All Orders
              </button>

              {ORDER_STATUSES.map((status) => (
                <button
                  key={status}
                  onClick={() => {
                    setActiveStatus(status);
                    setPage(1);
                  }}
                  className={`shrink-0 border-b-2 py-4 text-xs font-medium transition ${
                    activeStatus === status
                      ? "border-[#28583F] text-[#28583F]"
                      : "border-transparent text-gray-400 hover:text-gray-700"
                  }`}
                >
                  {STATUS_LABELS[status]}
                </button>
              ))}
            </div>

            {/* Search bar */}
            <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
              <div className="relative w-full max-w-md">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by order reference, PO reference or customer..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 text-xs outline-none transition placeholder:text-gray-400 focus:border-[#7C9D87] focus:ring-2 focus:ring-green-50"
                />
              </div>

              <p className="whitespace-nowrap text-[11px] text-gray-400">
                {pagination.totalItems} order{pagination.totalItems === 1 ? "" : "s"} found
              </p>
            </div>

            {loadError && (
              <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-6 py-3 text-xs text-red-700">
                <AlertCircle size={14} />
                {loadError}
              </div>
            )}

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50/70">
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Order Reference
                    </th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Customer
                    </th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Source
                    </th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Order Date
                    </th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Delivery
                    </th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Amount
                    </th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Status
                    </th>
                    <th className="px-6 py-4 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {loading && (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center gap-2 text-gray-400">
                          <Loader2 size={22} className="animate-spin" />
                          <p className="text-xs">Loading orders...</p>
                        </div>
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    orders.map((order) => {
                      const customerName = order.customer?.name ?? "Unknown customer";
                      return (
                        <tr key={order.id} className="border-b border-gray-50 transition hover:bg-gray-50/70">
                          <td className="whitespace-nowrap px-6 py-4">
                            <Link
                              href={`/orders/${order.id}`}
                              className="text-xs font-semibold text-[#28583F] transition hover:text-[#6A8D43] hover:underline"
                            >
                              {order.reference}
                            </Link>
                            <p className="mt-1 text-[10px] text-gray-400">
                              {order.lineCount} line item{order.lineCount === 1 ? "" : "s"}
                              {order.isDemo && " · Demo"}
                            </p>
                          </td>

                          <td className="whitespace-nowrap px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div
                                className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold ${avatarColorFor(customerName)}`}
                              >
                                {initialsFor(customerName)}
                              </div>
                              <p className="text-xs font-medium text-gray-700">{customerName}</p>
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-6 py-4">
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <SourceIcon source={order.source} />
                              {orderSourceLabel(order.source)}
                            </div>
                          </td>

                          <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">
                            {formatDate(order.orderDate)}
                          </td>

                          <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">
                            {formatDate(order.requestedDeliveryDate)}
                          </td>

                          <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-gray-700">
                            {formatAmount(order.total, order.currency)}
                          </td>

                          <td className="whitespace-nowrap px-6 py-4">
                            <span
                              className={`rounded-full px-2.5 py-1.5 text-[10px] font-semibold ${STATUS_STYLES[order.status]}`}
                            >
                              {STATUS_LABELS[order.status]}
                            </span>
                          </td>

                          <td className="px-6 py-4">
                            <Link
                              href={`/orders/${order.id}`}
                              title={`View ${order.reference}`}
                              aria-label={`View order ${order.reference}`}
                              className="inline-flex text-gray-400 transition hover:text-[#28583F]"
                            >
                              <Eye size={17} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}

                  {!loading && !loadError && orders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <Search size={25} className="text-gray-300" />
                          <p className="mt-3 text-sm font-semibold text-gray-600">No orders found</p>
                          <p className="mt-1 text-xs text-gray-400">
                            Try changing your search or status filter.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Table footer */}
            <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
              <p className="text-[11px] text-gray-400">
                Page {pagination.page} of {pagination.totalPages} · {pagination.totalItems} total
              </p>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={pagination.page <= 1}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-[11px] text-gray-500 disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  Previous
                </button>

                <span className="rounded-lg bg-[#173D2E] px-3 py-2 text-[11px] font-semibold text-white">
                  {pagination.page}
                </span>

                <button
                  onClick={() => setPage((p) => Math.min(pagination.totalPages, p + 1))}
                  disabled={pagination.page >= pagination.totalPages}
                  className="rounded-lg border border-gray-200 px-3 py-2 text-[11px] text-gray-500 disabled:cursor-not-allowed disabled:text-gray-300"
                >
                  Next
                </button>
              </div>
            </div>
          </section>

          {/* Footer */}
          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
