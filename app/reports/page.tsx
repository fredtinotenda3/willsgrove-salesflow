import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOperationalDashboard } from "@/lib/reporting/operational-dashboard";
import type { ReportFilters } from "@/lib/reporting/types";
import Sidebar from "../components/sidebar";
import { MetricCard } from "./_components/ui";
import {
  TrendingUp,
  Truck,
  DollarSign,
  MessageSquare,
  ClipboardList,
  ArrowRight,
  AlertTriangle,
  AlertCircle,
  CheckCircle2,
  Users,
  Building2,
  Package,
  Lightbulb,
} from "lucide-react";

// Reads the session and live report data directly, same reason as
// app/page.tsx.
export const instant = false;

const REPORT_TILES = [
  {
    href: "/reports/pipeline",
    title: "Sales Pipeline & Orders",
    description: "Conversion rates and bottlenecks from request through to order, with cohort-safe rates.",
    icon: TrendingUp,
  },
  {
    href: "/reports/fulfilment",
    title: "Picking & Fulfilment",
    description: "Picking availability, dispatch and delivery performance, never blending picked with delivered.",
    icon: Truck,
  },
  {
    href: "/reports/financial-exposure",
    title: "Invoice Claims & Financial Exposure",
    description: "Reconciliation, claims, returns and credit notes -- SAP remains the system of record.",
    icon: DollarSign,
  },
  {
    href: "/reports/communications",
    title: "Communications & Exceptions",
    description: "Channel health, intake backlog and delivery exceptions across email and WhatsApp.",
    icon: MessageSquare,
  },
];

const SEVERITY_STYLES: Record<string, { icon: typeof AlertTriangle; color: string }> = {
  urgent: { icon: AlertTriangle, color: "bg-red-50 text-red-600" },
  attention: { icon: AlertCircle, color: "bg-amber-50 text-amber-600" },
  info: { icon: CheckCircle2, color: "bg-gray-100 text-gray-500" },
};

function formatAsOf(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export default async function ReportsHubPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

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
    currency: null,
    lostSalesReason: null,
    includeDemo: false,
    productCategory: null,
    productSearch: null,
    sapItemCode: null,
    decisionCategory: null,
    priority: null,
    recommendationStatus: null,
  };

  const dashboard = await getOperationalDashboard(user.id, user.role, filters);
  const canSeeManagementReports = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Reports &amp; Analytics</h2>
          </div>
          <p className="text-xs text-gray-400">Live snapshot · updated {formatAsOf(dashboard.asOf)}</p>
        </header>

        <div className="space-y-7 p-8">
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Operational intelligence</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              One reporting layer over real, non-demo order, fulfilment, financial and communications data -- no
              figure here is estimated or fabricated when the underlying data doesn&apos;t exist yet.
            </p>
          </section>

          {/* Snapshot KPIs */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard title="Orders received" value={String(dashboard.snapshot.ordersReceived)} description="Awaiting sales review" />
            <MetricCard title="Awaiting approval" value={String(dashboard.snapshot.ordersAwaitingApproval)} description="Submitted for manager decision" />
            <MetricCard title="Awaiting fulfilment" value={String(dashboard.snapshot.ordersAwaitingFulfilment)} description="Approved/picking, not yet dispatched" />
            <MetricCard title="Open invoice claims" value={String(dashboard.snapshot.openInvoiceClaims)} description="Not yet resolved, rejected or closed" />
          </section>

          {/* Action queue */}
          <section className="rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm md:p-6">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="font-bold text-[#17251E]">Action Queue</h2>
                <p className="mt-1 text-xs text-[#849087]">What needs attention right now, curated not exhaustive</p>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {dashboard.actionQueues.map((item) => {
                const { icon: Icon, color } = SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.info;
                return (
                  <Link
                    key={item.label}
                    href={item.drillDown.href}
                    className="flex items-start gap-3 rounded-xl border border-[#E9EDE8] p-4 transition hover:border-[#C9D4C6] hover:bg-gray-50"
                  >
                    <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}>
                      <Icon size={16} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#17251E]">{item.label}</p>
                      <p className="mt-1 text-xl font-bold text-[#17251E]">{item.count}</p>
                      <p className="mt-0.5 text-[11px] text-[#849087]">{item.drillDown.label}</p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>

          {/* Report tiles */}
          <section>
            <h2 className="mb-4 text-lg font-bold text-[#17251E]">Detailed reports</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {REPORT_TILES.map((tile) => {
                const Icon = tile.icon;
                return (
                  <Link
                    key={tile.href}
                    href={tile.href}
                    className="group flex items-start gap-4 rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm transition hover:border-[#C9D4C6] hover:shadow"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2F6F1] text-[#496A42]">
                      <Icon size={20} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-[#17251E]">{tile.title}</p>
                      <p className="mt-1 text-xs leading-5 text-[#849087]">{tile.description}</p>
                    </div>
                    <ArrowRight size={16} className="mt-1 shrink-0 text-[#A6AFA4] transition group-hover:text-[#17251E]" />
                  </Link>
                );
              })}

              {canSeeManagementReports && (
                <Link
                  href="/reports/sales-performance"
                  className="group flex items-start gap-4 rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm transition hover:border-[#C9D4C6] hover:shadow"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2F6F1] text-[#496A42]">
                    <Users size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#17251E]">Sales Performance</p>
                    <p className="mt-1 text-xs leading-5 text-[#849087]">
                      Salesperson attribution confidence, revenue, customer activity and lost-sales breakdowns.
                      Sales Manager / Administrator only.
                    </p>
                  </div>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-[#A6AFA4] transition group-hover:text-[#17251E]" />
                </Link>
              )}

              {canSeeManagementReports && (
                <Link
                  href="/reports/customer-intelligence"
                  className="group flex items-start gap-4 rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm transition hover:border-[#C9D4C6] hover:shadow"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2F6F1] text-[#496A42]">
                    <Building2 size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#17251E]">Customer Intelligence</p>
                    <p className="mt-1 text-xs leading-5 text-[#849087]">
                      Independent customer rankings by invoice line value, purchase frequency and recency, plus
                      open claims. Sales Manager / Administrator only. Any role can open a customer&apos;s own 360
                      profile from the customer directory.
                    </p>
                  </div>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-[#A6AFA4] transition group-hover:text-[#17251E]" />
                </Link>
              )}

              {canSeeManagementReports && (
                <Link
                  href="/reports/product-intelligence"
                  className="group flex items-start gap-4 rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm transition hover:border-[#C9D4C6] hover:shadow"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2F6F1] text-[#496A42]">
                    <Package size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#17251E]">Product Intelligence</p>
                    <p className="mt-1 text-xs leading-5 text-[#849087]">
                      Ten independent product rankings -- revenue, quantity, frequency, customers, lost sales,
                      claims and returns, credit notes, delivery rejections, declining activity and master-data
                      quality. Sales Manager / Administrator only. Any role can open a product&apos;s own 360
                      profile from the product directory.
                    </p>
                  </div>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-[#A6AFA4] transition group-hover:text-[#17251E]" />
                </Link>
              )}

              {canSeeManagementReports && (
                <Link
                  href="/reports/decision-intelligence"
                  className="group flex items-start gap-4 rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm transition hover:border-[#C9D4C6] hover:shadow"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2F6F1] text-[#496A42]">
                    <Lightbulb size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#17251E]">Decision Intelligence</p>
                    <p className="mt-1 text-xs leading-5 text-[#849087]">
                      Deterministic, explainable recommendations across sales, customer, product, commercial
                      exposure and operational decisions, with a lifecycle and full history. Sales Manager /
                      Administrator only.
                    </p>
                  </div>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-[#A6AFA4] transition group-hover:text-[#17251E]" />
                </Link>
              )}

              {canSeeManagementReports && (
                <Link
                  href="/reports/management"
                  className="group flex items-start gap-4 rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm transition hover:border-[#C9D4C6] hover:shadow"
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2F6F1] text-[#496A42]">
                    <ClipboardList size={20} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-[#17251E]">Management Reports</p>
                    <p className="mt-1 text-xs leading-5 text-[#849087]">
                      9 named reports -- daily/weekly/monthly summaries, outstanding orders, picking shortages,
                      delivery exceptions and more. Sales Manager / Administrator only.
                    </p>
                  </div>
                  <ArrowRight size={16} className="mt-1 shrink-0 text-[#A6AFA4] transition group-hover:text-[#17251E]" />
                </Link>
              )}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
