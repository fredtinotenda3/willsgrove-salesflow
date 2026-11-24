import Link from "next/link";
import { listActiveAssignees, listAssignableWork, type AssignmentScope } from "@/lib/admin/assignment-queries";
import { getSettingValues } from "@/lib/admin/settings-store";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { EmptyState, PageHeader, Pagination, SectionCard } from "../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../_components/admin-shell";
import { ReassignPanel } from "../_components/reassign-panel";
import type { ReassignEntityType } from "@/lib/admin/validation";

export const instant = false;

const TYPES: { id: ReassignEntityType; label: string }[] = [
  { id: "ORDER", label: "Orders" }, { id: "QUOTATION", label: "Quotations" }, { id: "CUSTOMER", label: "Customers" }, { id: "CLAIM", label: "Claims" }, { id: "MANAGEMENT_ACTION", label: "Management actions" },
];
const SCOPES: { id: AssignmentScope; label: string }[] = [{ id: "unassigned", label: "Unassigned" }, { id: "stuck", label: "Stuck / idle" }, { id: "all-open", label: "All open" }];

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function AdminAssignmentsPage({ searchParams }: { searchParams: SP }) {
  await requireAdminPage();
  const raw = await searchParams;
  const type = (TYPES.find((t) => t.id === one(raw.type))?.id ?? "ORDER") as ReassignEntityType;
  const scope = (SCOPES.find((s) => s.id === one(raw.scope))?.id ?? "unassigned") as AssignmentScope;
  const ownerId = one(raw.owner) || undefined;
  const q = one(raw.q) || undefined;
  const settings = await getSettingValues();
  const { page, pageSize } = readPaging({ page: one(raw.page), pageSize: one(raw.pageSize) });
  const [work, assignees] = await Promise.all([listAssignableWork({ type, scope, ownerId, q, stuckDays: settings["admin.stuckOrderDays"], page, pageSize }), listActiveAssignees()]);
  const rows = work.rows.map((r) => ({ id: r.id, label: r.label, detail: r.detail, ownerName: r.owner?.name ?? null, status: r.status, ageDays: r.ageDays, href: r.href }));
  const qs = (patch: Record<string, string | undefined>) => { const p = new URLSearchParams({ type, scope, ...(ownerId ? { owner: ownerId } : {}), ...(q ? { q } : {}) }); for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); } p.delete("page"); return `/admin/assignments?${p.toString()}`; };
  const totalPages = Math.max(1, Math.ceil(work.total / pageSize));
  const base: Record<string, string | undefined> = { type, scope, owner: ownerId, q };

  return (
    <AdminShell active="/admin/assignments">
      <PageHeader breadcrumb="Workspace / Administration / Assignments" title="Assignment management" description="Find unassigned or idle work and move it to an active user. Every change is previewed first and recorded in the audit log with the reason." />
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Work type">
        {TYPES.map((t) => <Link key={t.id} href={qs({ type: t.id, scope: t.id === "QUOTATION" && scope === "unassigned" ? "all-open" : scope })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${t.id === type ? "bg-[#1F7A4D] text-white" : "border border-[#DDE3DC] bg-white"}`}>{t.label}</Link>)}
      </div>
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4" action="/admin/assignments">
        <input type="hidden" name="type" value={type} />
        <label className="text-xs font-semibold text-[#4B5B52]">Scope
          <select name="scope" defaultValue={scope} className="mt-1 block rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal">{SCOPES.filter((s) => !(type === "QUOTATION" && s.id === "unassigned")).map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
        </label>
        <label className="text-xs font-semibold text-[#4B5B52]">Current owner
          <select name="owner" defaultValue={ownerId ?? ""} className="mt-1 block rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal"><option value="">Anyone</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        </label>
        <label className="text-xs font-semibold text-[#4B5B52]">Search
          <input name="q" defaultValue={q ?? ""} placeholder="Reference or customer" className="mt-1 block rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal" />
        </label>
        <button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Apply</button>
      </form>
      <SectionCard title={`${TYPES.find((t) => t.id === type)?.label} (${work.total})`} description={scope === "stuck" ? `Idle for ${settings["admin.stuckOrderDays"]}+ days (Configuration).` : "Open, reassignable records only. Invoiced, closed and converted records keep their owner."}>
        {rows.length === 0 ? <EmptyState message="Nothing matches. Unassigned work is clear for this selection." /> : <ReassignPanel entityType={type} rows={rows} assignees={assignees.map((a) => ({ id: a.id, name: a.name, role: a.role }))} />}
        {work.total > 0 ? <Pagination basePath="/admin/assignments" searchParams={base} page={page} totalPages={totalPages} totalItems={work.total} pageSize={pageSize} /> : null}
      </SectionCard>
    </AdminShell>
  );
}
