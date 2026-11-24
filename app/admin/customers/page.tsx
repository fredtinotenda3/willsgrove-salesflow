import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { listActiveAssignees, listAssignableWork } from "@/lib/admin/assignment-queries";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { EmptyState, PageHeader, Pagination, SectionCard } from "../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../_components/admin-shell";
import { DownloadButton } from "../_components/download-button";
import { ReassignPanel } from "../_components/reassign-panel";
import { ActionDialog, type DialogField } from "../_components/action-dialog";
import { StatusBadge } from "../_components/status-badge";

export const instant = false;

/** Account-manager ownership of customers. Editing a customer's own details stays on the existing customer page. */
const customerFields = (c?: { name: string; sapCustomerCode: string | null; email: string | null; phone: string | null; category: string | null; notes: string | null }): DialogField[] => [
  { name: "name", label: "Customer name", type: "text", required: true, defaultValue: c?.name },
  { name: "sapCustomerCode", label: "SAP customer code", type: "text", defaultValue: c?.sapCustomerCode ?? "" },
  { name: "email", label: "Email", type: "text", defaultValue: c?.email ?? "" },
  { name: "phone", label: "Phone", type: "text", defaultValue: c?.phone ?? "" },
  { name: "category", label: "Category", type: "text", defaultValue: c?.category ?? "" },
  { name: "notes", label: "Notes", type: "textarea", defaultValue: c?.notes ?? "" },
];

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const scope = one(raw.scope) === "unassigned" ? "unassigned" : "all-open";
  const ownerId = one(raw.owner);
  const q = one(raw.q);
  const { page, pageSize } = readPaging({ page: one(raw.page), pageSize: one(raw.pageSize) });
  const [work, assignees, inactive] = await Promise.all([listAssignableWork({ type: "CUSTOMER", scope, ownerId, q, stuckDays: 0, page, pageSize }), listActiveAssignees(), prisma.customer.count({ where: { status: "INACTIVE" } })]);
  const rows = work.rows.map((r) => ({ id: r.id, label: r.label, detail: r.detail, ownerName: r.owner?.name ?? null, status: r.status, ageDays: r.ageDays, href: r.href }));
  const details = await prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, name: true, sapCustomerCode: true, email: true, phone: true, category: true, notes: true, status: true } });
  const actions = Object.fromEntries(details.map((c) => [c.id, (
    <>
      <ActionDialog label="Edit" title={`Edit ${c.name}`} endpoint={`/api/customers/${c.id}`} method="PATCH" askReason={false} confirmLabel="Save" fields={customerFields(c)} />
      <ActionDialog label="Deactivate" variant="danger" destructive title={`Deactivate ${c.name}?`} description="Hidden from new orders and quotations. Orders, quotations, invoices and claims are kept. Customers are never deleted." endpoint={`/api/customers/${c.id}`} method="PATCH" payload={{ status: "INACTIVE" }} askReason={false} confirmLabel="Deactivate" />
    </>
  )]));
  const inactiveRows = await prisma.customer.findMany({ where: { status: "INACTIVE", ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) }, orderBy: { name: "asc" }, take: 25, select: { id: true, name: true, sapCustomerCode: true } });
  return (
    <AdminShell active="/admin/customers">
      <PageHeader breadcrumb="Workspace / Administration / Customers" title="Customers & account managers" description={`Assign the salesperson responsible for each active customer. ${inactive} inactive customer(s) are excluded. Customer details, contacts, locations, orders and claims are on each customer's page.`} actions={<div className="flex gap-2"><ActionDialog label="Add customer" variant="primary" title="Add customer" description="Locations and contacts are added on the customer page afterwards." endpoint="/api/customers" askReason={false} blank="omit" confirmLabel="Create customer" successHref="/customers/{id}" fields={customerFields()} /><DownloadButton href="/api/admin/customers/export">Export CSV</DownloadButton><Link href="/customers/master-import" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Import customers</Link><Link href="/customers" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Customer register</Link></div>} />
      <form action="/admin/customers" className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
        <input name="q" defaultValue={q ?? ""} placeholder="Name or SAP code" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <select name="scope" defaultValue={scope} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="all-open">All active</option><option value="unassigned">No account manager</option></select>
        <select name="owner" defaultValue={ownerId ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any manager</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Filter</button>
      </form>
      <SectionCard title={`Active customers (${work.total})`}>
        {rows.length === 0 ? <EmptyState message="No customers match." /> : <ReassignPanel entityType="CUSTOMER" rows={rows} rowActions={actions} assignees={assignees.map((a) => ({ id: a.id, name: a.name, role: a.role }))} />}
        <Pagination basePath="/admin/customers" searchParams={{ q, scope, owner: ownerId }} page={page} totalPages={Math.max(1, Math.ceil(work.total / pageSize))} totalItems={work.total} pageSize={pageSize} />
      </SectionCard>
      {inactiveRows.length > 0 ? (
        <SectionCard title="Inactive customers" description="Reactivate to use them on new orders and quotations again.">
          <ul className="divide-y divide-[#EEF1ED] text-sm">{inactiveRows.map((c) => <li key={c.id} className="flex items-center justify-between px-4 py-2"><span><StatusBadge status="INACTIVE" /> <Link href={`/customers/${c.id}`} className="ml-2 text-[#1F7A4D]">{c.name}</Link> <span className="text-xs text-[#849087]">{c.sapCustomerCode ?? ""}</span></span><ActionDialog label="Reactivate" variant="primary" title={`Reactivate ${c.name}?`} endpoint={`/api/customers/${c.id}`} method="PATCH" payload={{ status: "ACTIVE" }} askReason={false} confirmLabel="Reactivate" /></li>)}</ul>
        </SectionCard>
      ) : null}
    </AdminShell>
  );
}
