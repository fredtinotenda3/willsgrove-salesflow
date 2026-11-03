import Sidebar from "./components/sidebar";

import {
  Search,
  Bell,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  ShoppingCart,
  Clock3,
  PackageCheck,
  Truck,
  MoreHorizontal,
  CalendarDays,
  ChevronDown,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  FileText,
} from "lucide-react";

const statistics = [
  {
    title: "Total Orders",
    value: "128",
    change: "+12.8%",
    description: "Compared to last month",
    positive: true,
    icon: ShoppingCart,
    iconBg: "bg-blue-50",
    iconColor: "text-blue-600",
  },
  {
    title: "Pending Verification",
    value: "12",
    change: "4 urgent",
    description: "Awaiting sales review",
    positive: false,
    icon: Clock3,
    iconBg: "bg-amber-50",
    iconColor: "text-amber-600",
  },
  {
    title: "Awaiting Fulfilment",
    value: "18",
    change: "+3 today",
    description: "Approved orders",
    positive: true,
    icon: PackageCheck,
    iconBg: "bg-purple-50",
    iconColor: "text-purple-600",
  },
  {
    title: "Completed Deliveries",
    value: "94",
    change: "+8.4%",
    description: "Compared to last month",
    positive: true,
    icon: Truck,
    iconBg: "bg-green-50",
    iconColor: "text-green-600",
  },
];

const pipeline = [
  {
    name: "Received",
    count: 24,
    color: "bg-blue-500",
    width: "100%",
  },
  {
    name: "Verification",
    count: 12,
    color: "bg-amber-500",
    width: "50%",
  },
  {
    name: "Approved",
    count: 20,
    color: "bg-indigo-500",
    width: "83%",
  },
  {
    name: "Picking",
    count: 18,
    color: "bg-purple-500",
    width: "75%",
  },
  {
    name: "Dispatched",
    count: 15,
    color: "bg-orange-500",
    width: "62%",
  },
  {
    name: "Delivered",
    count: 94,
    color: "bg-green-500",
    width: "100%",
  },
];

const orders = [
  {
    reference: "PO-219246",
    customer: "Gweru Pick n Pay",
    initials: "GP",
    date: "03 Nov 2026",
    delivery: "04 Nov 2026",
    amount: "$2,643.41",
    status: "Pending Verification",
    statusColor: "bg-amber-50 text-amber-700",
    avatar: "bg-orange-100 text-orange-700",
  },
  {
    reference: "PO-219245",
    customer: "TM Supermarket",
    initials: "TM",
    date: "03 Nov 2026",
    delivery: "04 Nov 2026",
    amount: "$1,825.60",
    status: "Approved",
    statusColor: "bg-green-50 text-green-700",
    avatar: "bg-blue-100 text-blue-700",
  },
  {
    reference: "PO-219244",
    customer: "OK Zimbabwe",
    initials: "OK",
    date: "02 Nov 2026",
    delivery: "03 Nov 2026",
    amount: "$3,410.25",
    status: "Picking",
    statusColor: "bg-purple-50 text-purple-700",
    avatar: "bg-purple-100 text-purple-700",
  },
  {
    reference: "PO-219243",
    customer: "SPAR Borrowdale",
    initials: "SB",
    date: "02 Nov 2026",
    delivery: "03 Nov 2026",
    amount: "$960.00",
    status: "Dispatched",
    statusColor: "bg-orange-50 text-orange-700",
    avatar: "bg-orange-100 text-orange-700",
  },
  {
    reference: "PO-219242",
    customer: "Pick n Pay Bulawayo",
    initials: "PB",
    date: "01 Nov 2026",
    delivery: "02 Nov 2026",
    amount: "$2,120.80",
    status: "Delivered",
    statusColor: "bg-green-50 text-green-700",
    avatar: "bg-teal-100 text-teal-700",
  },
];

const activities = [
  {
    title: "New customer order received",
    description: "PO-219246 from Gweru Pick n Pay",
    time: "10 minutes ago",
    icon: FileText,
    color: "bg-blue-50 text-blue-600",
  },
  {
    title: "Order approved",
    description: "PO-219245 approved by Sales Manager",
    time: "35 minutes ago",
    icon: CheckCircle2,
    color: "bg-green-50 text-green-600",
  },
  {
    title: "Order awaiting attention",
    description: "PO-219244 has 2 items requiring confirmation",
    time: "1 hour ago",
    icon: AlertCircle,
    color: "bg-amber-50 text-amber-600",
  },
  {
    title: "Delivery completed",
    description: "PO-219242 successfully delivered",
    time: "2 hours ago",
    icon: Truck,
    color: "bg-purple-50 text-purple-600",
  },
];

function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: string;
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-4">
      <div>
        <h2 className="text-[15px] font-bold text-[#17251E]">
          {title}
        </h2>

        <p className="mt-1 text-xs text-gray-400">
          {description}
        </p>
      </div>

      {action && (
        <button className="flex items-center gap-1.5 text-xs font-semibold text-[#28583F] transition hover:text-[#173D2E]">
          {action}
          <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

export default function Home() {
  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">

        {/* Top navigation */}
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">

          <div>
            <p className="text-xs text-gray-400">
              Workspace / Dashboard
            </p>

            <h2 className="mt-1 text-lg font-bold text-[#17251E]">
              Sales Dashboard
            </h2>
          </div>

          <div className="flex items-center gap-5">

            <button className="text-gray-400 transition hover:text-gray-700">
              <Search size={19} />
            </button>

            <button className="relative text-gray-400 transition hover:text-gray-700">
              <Bell size={19} />

              <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
            </button>

            <div className="h-8 w-px bg-gray-200" />

            <button className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#D7F36B] text-xs font-bold text-[#173D2E]">
                SA
              </div>

              <div className="text-left">
                <p className="text-xs font-semibold text-gray-800">
                  Sales Administrator
                </p>

                <p className="text-[10px] text-gray-400">
                  Administrator
                </p>
              </div>

              <ChevronDown size={14} className="text-gray-400" />
            </button>

          </div>

        </header>

        {/* Dashboard content */}
        <div className="space-y-7 p-8">

          {/* Welcome section */}
          <section className="flex items-center justify-between gap-5">

            <div>
              <p className="text-sm text-gray-500">
                Tuesday, November 3, 2026
              </p>

              <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#17251E]">
                Good afternoon!
              </h1>

              <p className="mt-1 text-sm text-gray-500">
                Here&apos;s what&apos;s happening across your sales operations today.
              </p>
            </div>

            <button className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#24543F]">
              <Plus size={16} />
              Create New Order
            </button>

          </section>

          {/* KPI cards */}
          <section className="grid grid-cols-4 gap-5">

            {statistics.map((stat) => {
              const Icon = stat.icon;

              return (
                <div
                  key={stat.title}
                  className="rounded-xl border border-[#E8EBE6] bg-white p-5 transition hover:shadow-sm"
                >

                  <div className="flex items-center justify-between">

                    <p className="text-xs font-medium text-gray-500">
                      {stat.title}
                    </p>

                    <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${stat.iconBg} ${stat.iconColor}`}>
                      <Icon size={18} />
                    </div>

                  </div>

                  <div className="mt-4 flex items-end justify-between">

                    <h3 className="text-3xl font-bold tracking-tight text-[#17251E]">
                      {stat.value}
                    </h3>

                    <span
                      className={`mb-1 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${
                        stat.positive
                          ? "bg-green-50 text-green-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {stat.positive ? (
                        <ArrowUpRight size={12} />
                      ) : (
                        <Clock3 size={12} />
                      )}

                      {stat.change}
                    </span>

                  </div>

                  <p className="mt-2 text-[11px] text-gray-400">
                    {stat.description}
                  </p>

                </div>
              );
            })}

          </section>

          {/* Pipeline and activity */}
          <section className="grid grid-cols-[1.4fr_1fr] gap-5">

            {/* Order pipeline */}
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">

              <SectionHeading
                title="Order Pipeline"
                description="Track orders across the fulfilment process"
                action="View all orders"
              />

              <div className="mt-7 space-y-5">

                {pipeline.map((stage) => (
                  <div key={stage.name}>

                    <div className="mb-2 flex items-center justify-between">

                      <p className="text-xs font-medium text-gray-600">
                        {stage.name}
                      </p>

                      <p className="text-xs font-bold text-[#17251E]">
                        {stage.count}
                      </p>

                    </div>

                    <div className="h-2 overflow-hidden rounded-full bg-gray-100">

                      <div
                        className={`h-full rounded-full ${stage.color}`}
                        style={{ width: stage.width }}
                      />

                    </div>

                  </div>
                ))}

              </div>

              <div className="mt-7 flex items-center justify-between border-t border-gray-100 pt-5">

                <p className="text-xs text-gray-400">
                  Orders currently in the pipeline
                </p>

                <p className="text-sm font-bold text-[#173D2E]">
                  183 orders
                </p>

              </div>

            </div>

            {/* Recent activity */}
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">

              <SectionHeading
                title="Recent Activity"
                description="Latest updates from your team"
                action="View activity"
              />

              <div className="mt-6 space-y-6">

                {activities.map((activity) => {
                  const Icon = activity.icon;

                  return (
                    <div key={activity.title} className="flex gap-3">

                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${activity.color}`}>
                        <Icon size={17} />
                      </div>

                      <div className="min-w-0">

                        <p className="text-xs font-semibold text-gray-800">
                          {activity.title}
                        </p>

                        <p className="mt-1 text-[11px] leading-5 text-gray-500">
                          {activity.description}
                        </p>

                        <p className="mt-1 text-[10px] text-gray-400">
                          {activity.time}
                        </p>

                      </div>

                    </div>
                  );
                })}

              </div>

            </div>

          </section>

          {/* Recent orders */}
          <section className="rounded-xl border border-[#E8EBE6] bg-white">

            <div className="flex items-center justify-between p-6">

              <div>
                <h2 className="text-[15px] font-bold text-[#17251E]">
                  Recent Orders
                </h2>

                <p className="mt-1 text-xs text-gray-400">
                  A quick overview of recently received customer orders
                </p>
              </div>

              <div className="flex items-center gap-3">

                <button className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  <CalendarDays size={14} />
                  Last 30 days
                  <ChevronDown size={13} />
                </button>

                <button className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50">
                  <MoreHorizontal size={15} />
                </button>

              </div>

            </div>

            <div className="overflow-x-auto">

              <table className="w-full text-left">

                <thead>
                  <tr className="border-y border-gray-100 bg-gray-50/70">

                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Order Reference
                    </th>

                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Customer
                    </th>

                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Order Date
                    </th>

                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Delivery Date
                    </th>

                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Amount
                    </th>

                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                      Status
                    </th>

                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                    </th>

                  </tr>
                </thead>

                <tbody>

                  {orders.map((order) => (
                    <tr
                      key={order.reference}
                      className="border-b border-gray-50 transition hover:bg-gray-50/70"
                    >

                      <td className="px-6 py-4">

                        <p className="text-xs font-semibold text-[#28583F]">
                          {order.reference}
                        </p>

                      </td>

                      <td className="px-6 py-4">

                        <div className="flex items-center gap-3">

                          <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold ${order.avatar}`}>
                            {order.initials}
                          </div>

                          <p className="whitespace-nowrap text-xs font-medium text-gray-700">
                            {order.customer}
                          </p>

                        </div>

                      </td>

                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">
                        {order.date}
                      </td>

                      <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">
                        {order.delivery}
                      </td>

                      <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-gray-700">
                        {order.amount}
                      </td>

                      <td className="px-6 py-4">

                        <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold ${order.statusColor}`}>
                          {order.status}
                        </span>

                      </td>

                      <td className="px-6 py-4">

                        <button className="text-gray-400 transition hover:text-gray-700">
                          <MoreHorizontal size={17} />
                        </button>

                      </td>

                    </tr>
                  ))}

                </tbody>

              </table>

            </div>

            <div className="flex items-center justify-between px-6 py-4">

              <p className="text-[11px] text-gray-400">
                Showing 5 of 128 orders
              </p>

              <button className="text-xs font-semibold text-[#28583F] hover:text-[#173D2E]">
                View all orders →
              </button>

            </div>

          </section>

          {/* Footer */}
          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">

            <p>
              Willsgrove SalesFlow © 2026
            </p>

            <p>
              Sales Operations Platform · Harare
            </p>

          </footer>

        </div>

      </main>
    </div>
  );
}