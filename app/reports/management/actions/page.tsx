import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { MANAGEMENT_REPORT_CATALOGUE } from "@/lib/reporting/management-reports";
import { getManagementThresholds } from "@/lib/admin/settings-store";
import { getAllIntelligence, type AggregatedFinding } from "@/lib/management-intelligence/queries";
import { listAssignableUsers, listTrackedActions, type TrackedAction } from "@/lib/management-intelligence/actions";
import { actionKey, ACTION_STATUS_LABELS } from "@/lib/management-intelligence/action-state";
import { describeThresholds } from "@/lib/management-intelligence/thresholds";
import { PRIORITY_LABELS, RESPONSIBLE_FUNCTION_LABELS } from "@/lib/management-intelligence/types";
import Sidebar from "../../../components/sidebar";
import { EmptyState, PageHeader, SectionCard } from "../../_components/ui";
import { FindingCard, PRIORITY_BADGE } from "../_components/intelligence-section";

export const instant = false;

const REPORT_NAMES = new Map<string, string>(MANAGEMENT_REPORT_CATALOGUE.map((r) => [r.id, r.name]));
const OPERATIONAL_FUNCTIONS = new Set(["WAREHOUSE", "OPERATIONS", "PURCHASING"]);

type Assignee = { id: string; name: string; role: string };

function Group({ title, description, findings, tracked, assignees, empty }: { title: string; description: string; findings: AggregatedFinding[]; tracked: Map<string, TrackedAction>; assignees: Assignee[]; empty: string }) {
  return (
    <SectionCard title={`${title} (${findings.length})`} description={description}>
      {findings.length === 0 ? (
        <p className="p-4 text-sm text-[#718078]">{empty}</p>
      ) : (
        <div className="space-y-4">
          {findings.map((f) => (
            <div key={`${f.reportId}:${f.key}`}>
              <FindingCard finding={f} tracked={tracked.get(actionKey(f.reportId, f.key))} assignees={assignees} reportName={`${REPORT_NAMES.get(f.reportId) ?? f.reportId}${f.alsoRaisedIn.length > 0 ? `, also raised in ${f.alsoRaisedIn.map((r) => REPORT_NAMES.get(r) ?? r).join(", ")}` : ""}`} />
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/**
 * Management Action Centre. An aggregate of the findings the nine
 * management reports already produce, not a second analysis: each item
 * links back to its report. Manager and administrator only (page redirect
 * is a convenience; /api/management-actions enforces it server-side).
 */
export default async function ManagementActionCentrePage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "SALES_MANAGER" && user.role !== "ADMINISTRATOR") redirect("/reports");

  const thresholds = await getManagementThresholds();
  const [all, trackedList, assignees] = await Promise.all([getAllIntelligence(undefined, thresholds), listTrackedActions(), listAssignableUsers()]);
  const tracked = new Map(trackedList.map((t) => [t.findingKey, t]));
  const statusOf = (f: AggregatedFinding) => tracked.get(actionKey(f.reportId, f.key))?.status ?? "OPEN";

  const live = all.findings;
  const isActive = (f: AggregatedFinding) => !["COMPLETED", "DISMISSED"].includes(statusOf(f));
  const open = live.filter(isActive);

  const critical = open.filter((f) => f.priority === "CRITICAL");
  const used = new Set(critical.map((f) => `${f.reportId}:${f.key}`));
  const take = (predicate: (f: AggregatedFinding) => boolean) => {
    const picked = open.filter((f) => !used.has(`${f.reportId}:${f.key}`) && predicate(f));
    for (const f of picked) used.add(`${f.reportId}:${f.key}`);
    return picked;
  };
  const operationalHigh = take((f) => f.priority === "HIGH" && OPERATIONAL_FUNCTIONS.has(f.responsibleFunction));
  const financial = take((f) => f.tag === "financial" || f.responsibleFunction === "FINANCE");
  const shortages = take((f) => f.tag === "shortage");
  const rejections = take((f) => f.tag === "product-rejection");
  const customers = take((f) => f.tag === "customer");
  const remaining = take(() => true);

  const awaiting = open.filter((f) => statusOf(f) === "OPEN");
  const closedTracked = trackedList.filter((t) => t.status !== "OPEN");
  const liveKeys = new Set(live.map((f) => actionKey(f.reportId, f.key)));

  const counts = { total: open.length, critical: open.filter((f) => f.priority === "CRITICAL").length, awaiting: awaiting.length, inProgress: open.filter((f) => statusOf(f) === "IN_PROGRESS").length };

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen md:pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Reports / Management Reports / Action Centre</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Management Action Centre</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Reports / Management Reports / Action Centre"
            title="Management Action Centre"
            description="What needs a decision now, drawn from the nine management reports over their default period. Each finding shows the evidence, who should act, how urgent it is and how to tell it worked."
            actions={
              <Link href="/reports/management" className="text-sm font-semibold text-[#718078] hover:text-[#17251E]">
                &larr; All management reports
              </Link>
            }
          />

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            {[
              ["Active findings", counts.total],
              ["Critical", counts.critical],
              ["Not yet acknowledged", counts.awaiting],
              ["In progress", counts.inProgress],
            ].map(([label, value]) => (
              <div key={label as string} className="rounded-2xl border border-[#E7ECE7] bg-white p-4">
                <p className="text-xs font-semibold text-[#718078]">{label}</p>
                <p className="mt-1 text-2xl font-bold text-[#17251E]">{value}</p>
              </div>
            ))}
          </div>

          {live.length === 0 && all.insufficientEvidence.length === 0 && (
            <SectionCard title="No action indicated" description="None of the nine reports shows a figure that crosses a rule parameter right now."><EmptyState message="Nothing needs a decision at the moment." /></SectionCard>
          )}

          <Group title="Critical actions" description="Act today." findings={critical} tracked={tracked} assignees={assignees} empty="No critical findings." />
          <Group title="High-priority operational problems" description="Warehouse, purchasing and operations issues that need action within three working days." findings={operationalHigh} tracked={tracked} assignees={assignees} empty="No high-priority operational findings." />
          <Group title="Financial exposure" description="Money tied up in claims, credits and unpriced records." findings={financial} tracked={tracked} assignees={assignees} empty="No financial findings." />
          <Group title="Repeated shortages" description="Products that keep running short at picking or supply." findings={shortages} tracked={tracked} assignees={assignees} empty="No repeated shortages." />
          <Group title="Recurring product rejection" description="Rejections and claim reasons that repeat." findings={rejections} tracked={tracked} assignees={assignees} empty="No recurring rejection patterns." />
          <Group title="Recurring customer failures" description="Customers who keep being short-supplied, rejecting deliveries, claiming or not being told." findings={customers} tracked={tracked} assignees={assignees} empty="No customer-level patterns." />
          {remaining.length > 0 && <Group title="Other findings" description="Commercial and process findings." findings={remaining} tracked={tracked} assignees={assignees} empty="" />}

          <SectionCard title={`Previously acted on (${closedTracked.length})`} description="Actions that have been acknowledged, assigned, completed or dismissed, with the position when they were first acted on. A finding that is no longer detected is noted below as an observation; it is never marked completed automatically.">
            {closedTracked.length === 0 ? (
              <p className="p-4 text-sm text-[#718078]">No action has been taken yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-gray-500">
                      <th className="py-2 pr-4">Action</th>
                      <th className="py-2 pr-4">Priority</th>
                      <th className="py-2 pr-4">Function</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Owner</th>
                      <th className="py-2 pr-4">Outcome or note</th>
                      <th className="py-2">Position now</th>
                    </tr>
                  </thead>
                  <tbody>
                    {closedTracked.map((t) => (
                      <tr key={t.id} className="border-b border-[#EEF1ED] align-top">
                        <td className="py-2 pr-4 font-medium">
                          <Link className="underline" href={`/reports/management/${t.reportId}`}>
                            {t.title}
                          </Link>
                          <div className="mt-1 text-[11px] font-normal text-[#718078]">{t.evidence.map((e) => `${e.label}: ${e.value}`).join(" · ")}</div>
                        </td>
                        <td className="py-2 pr-4">
                          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_BADGE[t.priority as keyof typeof PRIORITY_BADGE] ?? ""}`}>{PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS] ?? t.priority}</span>
                        </td>
                        <td className="py-2 pr-4">{RESPONSIBLE_FUNCTION_LABELS[t.responsibleFunction as keyof typeof RESPONSIBLE_FUNCTION_LABELS] ?? t.responsibleFunction}</td>
                        <td className="py-2 pr-4">{ACTION_STATUS_LABELS[t.status]}</td>
                        <td className="py-2 pr-4">{t.assignedToName ?? "Unassigned"}</td>
                        <td className="py-2 pr-4 text-xs">{t.statusNote ?? "—"}</td>
                        <td className="py-2 text-xs text-[#52605A]">{liveKeys.has(t.findingKey) ? "Still detected in current data" : "No longer detected in current data (observation, not a completion)"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>

          {all.insufficientEvidence.length > 0 && (
            <SectionCard title="Insufficient evidence" description="Reports where the data is too thin to support a recommendation. No advice is given on these points.">
              <ul className="space-y-3 text-sm">
                {all.insufficientEvidence.map((i) => (
                  <li key={i.reportId}>
                    <p className="font-semibold">{REPORT_NAMES.get(i.reportId) ?? i.reportId}</p>
                    <ul className="list-disc pl-5 text-xs text-[#52605A]">
                      {i.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          <details className="rounded-2xl border border-[#E7ECE7] bg-white p-4 text-xs text-[#52605A]">
            <summary className="cursor-pointer font-semibold">Rule parameters used (flags for review, not targets)</summary>
            <ul className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 md:grid-cols-2">
              {describeThresholds(thresholds).map((t) => (
                <li key={t.label}>
                  {t.label}: <span className="font-semibold">{t.value}</span>
                </li>
              ))}
            </ul>
          </details>
        </div>
      </main>
    </div>
  );
}
