
"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import Sidebar from "../components/sidebar";

import {
  Search,
  Bell,
  Plus,
  Filter,
  Download,
  ChevronDown,
  FileText,
  MessageCircle,
  Mail,
  CheckCircle2,
  Clock3,
  PackageCheck,
  ShoppingCart,
  Eye,
} from "lucide-react";

type OrderStatus =
  | "Received"
  | "Pending Verification"
  | "Approved"
  | "Picking"
  | "Dispatched"
  | "Delivered";

type Order = {
  reference: string;
  customer: string;
  initials: string;
  orderDate: string;
  deliveryDate: string;
  amount: number;
  items: number;
  source: "Email" | "WhatsApp" | "Manual";
  status: OrderStatus;
  avatar: string;
};

const initialOrders: Order[] = [
  {
    reference: "PO-219246",
    customer: "Gweru Pick n Pay",
    initials: "GP",
    orderDate: "03 Nov 2026",
    deliveryDate: "04 Nov 2026",
    amount: 2643.41,
    items: 36,
    source: "Email",
    status: "Pending Verification",
    avatar: "bg-orange-100 text-orange-700",
  },
  {
    reference: "PO-219245",
    customer: "TM Supermarket",
    initials: "TM",
    orderDate: "03 Nov 2026",
    deliveryDate: "04 Nov 2026",
    amount: 1825.60,
    items: 24,
    source: "WhatsApp",
    status: "Approved",
    avatar: "bg-blue-100 text-blue-700",
  },
  {
    reference: "PO-219244",
    customer: "OK Zimbabwe",
    initials: "OK",
    orderDate: "02 Nov 2026",
    deliveryDate: "03 Nov 2026",
    amount: 3410.25,
    items: 42,
    source: "Email",
    status: "Picking",
    avatar: "bg-purple-100 text-purple-700",
  },
  {
    reference: "PO-219243",
    customer: "SPAR Borrowdale",
    initials: "SB",
    orderDate: "02 Nov 2026",
    deliveryDate: "03 Nov 2026",
    amount: 960.00,
    items: 15,
    source: "Email",
    status: "Dispatched",
    avatar: "bg-orange-100 text-orange-700",
  },
  {
    reference: "PO-219242",
    customer: "Pick n Pay Bulawayo",
    initials: "PB",
    orderDate: "01 Nov 2026",
    deliveryDate: "02 Nov 2026",
    amount: 2120.80,
    items: 31,
    source: "Manual",
    status: "Delivered",
    avatar: "bg-teal-100 text-teal-700",
  },
  {
    reference: "PO-219241",
    customer: "Food Lovers Market",
    initials: "FL",
    orderDate: "01 Nov 2026",
    deliveryDate: "03 Nov 2026",
    amount: 1475.50,
    items: 19,
    source: "WhatsApp",
    status: "Received",
    avatar: "bg-green-100 text-green-700",
  },
  {
    reference: "PO-219240",
    customer: "Choppies",
    initials: "CH",
    orderDate: "31 Oct 2026",
    deliveryDate: "02 Nov 2026",
    amount: 2890.00,
    items: 33,
    source: "Email",
    status: "Pending Verification",
    avatar: "bg-yellow-100 text-yellow-700",
  },
  {
    reference: "PO-219239",
    customer: "Bon Marché",
    initials: "BM",
    orderDate: "31 Oct 2026",
    deliveryDate: "01 Nov 2026",
    amount: 785.40,
    items: 12,
    source: "Manual",
    status: "Delivered",
    avatar: "bg-pink-100 text-pink-700",
  },
  {
    reference: "PO-219238",
    customer: "OK Zimbabwe",
    initials: "OK",
    orderDate: "30 Oct 2026",
    deliveryDate: "01 Nov 2026",
    amount: 1920.00,
    items: 28,
    source: "Email",
    status: "Approved",
    avatar: "bg-purple-100 text-purple-700",
  },
];

const statusOptions = [
  "All Orders",
  "Received",
  "Pending Verification",
  "Approved",
  "Picking",
  "Dispatched",
  "Delivered",
];

const statusStyles: Record<OrderStatus, string> = {
  Received: "bg-blue-50 text-blue-700",
  "Pending Verification": "bg-amber-50 text-amber-700",
  Approved: "bg-green-50 text-green-700",
  Picking: "bg-purple-50 text-purple-700",
  Dispatched: "bg-orange-50 text-orange-700",
  Delivered: "bg-emerald-50 text-emerald-700",
};

function SourceIcon({ source }: { source: Order["source"] }) {
  if (source === "Email") {
    return <Mail size={14} className="text-blue-500" />;
  }

  if (source === "WhatsApp") {
    return <MessageCircle size={14} className="text-green-600" />;
  }

  return <FileText size={14} className="text-gray-500" />;
}

export default function OrdersPage() {
  const [orders] = useState<Order[]>(initialOrders);
  const [activeStatus, setActiveStatus] = useState("All Orders");
  const [search, setSearch] = useState("");

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesStatus =
        activeStatus === "All Orders" ||
        order.status === activeStatus;

      const matchesSearch =
        order.reference.toLowerCase().includes(search.toLowerCase()) ||
        order.customer.toLowerCase().includes(search.toLowerCase());

      return matchesStatus && matchesSearch;
    });
  }, [orders, activeStatus, search]);

  const pendingCount = orders.filter(
    (order) => order.status === "Pending Verification"
  ).length;

  const approvedCount = orders.filter(
    (order) => order.status === "Approved"
  ).length;

  const deliveredCount = orders.filter(
    (order) => order.status === "Delivered"
  ).length;

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        {/* Header */}
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">
              Workspace / Sales Management / Orders
            </p>

            <h2 className="mt-1 text-lg font-bold text-[#17251E]">
              Orders
            </h2>
          </div>

          <div className="flex items-center gap-5">
            <button className="text-gray-400 hover:text-gray-700">
              <Search size={19} />
            </button>

            <button className="relative text-gray-400 hover:text-gray-700">
              <Bell size={19} />
              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
            </button>

            <div className="h-8 w-px bg-gray-200" />

            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D7F36B] text-xs font-bold text-[#173D2E]">
                SA
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-800">
                  Sales Administrator
                </p>
                <p className="text-[10px] text-gray-400">
                  Administrator
                </p>
              </div>

              <ChevronDown size={14} className="text-gray-400" />
            </div>
          </div>
        </header>

        {/* Page content */}
        <div className="space-y-7 p-8">
          {/* Page heading */}
          <section className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">
                Order Management
              </h1>

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
            {[
              {
                title: "Total Orders",
                value: orders.length,
                icon: ShoppingCart,
                color: "bg-blue-50 text-blue-600",
                note: "All recorded orders",
              },
              {
                title: "Pending Verification",
                value: pendingCount,
                icon: Clock3,
                color: "bg-amber-50 text-amber-600",
                note: "Requires sales review",
              },
              {
                title: "Approved Orders",
                value: approvedCount,
                icon: CheckCircle2,
                color: "bg-green-50 text-green-600",
                note: "Ready for fulfilment",
              },
              {
                title: "Delivered Orders",
                value: deliveredCount,
                icon: PackageCheck,
                color: "bg-purple-50 text-purple-600",
                note: "Successfully delivered",
              },
            ].map((card) => {
              const Icon = card.icon;

              return (
                <div
                  key={card.title}
                  className="rounded-xl border border-[#E8EBE6] bg-white p-5"
                >
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">
                      {card.title}
                    </p>

                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg ${card.color}`}
                    >
                      <Icon size={18} />
                    </div>
                  </div>

                  <h3 className="mt-4 text-3xl font-bold text-[#17251E]">
                    {card.value}
                  </h3>

                  <p className="mt-2 text-[11px] text-gray-400">
                    {card.note}
                  </p>
                </div>
              );
            })}
          </section>

          {/* Orders table */}
          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {/* Table heading */}
            <div className="flex items-center justify-between p-6">
              <div>
                <h2 className="text-[15px] font-bold text-[#17251E]">
                  Customer Orders
                </h2>

                <p className="mt-1 text-xs text-gray-400">
                  View and manage incoming customer purchase orders.
                </p>
              </div>

              <div className="flex gap-2">
                <button className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  <Filter size={14} />
                  Filters
                </button>

                <button className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2.5 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  <Download size={14} />
                  Export
                </button>
              </div>
            </div>

            {/* Status tabs */}
            <div className="flex gap-6 overflow-x-auto border-b border-gray-100 px-6">
              {statusOptions.map((status) => {
                const count =
                  status === "All Orders"
                    ? orders.length
                    : orders.filter((order) => order.status === status).length;

                return (
                  <button
                    key={status}
                    onClick={() => setActiveStatus(status)}
                    className={`flex shrink-0 items-center gap-2 border-b-2 py-4 text-xs font-medium transition ${
                      activeStatus === status
                        ? "border-[#28583F] text-[#28583F]"
                        : "border-transparent text-gray-400 hover:text-gray-700"
                    }`}
                  >
                    {status}

                    <span
                      className={`rounded-md px-1.5 py-0.5 text-[10px] ${
                        activeStatus === status
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Search bar */}
            <div className="flex items-center justify-between gap-4 border-b border-gray-100 px-6 py-4">
              <div className="relative w-full max-w-md">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />

                <input
                  type="text"
                  placeholder="Search by order reference or customer..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="h-10 w-full rounded-lg border border-gray-200 bg-white pl-9 pr-4 text-xs outline-none transition placeholder:text-gray-400 focus:border-[#7C9D87] focus:ring-2 focus:ring-green-50"
                />
              </div>

              <p className="whitespace-nowrap text-[11px] text-gray-400">
                {filteredOrders.length} orders found
              </p>
            </div>

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
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.reference}
                      className="border-b border-gray-50 transition hover:bg-gray-50/70"
                    >
                      <td className="whitespace-nowrap px-6 py-4">
                        <Link
                          href={`/orders/${order.reference}`}
                          className="text-xs font-semibold text-[#28583F] transition hover:text-[#6A8D43] hover:underline"
                        >
                          {order.reference}
                        </Link>

                        <p className="mt-1 text-[10px] text-gray-400">
                          {order.items} line items
                        </p>
                      </td>

                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div
                            className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold ${order.avatar}`}
                          >
                            {order.initials}
                          </div>

                          <p className="text-xs font-medium text-gray-700">
                            {order.customer}
                          </p>
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <SourceIcon source={order.source} />
                          {order.source}
                        </div>
                      </td>

                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">
                        {order.orderDate}
                      </td>

                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">
                        {order.deliveryDate}
                      </td>

                      <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-gray-700">
                        ${order.amount.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>

                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1.5 text-[10px] font-semibold ${statusStyles[order.status]}`}
                        >
                          {order.status}
                        </span>
                      </td>

                      <td className="px-6 py-4">
                        <Link
                          href={`/orders/${order.reference}`}
                          title={`View ${order.reference}`}
                          aria-label={`View order ${order.reference}`}
                          className="inline-flex text-gray-400 transition hover:text-[#28583F]"
                        >
                          <Eye size={17} />
                        </Link>
                      </td>
                    </tr>
                  ))}

                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-16 text-center">
                        <div className="flex flex-col items-center">
                          <Search size={25} className="text-gray-300" />

                          <p className="mt-3 text-sm font-semibold text-gray-600">
                            No orders found
                          </p>

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
                Showing {filteredOrders.length} of {orders.length} orders
              </p>

              <div className="flex items-center gap-2">
                <button className="rounded-lg border border-gray-200 px-3 py-2 text-[11px] text-gray-400">
                  Previous
                </button>

                <button className="rounded-lg bg-[#173D2E] px-3 py-2 text-[11px] font-semibold text-white">
                  1
                </button>

                <button className="rounded-lg border border-gray-200 px-3 py-2 text-[11px] text-gray-500">
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
