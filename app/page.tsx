import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/current-user";
import { type ActionQueueItem, type ActionQueueSeverity, type OperationalDashboard } from "@/lib/reporting/operational-dashboard";
import { getDecisionDashboard, type DashboardKpi } from "@/lib/reporting/decision-dashboard";
import { RequestedVsUnavailableTrendChart, EstimatedLostValueTrendChart } from "@/components/charts/lost-sales-trend";
import { listOrders } from "@/lib/order-queries";
import { getEffectiveOrderStatus, formatOrderDate, formatOrderAmount, initialsFor, avatarColorFor } from "@/lib/order-display";
import type { ReportFilters } from "@/lib/reporting/types";
import Sidebar from "./components/sidebar";

import {
  Search,
  Bell,
  Plus,
  ShoppingCart,
  Clock3,
  Truck,
  MoreHorizontal,
  ChevronDown,
  ArrowRight,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Minus,
  Gauge,
  Receipt,
  Wallet,
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
 * Final completion phase, section 3 ("genuine decision-support
 * dashboard"): every number and list on this page is real, non-demo data
 * from the shared M11 reporting layer, composed by
 * lib/reporting/decision-dashboard.ts -- no hardcoded pipeline counts,
 * fake activity feed, fabricated order rows, or invented targets.
 *
 * KPI section is now the dashboard's own 5-9 curated KPIs (one per named
 * business area: sales/orders, picking/fulfilment+availability,
 * dispatch/delivery, financial exposure, claims, lost sales), each with
 * a real period-over-period comparison where the underlying figure is a
 * genuine period flow, or an honest "current position" label where it
 * is a whole-business running total instead -- see
 * decision-dashboard.ts's own module comment for why those two are never
 * blended into one fabricated delta.
 */
const KPI_ICONS: Record<string, { icon: typeof ShoppingCart; bg: string; color: string }> = {
  ordersReceived: { icon: ShoppingCart, bg: "bg-blue-50", color: "text-blue-600" },
  orderApprovalRate: { icon: CheckCircle2, bg: "bg-indigo-50", color: "text-indigo-600" },
  pickingAvailabilityRate: { icon: Gauge, bg: "bg-purple-50", color: "text-purple-600" },
  ordersAwaitingFulfilment: { icon: Clock3, bg: "bg-amber-50", color: "text-amber-600" },
  deliveryAcceptanceRate: { icon: Truck, bg: "bg-green-50", color: "text-green-600" },
  openInvoiceClaims: { icon: Receipt, bg: "bg-rose-50", color: "text-rose-600" },
  claimsFinancialExposure: { icon: Wallet, bg: "bg-orange-50", color: "text-orange-600" },
  estimatedLostSalesValue: { icon: TrendingDown, bg: "bg-red-50", color: "text-red-600" },
};

function ComparisonLine({ comparison }: { comparison: DashboardKpi["comparison"] }) {
  if (comparison.kind === "pointInTime") {
    return (
      <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">
        {comparison.asOfLabel}
      </span>
    );
  }

  const delta = comparison.deltaPercent;
  const DeltaIcon = delta === null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaColor = delta === null || delta === 0 ? "text-gray-400" : delta > 0 ? "text-emerald-600" : "text-rose-600";

  return (
    <span className="inline-flex items-center gap-2">
      <span className={`inline-flex items-center gap-0.5 font-semibold ${deltaColor}`}>
        <DeltaIcon size={12} />
        {delta === null ? "n/a" : `${Math.abs(delta)}%`}
      </span>
      <span className="text-gray-400">{comparison.periodLabel}</span>
    </span>
  );
}

function KpiCard({ kpi }: { kpi: DashboardKpi }) {
  const config = KPI_ICONS[kpi.id] ?? { icon: ShoppingCart, bg: "bg-gray-50", color: "text-gray-500" };
  const Icon = config.icon;
  const sampleSize = kpi.comparison.kind === "period" ? kpi.comparison.sampleSize : undefined;

  return (
    <Link
      href={kpi.drillDown.href}
      title={kpi.definition}
      className="rounded-xl border border-[#E8EBE6] bg-white p-5 transition hover:shadow-sm"
    >
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-gray-500">{kpi.label}</p>
        <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${config.bg} ${config.color}`}>
          <Icon size={18} />
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <h3 className="text-3xl font-bold tracking-tight text-[#17251E]">{kpi.value}</h3>
      </div>

      {kpi.currencyBreakdown && kpi.currencyBreakdown.length > 1 && (
        <p className="mt-1 text-[10px] text-gray-400">
          {kpi.currencyBreakdown.map((b) => `${b.currencyCode} ${b.amount}`).join(" · ")}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between text-[11px]">
        <ComparisonLine comparison={kpi.comparison} />
        {sampleSize !== undefined && <span className="text-gray-400">n={sampleSize}</span>}
      </div>
    </Link>
  );
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
    unfulfilledDemandStatus: null,
    customerDecisionType: null,
    productCategory: null,
    productSearch: null,
    sapItemCode: null,
    decisionCategory: null,
    priority: null,
    recommendationStatus: null,
  };

  const [dashboard, recentOrders] = await Promise.all([
    getDecisionDashboard(user.id, user.role, filters),
    listOrders({ search: "", status: null, includeDemo: false, page: 1, pageSize: 5 }),
  ]);

  // Role-based access (spec section 3 / lib/reporting/access.ts's own
  // documented two-tier precedent): every authenticated role sees the
  // operational KPIs; the two KPIs that are literally a money exposure
  // figure are visible only to SALES_MANAGER/ADMINISTRATOR. This is a
  // UX/relevance filter on this specific dashboard, not this app's actual
  // authorization boundary for that data -- each underlying report
  // page/route enforces its own access independently (see that file's
  // comment for why).
  const isManagement = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";
  const visibleKpis: DashboardKpi[] = dashboard.kpis.filter((kpi) => kpi.visibility === "all" || isManagement);
  const pipelineMax = Math.max(1, ...PIPELINE_STAGES.map((stage) => dashboard.snapshot[stage.key]));

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen md:pl-[260px]">

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

          {/* KPI cards: real, period-compared or point-in-time figures only --
              no fabricated targets, no metric shown merely because it exists. */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs text-gray-400">
                {visibleKpis.length} key metrics · period {dashboard.dateFrom} to {dashboard.dateTo}
              </p>
            </div>
            <div className="grid grid-cols-4 gap-5">
              {visibleKpis.map((kpi) => (
                <KpiCard key={kpi.id} kpi={kpi} />
              ))}
            </div>
          </section>

          {/* Trends: reuses the exact same lost-sales trend charts and data
              as /lost-sales/analytics (components/charts/lost-sales-trend.tsx) --
              never a second, re-derived implementation of the same chart. */}
          <section className="grid grid-cols-2 gap-5">
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
              <SectionHeading
                title="Requested vs. Unavailable (trend)"
                description="Daily demand vs. shortage quantity, trailing 30 days"
                action="Full analytics"
                actionHref="/lost-sales/analytics"
              />
              <RequestedVsUnavailableTrendChart data={dashboard.trend} />
            </div>
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
              <SectionHeading
                title="Estimated Lost Value (trend)"
                description="Supply-shortage lost-sales estimate by day, trailing 30 days"
                action="Full analytics"
                actionHref="/lost-sales/analytics"
              />
              <EstimatedLostValueTrendChart data={dashboard.trend} />
            </div>
          </section>

          {/* Pipeline and exceptions */}
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

            {/* Exceptions & priorities */}
            <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">

              <SectionHeading
                title="Exceptions & Priorities"
                description="What needs attention right now, with a link to the underlying records"
                action="View reports"
                actionHref="/reports"
              />

              <div className="mt-6 space-y-5">

                {dashboard.exceptions.map((item: ActionQueueItem) => {
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
                    // Final completion phase, section 7: same derived
                    // Departed/Delivered label as /orders and the order
                    // detail page, not the raw status -- this dashboard
                    // is exactly the "stuck at Ready for Invoice" surface
                    // the directive named.
                    const { label: statusLabel, style: statusStyle } = getEffectiveOrderStatus({
                      status: order.status,
                      dispatchStatuses: order.dispatchStatuses,
                    });

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
