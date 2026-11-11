import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getSapDashboardSummary } from "@/lib/integrations/sap/queries";
import { JOB_TYPE_LABELS, ERROR_CATEGORY_LABELS, formatLastSyncAt, mockModeBannerText } from "@/lib/integrations/sap/display";
import Sidebar from "../../components/sidebar";
import SapOperationsPanel from "./sap-operations-panel";
import { AlertTriangle, Settings2 } from "lucide-react";

/**
 * Milestone 9 (SAP Business One Integration). The dashboard spec section
 * 13 asks for: connection/mode status, last-synced-at per data type,
 * recent sync job history, and the operations that need a human
 * (FAILED/UNCERTAIN) with their retry/reconcile/resolve actions --
 * everything here is read live from getSapDashboardSummary (lib/
 * integrations/sap/queries.ts), never a cached/stored "current status."
 */
export const instant = false;

export default async function SapIntegrationPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMINISTRATOR" && user.role !== "SALES_MANAGER") redirect("/");

  const summary = await getSapDashboardSummary();
  const bannerText = mockModeBannerText(summary.isMockMode);
  const isAdmin = user.role === "ADMINISTRATOR";

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Integrations / SAP Business One</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">SAP Business One</h2>
          </div>
          {isAdmin && (
            <Link
              href="/integrations/sap/settings"
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              <Settings2 size={14} />
              Connection settings
            </Link>
          )}
        </header>

        <div className="space-y-6 p-8">
          {bannerText && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" />
              <p>{bannerText}</p>
            </div>
          )}

          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Integration status</h1>
            <p className="mt-1 text-sm text-gray-500">
              Product/customer master data and SAP invoices/credit notes sync inbound into SalesFlow; approved orders
              submit outbound as SAP sales orders. Every number below is read live, never cached.
            </p>
          </section>

          <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Counter label="Pending" value={summary.operationCounts.PENDING} />
            <Counter label="Processing" value={summary.operationCounts.PROCESSING} />
            <Counter label="Synced" value={summary.operationCounts.SUCCEEDED} />
            <Counter label="Failed" value={summary.operationCounts.FAILED} warn={summary.operationCounts.FAILED > 0} />
            <Counter label="Requires review" value={summary.operationCounts.UNCERTAIN} warn={summary.operationCounts.UNCERTAIN > 0} />
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-[#E8EBE6] px-5 py-3">
              <h2 className="text-sm font-bold text-[#17251E]">Last successful sync</h2>
            </div>
            <div className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
              {(["PRODUCT_IMPORT", "CUSTOMER_IMPORT", "INVOICE_IMPORT", "CREDIT_NOTE_IMPORT"] as const).map((jobType) => (
                <div key={jobType}>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{JOB_TYPE_LABELS[jobType]}</p>
                  <p className="mt-1 text-sm text-[#17251E]">{formatLastSyncAt(summary.lastCompletedSyncAt[jobType])}</p>
                </div>
              ))}
            </div>
            {isAdmin && (
              <div className="border-t border-[#E8EBE6] px-5 py-4">
                <SapOperationsPanel mode="trigger-sync" />
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-[#E8EBE6] px-5 py-3">
              <h2 className="text-sm font-bold text-[#17251E]">Needs attention</h2>
              <p className="text-xs text-gray-400">Sales-order submissions that failed, or whose outcome could not be confirmed.</p>
            </div>
            {summary.attentionNeeded.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-gray-400">Nothing needs attention right now.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E8EBE6] text-[11px] uppercase tracking-wider text-gray-400">
                      <th className="px-5 py-2 font-medium">Order</th>
                      <th className="px-5 py-2 font-medium">Customer</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                      <th className="px-5 py-2 font-medium">Issue</th>
                      <th className="px-5 py-2 font-medium">Attempts</th>
                      <th className="px-5 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8EBE6]">
                    {summary.attentionNeeded.map((op) => (
                      <tr key={op.id}>
                        <td className="px-5 py-3 font-semibold text-[#17251E]">{op.orderReference}</td>
                        <td className="px-5 py-3 text-gray-600">{op.customerName}</td>
                        <td className="px-5 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${op.status === "UNCERTAIN" ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}>
                            {op.status === "UNCERTAIN" ? "Requires review" : "Failed"}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-gray-500">
                          {op.lastErrorCategory ? ERROR_CATEGORY_LABELS[op.lastErrorCategory] ?? op.lastErrorCategory : "-"}
                          {op.lastErrorMessage && <p className="mt-0.5 text-[11px] text-gray-400">{op.lastErrorMessage}</p>}
                        </td>
                        <td className="px-5 py-3 text-gray-500">{op.attemptCount}</td>
                        <td className="px-5 py-3">
                          <SapOperationsPanel mode="operation-actions" operationId={op.id} status={op.status} canResolve={isAdmin} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-[#E8EBE6] px-5 py-3">
              <h2 className="text-sm font-bold text-[#17251E]">Recent sync jobs</h2>
            </div>
            {summary.recentJobs.length === 0 ? (
              <div className="px-6 py-10 text-center text-sm text-gray-400">No sync jobs have run yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-[#E8EBE6] text-[11px] uppercase tracking-wider text-gray-400">
                      <th className="px-5 py-2 font-medium">Type</th>
                      <th className="px-5 py-2 font-medium">Trigger</th>
                      <th className="px-5 py-2 font-medium">Status</th>
                      <th className="px-5 py-2 font-medium">Started</th>
                      <th className="px-5 py-2 font-medium">Completed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#E8EBE6]">
                    {summary.recentJobs.map((job) => (
                      <tr key={job.id}>
                        <td className="px-5 py-3 font-semibold text-[#17251E]">{JOB_TYPE_LABELS[job.jobType] ?? job.jobType}</td>
                        <td className="px-5 py-3 text-gray-500">
                          {job.trigger === "MANUAL" ? `Manual${job.triggeredByName ? ` (${job.triggeredByName})` : ""}` : "Scheduled"}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              job.status === "COMPLETED"
                                ? "bg-emerald-100 text-emerald-700"
                                : job.status === "FAILED"
                                  ? "bg-red-100 text-red-700"
                                  : job.status === "PARTIAL"
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            {job.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-gray-500">{job.startedAt ? new Date(job.startedAt).toLocaleString() : "-"}</td>
                        <td className="px-5 py-3 text-gray-500">{job.completedAt ? new Date(job.completedAt).toLocaleString() : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Counter({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${warn ? "border-red-200 bg-red-50/40" : "border-[#E8EBE6] bg-white"}`}>
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${warn ? "text-red-700" : "text-[#17251E]"}`}>{value}</p>
    </div>
  );
}
