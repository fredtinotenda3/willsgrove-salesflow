import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listApprovalRequests, getApprovalDashboard } from "@/lib/approvals/queries";
import type { ApprovalRequestStatus, ApprovalModule } from "@/lib/approvals/validation";
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUS_STYLES,
  APPROVAL_MODULE_LABELS,
  APPROVAL_ACTION_TYPE_LABELS,
} from "@/lib/approvals/display";
import Sidebar from "../components/sidebar";
import { ShieldCheck, ChevronRight, Settings2, Clock } from "lucide-react";

/**
 * Milestone 8 (spec section 8: "an approval dashboard... pending
 * approvals, ability to view history"). A single list page with tabs for
 * the three views that actually matter day-to-day (all / awaiting my
 * decision / submitted by me) plus the summary counters a manager wants
 * at a glance, mirroring /invoice-claims's established
 * "deliberately simple Server Component list" convention. The fuller
 * breakdown (turnaround time, module split) lives on its own
 * /approvals/dashboard endpoint's data via getApprovalDashboard, surfaced
 * here as the counter row rather than a second page -- there isn't
 * enough distinct content to justify splitting it.
 */
export const instant = false;

type Tab = "all" | "pending" | "mine";

type RouteParams = { searchParams: Promise<{ tab?: string; status?: string; module?: string }> };

const STATUS_FILTERS: ApprovalRequestStatus[] = ["PENDING", "APPROVED", "REJECTED", "CANCELLED", "WITHDRAWN"];
const MODULE_FILTERS: ApprovalModule[] = ["QUOTATIONS", "ORDERS"];

export default async function ApprovalsPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolved = await searchParams;
  const tab: Tab = resolved.tab === "pending" || resolved.tab === "mine" ? resolved.tab : "all";
  // Explicitly typed for the same reason as app/api/approvals/route.ts's
  // `mine` -- `.includes()` against a typed array narrows the boolean
  // check but not `resolved.status` itself, so without an annotation
  // here the ternary's result widens back to `string | undefined`.
  const status: ApprovalRequestStatus | undefined =
    resolved.status && (STATUS_FILTERS as string[]).includes(resolved.status) ? (resolved.status as ApprovalRequestStatus) : undefined;
  const moduleFilter: ApprovalModule | undefined =
    resolved.module && (MODULE_FILTERS as string[]).includes(resolved.module) ? (resolved.module as ApprovalModule) : undefined;

  const canDecideAnything = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";

  const [requests, dashboard] = await Promise.all([
    listApprovalRequests({
      status: tab === "all" ? status : undefined,
      module: moduleFilter,
      mine:
        tab === "pending"
          ? { viewerId: user.id, kind: "pendingDecision", viewerRole: user.role }
          : tab === "mine"
            ? { viewerId: user.id, kind: "submitted", viewerRole: user.role }
            : undefined,
    }),
    getApprovalDashboard(user.id, user.role),
  ]);

  const query = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (tab !== "all") params.set("tab", tab);
    if (status) params.set("status", status);
    if (moduleFilter) params.set("module", moduleFilter);
    Object.entries(overrides).forEach(([key, value]) => {
      if (value === undefined) params.delete(key);
      else params.set(key, value);
    });
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Approvals</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Approvals</h2>
          </div>
          {canDecideAnything && (
            <Link
              href="/approvals/policies"
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              <Settings2 size={14} />
              Policies
            </Link>
          )}
        </header>

        <div className="space-y-6 p-8">
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Approval requests</h1>
            <p className="mt-1 text-sm text-gray-500">
              One cross-module approval queue -- today, quotation discounts exceeding a configured threshold. A request
              here is the single authoritative way a pricing exception or similar gated action gets decided.
            </p>
          </section>

          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
            <Counter label="Pending" value={dashboard.statusCounts.PENDING ?? 0} />
            <Counter label="Awaiting my decision" value={dashboard.pendingMyDecisionCount} highlight={dashboard.pendingMyDecisionCount > 0} />
            <Counter label="Submitted by me" value={dashboard.submittedByMeCount} />
            <Counter label="Overdue" value={dashboard.overdueCount} warn={dashboard.overdueCount > 0} />
            <Counter label="Approved" value={dashboard.statusCounts.APPROVED ?? 0} />
            <Counter label="Avg. turnaround" value={dashboard.averageTurnaroundHours !== null ? `${dashboard.averageTurnaroundHours}h` : "-"} />
          </section>

          <section className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <TabLink href={`/approvals${query({ tab: undefined })}`} active={tab === "all"}>
                All
              </TabLink>
              <TabLink href={`/approvals${query({ tab: "pending" })}`} active={tab === "pending"}>
                Awaiting my decision
                {dashboard.pendingMyDecisionCount > 0 && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">{dashboard.pendingMyDecisionCount}</span>}
              </TabLink>
              <TabLink href={`/approvals${query({ tab: "mine" })}`} active={tab === "mine"}>
                Submitted by me
              </TabLink>
            </div>

            {tab === "all" && (
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/approvals${query({ status: undefined, module: undefined, tab: undefined })}`} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${!status && !moduleFilter ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"}`}>
                  Any status/module
                </Link>
                {STATUS_FILTERS.map((value) => (
                  <Link key={value} href={`/approvals${query({ status: value })}`} className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${status === value ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"}`}>
                    {APPROVAL_STATUS_LABELS[value] ?? value}
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {requests.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <ShieldCheck size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">Nothing here</p>
                <p className="mt-1 text-xs text-gray-400">No approval requests match this view.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Request</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Target</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Requested by</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Required role</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Submitted</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map((request) => (
                      <tr key={request.id} className="border-b border-gray-50">
                        <td className="whitespace-nowrap px-6 py-4">
                          <p className="text-xs font-semibold text-[#173D2E]">{APPROVAL_ACTION_TYPE_LABELS[request.actionType] ?? request.actionType}</p>
                          <p className="text-[10px] text-gray-400">{APPROVAL_MODULE_LABELS[request.module] ?? request.module}</p>
                        </td>
                        <td className="px-6 py-4 text-xs text-gray-600">
                          {request.quotation ? (
                            <>
                              {request.quotation.quotationNumber}
                              {request.quotation.revisionNumber > 1 && <span className="text-gray-400"> (rev {request.quotation.revisionNumber})</span>}
                              <p className="text-[10px] text-gray-400">{request.quotation.customerName}</p>
                            </>
                          ) : request.customerOrder ? (
                            request.customerOrder.reference
                          ) : (
                            "-"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{request.requestedBy.name}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{request.requiredApproverRole}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{new Date(request.submittedAt).toLocaleString()}</td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <div className="flex items-center gap-1.5">
                            <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold ${APPROVAL_STATUS_STYLES[request.status] ?? "bg-gray-100 text-gray-500"}`}>
                              {APPROVAL_STATUS_LABELS[request.status] ?? request.status}
                            </span>
                            {request.isOverdue && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                                <Clock size={10} />
                                Overdue
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <Link href={`/approvals/${request.id}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]">
                            Open
                            <ChevronRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function TabLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex items-center rounded-lg px-3 py-2 text-xs font-semibold transition ${
        active ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200 hover:bg-gray-50"
      }`}
    >
      {children}
    </Link>
  );
}

function Counter({ label, value, highlight, warn }: { label: string; value: string | number; highlight?: boolean; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${warn ? "border-red-200 bg-red-50/40" : highlight ? "border-amber-200 bg-amber-50/40" : "border-[#E8EBE6] bg-white"}`}>
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${warn ? "text-red-700" : highlight ? "text-amber-700" : "text-[#17251E]"}`}>{value}</p>
    </div>
  );
}
