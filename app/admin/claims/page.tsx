import Link from "next/link";
import { listAdminClaims } from "@/lib/admin/order-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { EmptyState, PageHeader, Pagination, SectionCard } from "../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../_components/admin-shell";
import { ActionDialog } from "../_components/action-dialog";
import { StatusBadge, userOptions } from "../_components/status-badge";

export const instant = false;
const STATUSES = ["OPEN", "UNDER_INVESTIGATION", "AWAITING_CUSTOMER", "AWAITING_INTERNAL_ACTION", "APPROVED", "PARTIALLY_RESOLVED", "RESOLVED", "REJECTED", "CLOSED"];
const CONCLUDED = new Set(["RESOLVED", "REJECTED", "CLOSED"]);

export default async function AdminClaimsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const owner = one(raw.owner);
  const filters = { q: one(raw.q), status: one(raw.status), assigneeId: owner && owner !== "none" ? owner : undefined, unassigned: owner === "none" };
  const { page, pageSize } = readPaging({ page: one(raw.page), pageSize: one(raw.pageSize) });
  const [{ total, rows }, assignees] = await Promise.all([listAdminClaims(filters, page, pageSize), listActiveAssignees()]);
  return (
    <AdminShell active="/admin/claims">
      <PageHeader breadcrumb="Workspace / Administration / Claims" title="Invoice claims" description="Ownership of claims. Investigation, resolution, credit notes and returns follow the existing claim workflow on each claim; concluded claims keep their owner." actions={<Link href="/invoice-claims/new" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">New claim</Link>} />
      <form action="/admin/claims" className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
        <input name="q" defaultValue={filters.q ?? ""} placeholder="Reference or customer" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <select name="status" defaultValue={filters.status ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
        <select name="owner" defaultValue={owner ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any owner</option><option value="none">Unassigned</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Filter</button>
      </form>
      <SectionCard title={`Claims (${total})`}>
        {rows.length === 0 ? <EmptyState message="No claims match these filters." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Reference</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Owner</th><th className="px-4 py-2">Raised</th><th className="px-4 py-2">Actions</th></tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className="border-t border-[#EEF1ED]">
                <td className="px-4 py-2 font-medium"><Link href={`/invoice-claims/${c.id}`} className="text-[#1F7A4D] hover:underline">{c.claimReference}</Link></td>
                <td className="px-4 py-2">{c.customer.name}</td>
                <td className="px-4 py-2"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-2">{c.assignedTo?.name ?? <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Unassigned</span>}</td>
                <td className="px-4 py-2 text-xs">{c.createdAt.toISOString().slice(0, 10)}</td>
                <td className="px-4 py-2"><div className="flex gap-2">
                  <Link href={`/invoice-claims/${c.id}`} className="rounded-lg border border-[#DDE3DC] px-3 py-1.5 text-xs font-semibold">Open</Link>
                  {!CONCLUDED.has(c.status) ? <ActionDialog label="Assign" title={`Assign ${c.claimReference}`} endpoint="/api/admin/assignments/reassign" payload={{ entityType: "CLAIM", ids: [c.id], confirm: true }} confirmLabel="Assign" fields={[{ name: "toUserId", label: "Owner", type: "select", options: userOptions(assignees), required: true }]} /> : null}
                </div></td>
              </tr>))}</tbody>
          </table></div>
        )}
        <Pagination basePath="/admin/claims" searchParams={{ q: filters.q, status: filters.status, owner }} page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} />
      </SectionCard>
    </AdminShell>
  );
}
