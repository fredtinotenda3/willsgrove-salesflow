import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getDecisionDashboard } from "@/lib/reporting/decision-dashboard";
import { getClaimComposition } from "@/lib/invoice-claims/composition-queries";
import { visibleReportGroups, type ReportEntry } from "@/lib/reports/hub-groups";
import { dashboardKpiToCard } from "@/lib/kpi/from-dashboard";
import { formatMoney, formatQuantity } from "@/lib/format/analytics";
import { KpiCard } from "@/components/kpi/kpi-card";
import type { ReportFilters } from "@/lib/reporting/types";
import Sidebar from "../components/sidebar";
import { SectionCard } from "./_components/ui";
import {
  TrendingUp,
  TrendingDown,
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
  FileWarning,
} from "lucide-react";

const ICONS: Record<ReportEntry["icon"], typeof TrendingUp> = {
  "trending-up": TrendingUp,
  users: Users,
  truck: Truck,
  "trending-down": TrendingDown,
  "dollar-sign": DollarSign,
  "file-warning": FileWarning,
  building: Building2,
  package: Package,
  "message-square": MessageSquare,
  lightbulb: Lightbulb,
  "clipboard-list": ClipboardList,
};

/** KPIs surfaced in the executive overview, in display order. Anything else stays on the main dashboard. */
const OVERVIEW_KPI_IDS = ["ordersReceived", "pickingAvailabilityRate", "estimatedLostSalesValue", "openInvoiceClaims"];

// Reads the session and live report data directly, same reason as
// app/page.tsx.
export const instant = false;

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
    unfulfilledDemandStatus: null,
    lostSaleSource: null,
    includeDemo: false,
    productCategory: null,
    productSearch: null,
    sapItemCode: null,
    decisionCategory: null,
    priority: null,
    recommendationStatus: null,
  };

  const canSeeManagementReports = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";
  const groups = visibleReportGroups(user.role);

  // Reuses the main dashboard's KPI definitions and period comparisons
  // (nothing is re-derived here). The unresolved-claims exposure is manager
  // only, matching the financial-exposure report's own gate.
  const [dashboard, unresolvedClaims] = await Promise.all([
    getDecisionDashboard(user.id, user.role, filters),
    canSeeManagementReports ? getClaimComposition({ unresolvedOnly: true, topProducts: 1 }) : Promise.resolve(null),
  ]);

  const overviewCards = OVERVIEW_KPI_IDS.map((id) => dashboard.kpis.find((kpi) => kpi.id === id && (kpi.visibility === "all" || canSeeManagementReports)))
    .filter((kpi): kpi is NonNullable<typeof kpi> => Boolean(kpi))
    .map(dashboardKpiToCard);

  const urgentQueues = dashboard.exceptions.filter((item) => item.count > 0 && item.severity !== "info");
  const unresolvedExposure = unresolvedClaims?.summary.valueByCurrency ?? [];

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Reports &amp; Analytics</h2>
          </div>
          <p className="text-xs text-gray-400">{dashboard.periodLabel} · updated {formatAsOf(dashboard.asOf)}</p>
        </header>

        <div className="space-y-8 p-8">
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Reports &amp; Analytics</h1>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              One reporting layer over real, non-demo order, fulfilment, financial and communications data. Nothing here is estimated or
              invented when the underlying data does not exist yet.
            </p>
          </section>

          {/* Executive overview */}
          <section aria-label="Executive overview">
            <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-[#718078]">Executive overview</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {overviewCards.map((card) => (
                <KpiCard key={card.title} {...card} />
              ))}
            </div>
          </section>

          {/* Needs attention */}
          <SectionCard title="Needs attention" description="Open work and risks right now, most pressing first.">
            {urgentQueues.length === 0 && dashboard.repeatedProductShortages.length === 0 && unresolvedExposure.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-[#718078]"><CheckCircle2 size={16} className="text-emerald-600" /> Nothing needs attention right now.</p>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[...urgentQueues].sort((x, y) => (x.severity === y.severity ? y.count - x.count : x.severity === "urgent" ? -1 : 1)).map((item) => {
                  const { icon: Icon, color } = SEVERITY_STYLES[item.severity] ?? SEVERITY_STYLES.info;
                  return (
                    <Link key={item.label} href={item.drillDown.href} className="flex items-start gap-3 rounded-xl border border-[#E9EDE8] p-4 transition hover:border-[#C9D4C6] hover:bg-gray-50">
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${color}`}><Icon size={16} /></div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-[#17251E]">{item.label}</p>
                        <p className="mt-1 text-xl font-bold tabular-nums text-[#17251E]">{item.count}</p>
                        <p className="mt-0.5 text-[11px] text-[#849087]">{item.drillDown.label}</p>
                      </div>
                    </Link>
                  );
                })}

                {unresolvedExposure.length > 0 && (
                  <Link href="/invoice-claims/dashboard" className="flex items-start gap-3 rounded-xl border border-[#E9EDE8] p-4 transition hover:border-[#C9D4C6] hover:bg-gray-50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><AlertCircle size={16} /></div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#17251E]">Unresolved claim exposure</p>
                      {unresolvedExposure.map((row) => (
                        <p key={row.currency} className="mt-1 text-lg font-bold tabular-nums text-[#17251E]">{formatMoney(row.value, row.currency)}</p>
                      ))}
                      <p className="mt-0.5 text-[11px] text-[#849087]">Disputed value, not a SAP credit note</p>
                    </div>
                  </Link>
                )}

                {dashboard.repeatedProductShortages.map((product) => (
                  <Link key={product.productId ?? product.sapItemCode ?? product.name} href={product.href} className="flex items-start gap-3 rounded-xl border border-[#E9EDE8] p-4 transition hover:border-[#C9D4C6] hover:bg-gray-50">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><TrendingDown size={16} /></div>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-[#17251E]">Repeated shortage: {product.name}</p>
                      <p className="mt-1 text-sm font-bold tabular-nums text-[#17251E]">{product.demandCount} orders short</p>
                      <p className="mt-0.5 text-[11px] text-[#849087]">{formatQuantity(product.unavailableQuantity, product.unitOfMeasure)} unavailable</p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Grouped reports */}
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`group-${group.id}`}>
              <h2 id={`group-${group.id}`} className="text-lg font-bold text-[#17251E]">{group.title}</h2>
              <p className="mb-3 mt-0.5 text-xs text-[#849087]">{group.description}</p>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {group.entries.map((entry) => {
                  const Icon = ICONS[entry.icon];
                  return (
                    <Link key={entry.href} href={entry.href} className="group flex items-start gap-4 rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm transition hover:border-[#C9D4C6] hover:shadow">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#F2F6F1] text-[#496A42]"><Icon size={20} /></div>
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-[#17251E]">{entry.title}</p>
                        <p className="mt-1 text-xs leading-5 text-[#849087]">{entry.description}</p>
                        {entry.access === "management" && <p className="mt-2 text-[11px] font-medium text-[#718078]">Sales Manager / Administrator</p>}
                      </div>
                      <ArrowRight size={16} className="mt-1 shrink-0 text-[#A6AFA4] transition group-hover:text-[#17251E]" />
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
