
"use client";

import { useMemo, useState } from "react";
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  ShoppingBag,
  DollarSign,
  TrendingUp,
  ClipboardList,
  Mail,
  MessageCircle,
  PenLine,
  CalendarDays,
  ChevronDown,
  Package,
  Users,
  Info,
} from "lucide-react";
import Sidebar from "../components/sidebar";

type OrderStatus =
  | "Received"
  | "Pending Verification"
  | "Approved"
  | "Picking"
  | "Dispatched"
  | "Delivered";

type OrderSource = "Email" | "WhatsApp" | "Manual";

type Order = {
  reference: string;
  customer: string;
  date: string;
  amount: number;
  status: OrderStatus;
  source: OrderSource;
  items: number;
};

const demoOrders: Order[] = [
  {
    reference: "PO-219246",
    customer: "Gweru Pick n Pay",
    date: "2026-11-03",
    amount: 2643.41,
    status: "Pending Verification",
    source: "Email",
    items: 36,
  },
  {
    reference: "PO-219245",
    customer: "TM Supermarket",
    date: "2026-11-03",
    amount: 1825.6,
    status: "Approved",
    source: "WhatsApp",
    items: 24,
  },
  {
    reference: "PO-219244",
    customer: "OK Zimbabwe",
    date: "2026-11-02",
    amount: 3410.25,
    status: "Picking",
    source: "Email",
    items: 42,
  },
  {
    reference: "PO-219243",
    customer: "SPAR Borrowdale",
    date: "2026-11-02",
    amount: 960,
    status: "Dispatched",
    source: "Email",
    items: 18,
  },
  {
    reference: "PO-219242",
    customer: "Pick n Pay Bulawayo",
    date: "2026-11-01",
    amount: 2120.8,
    status: "Delivered",
    source: "Manual",
    items: 31,
  },
  {
    reference: "PO-219241",
    customer: "Food Lovers Market",
    date: "2026-11-01",
    amount: 1475.5,
    status: "Received",
    source: "WhatsApp",
    items: 20,
  },
  {
    reference: "PO-219240",
    customer: "Choppies",
    date: "2026-10-31",
    amount: 2890,
    status: "Pending Verification",
    source: "Email",
    items: 38,
  },
  {
    reference: "PO-219239",
    customer: "Bon Marché",
    date: "2026-10-30",
    amount: 785.4,
    status: "Delivered",
    source: "Manual",
    items: 14,
  },
  {
    reference: "PO-219238",
    customer: "OK Zimbabwe",
    date: "2026-10-29",
    amount: 1920,
    status: "Approved",
    source: "Email",
    items: 27,
  },
];

const statusColors: Record<OrderStatus, string> = {
  Received: "bg-slate-400",
  "Pending Verification": "bg-amber-400",
  Approved: "bg-blue-500",
  Picking: "bg-violet-500",
  Dispatched: "bg-cyan-500",
  Delivered: "bg-emerald-500",
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);

const formatDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

export default function ReportsPage() {
  const [period, setPeriod] = useState("30");
  const [activeTab, setActiveTab] = useState<
    "overview" | "customers" | "products"
  >("overview");

  const reportOrders = useMemo(() => {
    const days = Number(period);

    if (period === "all") return demoOrders;

    const latestDate = new Date("2026-11-03T00:00:00");
    const startDate = new Date(latestDate);
    startDate.setDate(startDate.getDate() - days + 1);

    return demoOrders.filter((order) => {
      const orderDate = new Date(`${order.date}T00:00:00`);
      return orderDate >= startDate && orderDate <= latestDate;
    });
  }, [period]);

  const totalOrders = reportOrders.length;

  const totalValue = reportOrders.reduce(
    (sum, order) => sum + order.amount,
    0
  );

  const averageValue =
    totalOrders > 0 ? totalValue / totalOrders : 0;

  const pendingOrders = reportOrders.filter(
    (order) => order.status === "Pending Verification"
  ).length;

  const statusData = ([
    { name: "Received", count: 0 },
    { name: "Pending Verification", count: 0 },
    { name: "Approved", count: 0 },
    { name: "Picking", count: 0 },
    { name: "Dispatched", count: 0 },
    { name: "Delivered", count: 0 },
  ] as { name: OrderStatus; count: number }[]).map((item) => ({
    ...item,
    count: reportOrders.filter(
      (order) => order.status === item.name
    ).length,
  }));

  const sourceData = [
    {
      name: "Email",
      count: reportOrders.filter((order) => order.source === "Email").length,
      color: "bg-blue-500",
      icon: Mail,
    },
    {
      name: "WhatsApp",
      count: reportOrders.filter((order) => order.source === "WhatsApp").length,
      color: "bg-emerald-500",
      icon: MessageCircle,
    },
    {
      name: "Manual",
      count: reportOrders.filter((order) => order.source === "Manual").length,
      color: "bg-violet-500",
      icon: PenLine,
    },
  ];

  const customerData = useMemo(() => {
    const grouped = new Map<
      string,
      { orders: number; value: number; items: number }
    >();

    reportOrders.forEach((order) => {
      const current = grouped.get(order.customer) ?? {
        orders: 0,
        value: 0,
        items: 0,
      };

      grouped.set(order.customer, {
        orders: current.orders + 1,
        value: current.value + order.amount,
        items: current.items + order.items,
      });
    });

    return Array.from(grouped.entries())
      .map(([customer, data]) => ({ customer, ...data }))
      .sort((a, b) => b.value - a.value);
  }, [reportOrders]);

  const productExamples = [
    {
      name: "Apples",
      category: "Fruit",
      note: "Illustrative product example",
    },
    {
      name: "Potatoes",
      category: "Vegetable",
      note: "Illustrative product example",
    },
    {
      name: "Oranges",
      category: "Fruit",
      note: "Illustrative product example",
    },
    {
      name: "Broccoli",
      category: "Vegetable",
      note: "Illustrative product example",
    },
  ];

  function exportCSV() {
    const rows = [
      [
        "Order Reference",
        "Customer",
        "Date",
        "Status",
        "Source",
        "Items",
        "Order Value (USD)",
      ],
      ...reportOrders.map((order) => [
        order.reference,
        order.customer,
        order.date,
        order.status,
        order.source,
        String(order.items),
        order.amount.toFixed(2),
      ]),
    ];

    const csv = rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");

    const blob = new Blob([csv], {
      type: "text/csv;charset=utf-8;",
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `willsgrove-salesflow-report-${period}-days.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  const maxStatusCount = Math.max(
    ...statusData.map((item) => item.count),
    1
  );

  const maxSourceCount = Math.max(
    ...sourceData.map((item) => item.count),
    1
  );

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 px-4 py-6 md:ml-[260px] md:px-8 md:py-8">
        <div className="mx-auto max-w-[1500px]">
          {/* Header */}
          <div className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-center">
            <div>
              <div className="mb-2 flex items-center gap-2 text-sm text-[#718078]">
                <span>SalesFlow</span>
                <span>/</span>
                <span className="font-medium text-[#17251E]">Reports</span>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
                  Reports & Analytics
                </h1>
                <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                  Demo data
                </span>
              </div>

              <p className="mt-2 text-sm text-[#718078]">
                Review order activity, customer performance and sales
                operations.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div className="relative">
                <CalendarDays
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#718078]"
                />
                <select
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                  className="h-11 appearance-none rounded-xl border border-[#E1E7E2] bg-white py-2 pl-10 pr-10 text-sm font-medium outline-none focus:border-[#78964A]"
                >
                  <option value="7">Last 7 days</option>
                  <option value="30">Last 30 days</option>
                  <option value="90">Last 90 days</option>
                  <option value="all">All demo records</option>
                </select>
                <ChevronDown
                  size={15}
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[#718078]"
                />
              </div>

              <button
                onClick={exportCSV}
                className="flex h-11 items-center gap-2 rounded-xl bg-[#183B2D] px-4 text-sm font-semibold text-white transition hover:bg-[#24513D]"
              >
                <Download size={16} />
                Export CSV
              </button>
            </div>
          </div>

          {/* Data notice */}
          <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <Info size={19} className="mt-0.5 shrink-0 text-amber-700" />
            <div>
              <p className="text-sm font-semibold text-amber-900">
                Illustrative reporting data
              </p>
              <p className="mt-1 text-xs leading-5 text-amber-800">
                These figures use sample orders created for the SalesFlow
                interface. They are not live Willsgrove sales figures and
                are not connected to SAP Business One.
              </p>
            </div>
          </div>

          {/* KPI cards */}
          <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              title="Total Orders"
              value={String(totalOrders)}
              description="Orders in selected period"
              icon={ShoppingBag}
              iconColor="text-blue-700"
              iconBg="bg-blue-50"
            />

            <MetricCard
              title="Total Order Value"
              value={formatCurrency(totalValue)}
              description="Combined sample order value"
              icon={DollarSign}
              iconColor="text-emerald-700"
              iconBg="bg-emerald-50"
            />

            <MetricCard
              title="Average Order Value"
              value={formatCurrency(averageValue)}
              description="Average value per order"
              icon={TrendingUp}
              iconColor="text-violet-700"
              iconBg="bg-violet-50"
            />

            <MetricCard
              title="Pending Verification"
              value={String(pendingOrders)}
              description="Orders awaiting checks"
              icon={ClipboardList}
              iconColor="text-amber-700"
              iconBg="bg-amber-50"
            />
          </div>

          {/* Tabs */}
          <div className="mb-6 flex flex-wrap gap-2 border-b border-[#E5EAE5]">
            {[
              { id: "overview", label: "Overview" },
              { id: "customers", label: "Customer Performance" },
              { id: "products", label: "Product Demand" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() =>
                  setActiveTab(
                    tab.id as "overview" | "customers" | "products"
                  )
                }
                className={`border-b-2 px-4 py-3 text-sm font-semibold transition ${
                  activeTab === tab.id
                    ? "border-[#78964A] text-[#24432F]"
                    : "border-transparent text-[#7A877F] hover:text-[#24432F]"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overview */}
          {activeTab === "overview" && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {/* Order status */}
                <section className="rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm md:p-6">
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <h2 className="font-bold">Order Status Distribution</h2>
                      <p className="mt-1 text-xs text-[#849087]">
                        Number of orders at each workflow stage
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#F2F6F1] p-2.5 text-[#496A42]">
                      <BarChart3 size={19} />
                    </div>
                  </div>

                  <div className="space-y-5">
                    {statusData.map((item) => (
                      <div key={item.name}>
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium text-[#536158]">
                            {item.name}
                          </span>
                          <span className="font-bold tabular-nums">
                            {item.count}
                          </span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-[#F0F2EF]">
                          <div
                            className={`h-full rounded-full ${statusColors[item.name]} transition-all`}
                            style={{
                              width: `${
                                (item.count / maxStatusCount) * 100
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Order sources */}
                <section className="rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm md:p-6">
                  <div className="mb-6 flex items-center justify-between">
                    <div>
                      <h2 className="font-bold">Order Sources</h2>
                      <p className="mt-1 text-xs text-[#849087]">
                        How customer orders were received
                      </p>
                    </div>
                    <div className="rounded-xl bg-[#F2F6F1] p-2.5 text-[#496A42]">
                      <FileSpreadsheet size={19} />
                    </div>
                  </div>

                  <div className="space-y-6">
                    {sourceData.map((source) => {
                      const Icon = source.icon;

                      return (
                        <div key={source.name}>
                          <div className="mb-2 flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="rounded-lg bg-[#F4F6F3] p-2 text-[#627269]">
                                <Icon size={17} />
                              </div>
                              <span className="text-sm font-semibold">
                                {source.name}
                              </span>
                            </div>
                            <span className="text-sm font-bold tabular-nums">
                              {source.count} orders
                            </span>
                          </div>

                          <div className="h-3 overflow-hidden rounded-full bg-[#F0F2EF]">
                            <div
                              className={`h-full rounded-full ${source.color}`}
                              style={{
                                width: `${
                                  (source.count / maxSourceCount) * 100
                                }%`,
                              }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-8 rounded-xl bg-[#F7F9F6] p-4">
                    <p className="text-xs leading-5 text-[#718078]">
                      The source breakdown helps identify how much work
                      enters Sales through email, WhatsApp and manual
                      capture.
                    </p>
                  </div>
                </section>
              </div>

              {/* Recent order activity */}
              <section className="overflow-hidden rounded-2xl border border-[#E7ECE7] bg-white shadow-sm">
                <div className="flex flex-col justify-between gap-3 border-b border-[#EEF1ED] p-5 md:flex-row md:items-center md:p-6">
                  <div>
                    <h2 className="font-bold">Order Activity</h2>
                    <p className="mt-1 text-xs text-[#849087]">
                      Orders included in the selected reporting period
                    </p>
                  </div>
                  <span className="rounded-lg bg-[#F2F6F1] px-3 py-2 text-xs font-semibold text-[#496A42]">
                    {reportOrders.length} records
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="bg-[#F8FAF7] text-xs uppercase tracking-wide text-[#849087]">
                      <tr>
                        <th className="px-6 py-4 font-semibold">Reference</th>
                        <th className="px-6 py-4 font-semibold">Customer</th>
                        <th className="px-6 py-4 font-semibold">Date</th>
                        <th className="px-6 py-4 font-semibold">Source</th>
                        <th className="px-6 py-4 font-semibold">Status</th>
                        <th className="px-6 py-4 text-right font-semibold">
                          Order Value
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EEF1ED]">
                      {reportOrders.map((order) => (
                        <tr
                          key={order.reference}
                          className="transition hover:bg-[#FAFBF9]"
                        >
                          <td className="px-6 py-4 font-semibold text-[#31543C]">
                            {order.reference}
                          </td>
                          <td className="px-6 py-4 font-medium">
                            {order.customer}
                          </td>
                          <td className="px-6 py-4 text-[#718078]">
                            {formatDate(order.date)}
                          </td>
                          <td className="px-6 py-4 text-[#718078]">
                            {order.source}
                          </td>
                          <td className="px-6 py-4">
                            <StatusPill status={order.status} />
                          </td>
                          <td className="px-6 py-4 text-right font-semibold tabular-nums">
                            {formatCurrency(order.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {reportOrders.length === 0 && (
                    <div className="p-12 text-center text-sm text-[#849087]">
                      No demo orders fall within this period.
                    </div>
                  )}
                </div>
              </section>
            </div>
          )}

          {/* Customer performance */}
          {activeTab === "customers" && (
            <section className="overflow-hidden rounded-2xl border border-[#E7ECE7] bg-white shadow-sm">
              <div className="border-b border-[#EEF1ED] p-5 md:p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-[#F2F6F1] p-2.5 text-[#496A42]">
                    <Users size={20} />
                  </div>
                  <div>
                    <h2 className="font-bold">Customer Order Performance</h2>
                    <p className="mt-1 text-xs text-[#849087]">
                      Order count and value grouped by customer
                    </p>
                  </div>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[650px] text-left text-sm">
                  <thead className="bg-[#F8FAF7] text-xs uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-6 py-4 font-semibold">Customer</th>
                      <th className="px-6 py-4 font-semibold">Orders</th>
                      <th className="px-6 py-4 font-semibold">Items</th>
                      <th className="px-6 py-4 text-right font-semibold">
                        Combined Order Value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {customerData.map((customer) => (
                      <tr key={customer.customer}>
                        <td className="px-6 py-4 font-semibold">
                          {customer.customer}
                        </td>
                        <td className="px-6 py-4">
                          {customer.orders}
                        </td>
                        <td className="px-6 py-4">
                          {customer.items}
                        </td>
                        <td className="px-6 py-4 text-right font-semibold tabular-nums">
                          {formatCurrency(customer.value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-[#EEF1ED] bg-[#FAFBF9] p-4 text-xs text-[#849087]">
                Customer figures are calculated from the illustrative
                order records currently included in this prototype.
              </div>
            </section>
          )}

          {/* Product demand */}
          {activeTab === "products" && (
            <section className="rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm md:p-6">
              <div className="mb-5 flex items-center gap-3">
                <div className="rounded-xl bg-[#F2F6F1] p-2.5 text-[#496A42]">
                  <Package size={20} />
                </div>
                <div>
                  <h2 className="font-bold">Product Demand Reporting</h2>
                  <p className="mt-1 text-xs text-[#849087]">
                    Planned product-level reporting area
                  </p>
                </div>
              </div>

              <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50 p-4">
                <p className="text-sm font-semibold text-blue-900">
                  Product-level order data is not connected yet.
                </p>
                <p className="mt-1 text-xs leading-5 text-blue-800">
                  The current sample orders contain total item counts,
                  but do not contain complete product-by-product quantities.
                  This section will need verified order line data before
                  calculating real demand.
                </p>
              </div>

              <h3 className="mb-3 text-sm font-bold">
                Example products for the future report
              </h3>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {productExamples.map((product) => (
                  <div
                    key={product.name}
                    className="flex items-center justify-between rounded-xl border border-[#E9EDE8] p-4"
                  >
                    <div>
                      <p className="text-sm font-semibold">
                        {product.name}
                      </p>
                      <p className="mt-1 text-xs text-[#849087]">
                        {product.category}
                      </p>
                    </div>
                    <span className="rounded-full bg-[#F3F5F1] px-3 py-1 text-[10px] font-semibold text-[#718078]">
                      Example only
                    </span>
                  </div>
                ))}
              </div>

              <div className="mt-6 border-t border-[#EEF1ED] pt-5">
                <p className="text-xs leading-5 text-[#849087]">
                  Once verified order lines are available, this report
                  can calculate demand by exact SAP item code, product
                  description, grade, pack size and unit of measure.
                  Different product variants must remain separate.
                </p>
              </div>
            </section>
          )}

          <div className="mt-8 flex items-start gap-2 rounded-xl border border-[#E6EBE5] bg-white p-4 text-xs leading-5 text-[#7B887F]">
            <Info size={16} className="mt-0.5 shrink-0" />
            <p>
              Reports currently use local illustrative data. They do not
              represent audited financial statements, actual sales
              performance, inventory balances or SAP Business One reports.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

function MetricCard({
  title,
  value,
  description,
  icon: Icon,
  iconColor,
  iconBg,
}: {
  title: string;
  value: string;
  description: string;
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
}) {
  return (
    <div className="rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-medium text-[#718078]">{title}</p>
        <div className={`rounded-xl p-2.5 ${iconBg} ${iconColor}`}>
          <Icon size={19} />
        </div>
      </div>
      <p className="text-2xl font-bold tracking-tight">{value}</p>
      <p className="mt-2 text-xs text-[#849087]">{description}</p>
    </div>
  );
}

function StatusPill({ status }: { status: OrderStatus }) {
  const styles: Record<OrderStatus, string> = {
    Received: "bg-slate-100 text-slate-700",
    "Pending Verification": "bg-amber-50 text-amber-700",
    Approved: "bg-blue-50 text-blue-700",
    Picking: "bg-violet-50 text-violet-700",
    Dispatched: "bg-cyan-50 text-cyan-700",
    Delivered: "bg-emerald-50 text-emerald-700",
  };

  return (
    <span
      className={`inline-flex whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${styles[status]}`}
    >
      {status}
    </span>
  );
}
