import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOperationalDashboard, type ActionQueueItem, type ActionQueueSeverity, type OperationalDashboard } from "@/lib/reporting/operational-dashboard";
import { listOrders } from "@/lib/order-queries";
import { ORDER_STATUS_LABELS, ORDER_STATUS_STYLES, formatOrderDate, formatOrderAmount, initialsFor, avatarColorFor } from "@/lib/order-display";
import type { ReportFilters } from "@/lib/reporting/types";
import Sidebar from "./components/sidebar";

import {
  Search,
  Bell,
  Plus,
  ShoppingCart,
  Clock3,
  PackageCheck,
  Truck,
  MoreHorizontal,
  ChevronDown,
  ArrowRight,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
} from "lucide-react";

// Cache Components (next.config.ts: cacheComponents: true) can't prerender
// a request-time auth + DB read into the static shell -- this page reads
// the session and live order/report data directly (not through an API
// route), so it needs the request every time. Restructuring behind a
// <Suspense> boundary per Next's recommended pattern is deferred for this
// milestone; `instant = false` is Next's own documented escape hatch for
// migrating one route at a time (see docs: authentication-with-cache-components).
export const instant = false;

/**
 * Milestone 11 (Operational BI): every number and list on this page is
 * now real, non-demo data from the shared M11 reporting layer
 * (lib/reporting/operational-dashboard.ts) and the existing order list
 * query -- no more hardcoded pipeline counts, fake "10 minutes ago"
 * activity feed, or fabricated order rows. This dashboard is the "one
 * reliable operational intelligence layer" spec section 2 calls for, not
 * a page with its own disconnected mock data.
 *
 * "Awaiting Fulfilment" now uses the corrected definition (APPROVED/
 * PICKING orders with no dispatch that has actually departed yet,
 * derived from M10's real DispatchRecord data) rather than the old
 * APPROVED-and-not-yet-handed-to-SAP proxy this page used before M11.
 */
function buildStatistics(totalOrders: number, snapshot: OperationalDashboard["snapshot"]) {
  return [
    {
      title: "Total Orders",
      value: String(totalOrders),
      description: "Non-demo orders recorded",
      icon: ShoppingCart,
      iconBg: "bg-blue-50",
      iconColor: "text-blue-600",
    },
    {
      title: "Pending Verification",
      value: String(snapshot.ordersReceived),
      description: "Awaiting sales review",
      icon: Clock3,
      iconBg: "bg-amber-50",
      iconColor: "text-amber-600",
    },
    {
      title: "Awaiting Fulfilment",
      value: String(snapshot.ordersAwaitingFulfilment),
      description: "Approved/picking, not yet dispatched",
      icon: PackageCheck,
      iconBg: "bg-purple-50",
      iconColor: "text-purple-600",
    },
    {
      title: "Completed Deliveries",
      value: String(snapshot.ordersDelivered),
      description: "Confirmed delivered to customer",
      icon: Truck,
      iconBg: "bg-green-50",
      iconColor: "text-green-600",
    },
  ];
}

const PIPELINE_STAGES: { key: keyof OperationalDashboard["snapshot"]; name: string; color: string }[] = [
  { key: "ordersReceived", name: "Received", color: "bg-blue-500" },
  { key: "ordersAwaitingApproval", name: "Awaiting Approval", color: "bg-amber-500" },
  { key: "ordersApproved", name: "Approved", color: "bg-indigo-500" },
  { key: "ordersAwaitingFulfilment", name: "Awaiting Fulfilment", color: "bg-purple-500" },
  { key: "ordersDispatched", name: "Dispatched", color: "bg-orange-500" },
  { key: "ordersDelivered", name: "Delivered", color: "bg-green-500" },
];

const SEVERITY_STYLES: Record<ActionQueueSeverity, { icon: typeof AlertTriangle; color: string }> = {
  urgent: { icon: AlertTriangle, color: "bg-red-50 text-red-600" },
  attention: { icon: AlertCircle, color: "bg-amber-50 text-amber-600" },
  info: { icon: CheckCircle2, color: "bg-gray-100 text-gray-500" },
};

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function SectionHeading({
  title,
  description,
  action,
  actionHref,
}: {
  title: string;
  description: string;
  action?: string;
  actionHref?: string;
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

      {action && actionHref && (
        <Link href={actionHref} className="flex items-center gap-1.5 text-xs font-semibold text-[#28583F] transition hover:text-[#173D2E]">
          {action}
          <ArrowRight size={14} />
        </Link>
      )}
    </div>
  );
}

export default async function Home() {
  // Real auth enforcement, not just proxy.ts's optimistic cookie check --
  // this component reads live order/report data directly, with no route
  // handler in between to re-check authorization, so the check has to
  // live here.
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  // The operational dashboard is a right-now snapshot (spec section 3),
  // not date-range filtered -- only `includeDemo` applies, same as every
  // other M11 view's default.
  const filters: ReportFilters = {
    dateFrom: null,
    dateTo: null,
    customerId: null,
    productId: null,
    salespersonId: null,
    orderStatus: null,
    quotationStatus: null,
    fulfilmentStatus: null,
    claimStatus: null,
    communicationStatus: null,
    includeDemo: false,
    currency: null,
    lostSalesReason: null,
    productCategory: null,
    productSearch: null,
    sapItemCode: null,
    decisionCategory: null,
    priority: null,
    recommendationStatus: null,
  };

  const [dashboard, recentOrders] = await Promise.all([
    getOperationalDashboard(user.id, user.role, filters),
    listOrders({ search: "", status: null, includeDemo: false, page: 1, pageSize: 5 }),
  ]);

  const statistics = buildStatistics(recentOrders.pagination.totalItems, dashboard.snapshot);
  const pipelineMax = Math.max(1, ...PIPELINE_STAGES.map((stage) => dashboard.snapshot[stage.key]));

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
                {initialsFor(user.name ?? user.email)}
              </div>

              <div className="text-left">
                <p className="text-xs font-semibold text-gray-800">
                  {user.name ?? user.email}
                </p>

                <p className="text-[10px] text-gray-400">
                  {user.role}
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
                Live snapshot · updated {formatAsOf(dashboard.asOf)}
              </p>

              <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#17251E]">
                Good to see you!
              </h1>

              <p className="mt-1 text-sm text-gray-500">
                Here&apos;s what&apos;s happening across your sales operations today.
              </p>
            </div>

            <Link
              href="/orders/new"
              className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-3 text-xs font-semibold text-white shadow-sm transition hover:bg-[#24543F]"
            >
              <Plus size={16} />
              Create New Order
            </Link>

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

                  </div>

                  <p className="mt-2 text-[11px] text-gray-400">
                    {stat.description}
                  </p>

                </div>
              );
            })}

          </section>

          {/* Pipeline and action queue */}
          <section className="grid grid-cols-[1.4fr_1fr] gap-5">

            {/* Order pipeline */}
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">

              <SectionHeading
                title="Order Pipeline"
                description="Real-time order counts across the fulfilment process"
                action="View all orders"
                actionHref="/orders"
              />

              <div className="mt-7 space-y-5">

                {PIPELINE_STAGES.map((stage) => {
                  const count = dashboard.snapshot[stage.key];
                  const width = `${Math.max(4, Math.round((count / pipelineMax) * 100))}%`;

                  return (
                    <div key={stage.name}>

                      <div className="mb-2 flex items-center justify-between">

                        <p className="text-xs font-medium text-gray-600">
                          {stage.name}
                        </p>

                        <p className="text-xs font-bold text-[#17251E]">
                          {count}
                        </p>

                      </div>

                      <div className="h-2 overflow-hidden rounded-full bg-gray-100">

                        <div
                          className={`h-full rounded-full ${stage.color}`}
                          style={{ width }}
                        />

                      </div>

                    </div>
                  );
                })}

              </div>

              <div className="mt-7 flex items-center justify-between border-t border-gray-100 pt-5">

                <p className="text-xs text-gray-400">
                  Figures are independent per-stage counts, not a funnel total -- an order can count in more than one stage.
                </p>

                <Link href="/reports/pipeline" className="text-xs font-semibold text-[#173D2E] hover:text-[#28583F]">
                  Full pipeline report →
                </Link>

              </div>

            </div>

            {/* Action queue */}
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">

              <SectionHeading
                title="Action Queue"
                description="What needs attention right now"
                action="View reports"
                actionHref="/reports"
              />

              <div className="mt-6 space-y-5">

                {dashboard.actionQueues.map((item: ActionQueueItem) => {
                  const { icon: Icon, color } = SEVERITY_STYLES[item.severity];

                  return (
                    <Link
                      key={item.label}
                      href={item.drillDown.href}
                      className="flex gap-3 rounded-lg -mx-2 px-2 py-1 transition hover:bg-gray-50"
                    >

                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}>
                        <Icon size={17} />
                      </div>

                      <div className="min-w-0 flex-1">

                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-gray-800">
                            {item.label}
                          </p>

                          <p className="text-xs font-bold text-[#17251E]">
                            {item.count}
                          </p>
                        </div>

                        <p className="mt-1 text-[11px] leading-5 text-gray-500">
                          {item.drillDown.label}
                        </p>

                      </div>

                    </Link>
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
                  The 5 most recently received customer orders
                </p>
              </div>

              <div className="flex items-center gap-3">

                <Link
                  href="/orders"
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  <MoreHorizontal size={15} />
                  All orders
                </Link>

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
                      Requested Delivery
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

                  {recentOrders.orders.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-6 py-10 text-center text-xs text-gray-400">
                        No orders recorded yet.
                      </td>
                    </tr>
                  )}

                  {recentOrders.orders.map((order: (typeof recentOrders.orders)[number]) => {
                    const customerName = order.customer?.name ?? "Unknown customer";
                    const statusLabel = ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] ?? order.status;
                    const statusStyle = ORDER_STATUS_STYLES[order.status as keyof typeof ORDER_STATUS_STYLES] ?? "bg-gray-100 text-gray-500";

                    return (
                      <tr
                        key={order.id}
                        className="border-b border-gray-50 transition hover:bg-gray-50/70"
                      >

                        <td className="px-6 py-4">
                          <Link href={`/orders/${order.id}`} className="text-xs font-semibold text-[#28583F] hover:text-[#173D2E]">
                            {order.reference}
                          </Link>
                        </td>

                        <td className="px-6 py-4">

                          <div className="flex items-center gap-3">

                            <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[10px] font-bold ${avatarColorFor(customerName)}`}>
                              {initialsFor(customerName)}
                            </div>

                            <p className="whitespace-nowrap text-xs font-medium text-gray-700">
                              {customerName}
                            </p>

                          </div>

                        </td>

                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">
                          {formatOrderDate(order.orderDate)}
                        </td>

                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-500">
                          {formatOrderDate(order.requestedDeliveryDate)}
                        </td>

                        <td className="whitespace-nowrap px-6 py-4 text-xs font-semibold text-gray-700">
                          {formatOrderAmount(order.total, order.currency)}
                        </td>

                        <td className="px-6 py-4">

                          <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold ${statusStyle}`}>
                            {statusLabel}
                          </span>

                        </td>

                        <td className="px-6 py-4">

                          <Link href={`/orders/${order.id}`} className="text-gray-400 transition hover:text-gray-700">
                            <MoreHorizontal size={17} />
                          </Link>

                        </td>

                      </tr>
                    );
                  })}

                </tbody>

              </table>

            </div>

            <div className="flex items-center justify-between px-6 py-4">

              <p className="text-[11px] text-gray-400">
                Showing {recentOrders.orders.length} of {recentOrders.pagination.totalItems} orders
              </p>

              <Link href="/orders" className="text-xs font-semibold text-[#28583F] hover:text-[#173D2E]">
                View all orders →
              </Link>

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
