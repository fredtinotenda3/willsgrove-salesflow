import { auditFilterOptions, listAuditEvents } from "@/lib/admin/audit-queries";
import { parseAuditFilters } from "@/lib/admin/audit-filters";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { PageHeader, Panel as SectionCard } from "../_components/ui";
import { EmptyState, Pagination } from "../../reports/_components/ui";
import { DownloadButton } from "../_components/download-button";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;

/** Read-only. Nothing in the application can edit or delete an audit event. */
export default async function AdminAuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, one(v)]));
  const filters = parseAuditFilters(flat);
  const { page, pageSize } = readPaging({ page: flat.page, pageSize: flat.pageSize });
  const [{ total, rows }, options] = await Promise.all([listAuditEvents(filters, page, pageSize), auditFilterOptions()]);
  const sp = { q: flat.q, actor: flat.actor, entity: flat.entity, action: flat.action, from: flat.from, to: flat.to };
  const exportHref = `/api/admin/audit/export?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()}`;
  return (
    <div className="space-y-4">
      <PageHeader title="Audit log" description="Who changed what, when, with before and after values and the stated reason. Read-only." actions={<DownloadButton href={exportHref}>Export CSV (max 5,000)</DownloadButton>} />
      <form action="/admin/audit" className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
        <input name="q" defaultValue={flat.q ?? ""} placeholder="Record id, action or person" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <select name="actor" defaultValue={flat.actor ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Anyone</option>{options.actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select name="entity" defaultValue={flat.entity ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any record type</option>{options.entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}</select>
        <input name="action" defaultValue={flat.action ?? ""} placeholder="Action contains…" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <label className="text-xs font-semibold text-[#4B5B52]">From<input type="date" name="from" defaultValue={flat.from ?? ""} className="mt-1 block rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal" /></label>
        <label className="text-xs font-semibold text-[#4B5B52]">To<input type="date" name="to" defaultValue={flat.to ?? ""} className="mt-1 block rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal" /></label>
        <button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Filter</button>
      </form>
      <SectionCard title={`Events (${total})`}>
        {rows.length === 0 ? <EmptyState message="No audit events match these filters." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Time (UTC)</th><th className="px-4 py-2">Actor</th><th className="px-4 py-2">Action</th><th className="px-4 py-2">Record</th><th className="px-4 py-2">Change</th></tr></thead>
            <tbody>{rows.map((e) => (
              <tr key={e.id} className="border-t border-[#EEF1ED] align-top">
                <td className="whitespace-nowrap px-4 py-2 text-xs">{e.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td>
                <td className="px-4 py-2">{e.actor?.name ?? <span className="text-[#849087]">System</span>}</td>
                <td className="px-4 py-2 text-xs font-semibold">{e.action}</td>
                <td className="px-4 py-2 text-xs">{e.entityType}<div className="font-mono text-[10px] text-[#849087]">{e.entityId}</div></td>
                <td className="max-w-md px-4 py-2 text-[11px] text-[#5F6F66]"><details><summary className="cursor-pointer">Before / after</summary><pre className="mt-1 whitespace-pre-wrap">{JSON.stringify({ before: e.beforeData, after: e.afterData }, null, 1)}</pre></details></td>
              </tr>))}</tbody>
          </table></div>
        )}
        <Pagination basePath="/admin/audit" searchParams={sp} page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} />
      </SectionCard>
    </div>
  );
}
