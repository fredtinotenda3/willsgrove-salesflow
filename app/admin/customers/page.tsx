import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listActiveAssignees, listAssignableWork } from "@/lib/admin/assignment-queries";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { EmptyState, PageHeader, Pagination, SectionCard } from "../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../_components/admin-shell";
import { DownloadButton } from "../_components/download-button";
import { ReassignPanel } from "../_components/reassign-panel";

export const instant = false;

/** Account-manager ownership of customers. Editing a customer's own details stays on the existing customer page. */
export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const scope = one(raw.scope) === "unassigned" ? "unassigned" : "all-open";
  const ownerId = one(raw.owner);
  const q = one(raw.q);
  const { page, pageSize } = readPaging({ page: one(raw.page), pageSize: one(raw.pageSize) });
  const [work, assignees, inactive] = await Promise.all([listAssignableWork({ type: "CUSTOMER", scope, ownerId, q, stuckDays: 0, page, pageSize }), listActiveAssignees(), prisma.customer.count({ where: { status: "INACTIVE" } })]);
  const rows = work.rows.map((r) => ({ id: r.id, label: r.label, detail: r.detail, ownerName: r.owner?.name ?? null, status: r.status, ageDays: r.ageDays, href: r.href }));
  return (
    <AdminShell active="/admin/customers">
      <PageHeader breadcrumb="Workspace / Administration / Customers" title="Customers & account managers" description={`Assign the salesperson responsible for each active customer. ${inactive} inactive customer(s) are excluded. Customer details, contacts, locations, orders and claims are on each customer's page.`} actions={<div className="flex gap-2"><DownloadButton href="/api/admin/customers/export">Export CSV</DownloadButton><Link href="/customers/master-import" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Import customers</Link><Link href="/customers" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Customer register</Link></div>} />
      <form action="/admin/customers" className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
        <input name="q" defaultValue={q ?? ""} placeholder="Name or SAP code" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <select name="scope" defaultValue={scope} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="all-open">All active</option><option value="unassigned">No account manager</option></select>
        <select name="owner" defaultValue={ownerId ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any manager</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Filter</button>
      </form>
      <SectionCard title={`Active customers (${work.total})`}>
        {rows.length === 0 ? <EmptyState message="No customers match." /> : <ReassignPanel entityType="CUSTOMER" rows={rows} assignees={assignees.map((a) => ({ id: a.id, name: a.name, role: a.role }))} />}
        <Pagination basePath="/admin/customers" searchParams={{ q, scope, owner: ownerId }} page={page} totalPages={Math.max(1, Math.ceil(work.total / pageSize))} totalItems={work.total} pageSize={pageSize} />
      </SectionCard>
    </AdminShell>
  );
}
