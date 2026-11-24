import Link from "next/link";
import { listAdminOrders } from "@/lib/admin/order-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { EmptyState, PageHeader, Pagination, SectionCard } from "../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../_components/admin-shell";
import { ActionDialog } from "../_components/action-dialog";
import { StatusBadge, userOptions } from "../_components/status-badge";

export const instant = false;
const STATUSES = ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING", "READY_TO_INVOICE", "REJECTED", "CANCELLED"];
const CANCELLABLE = new Set(["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED"]);
const REASSIGNABLE = new Set([...CANCELLABLE, "PICKING"]);

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const filters = { q: one(raw.q), status: one(raw.status), salespersonId: one(raw.owner), unassigned: one(raw.owner) === "none" };
  if (filters.unassigned) filters.salespersonId = undefined;
  const { page, pageSize } = readPaging({ page: one(raw.page), pageSize: one(raw.pageSize) });
  const [{ total, rows }, assignees] = await Promise.all([listAdminOrders(filters, page, pageSize), listActiveAssignees()]);
  return (
    <AdminShell active="/admin/orders">
      <PageHeader breadcrumb="Workspace / Administration / Orders" title="Orders" description="Find, correct, reassign, cancel and reopen orders. The server refuses changes to orders that are picking, handed to SAP or invoiced. Orders are cancelled, never deleted, so history stays intact." actions={<Link href="/orders/new" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">New order</Link>} />
      <form action="/admin/orders" className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
        <input name="q" defaultValue={filters.q ?? ""} placeholder="Reference, PO or customer" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <select name="status" defaultValue={filters.status ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
        <select name="owner" defaultValue={one(raw.owner) ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any salesperson</option><option value="none">Unassigned</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Filter</button>
      </form>
      <SectionCard title={`Orders (${total})`}>
        {rows.length === 0 ? <EmptyState message="No orders match these filters." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Reference</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Salesperson</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2">Actions</th></tr></thead>
            <tbody>{rows.map((o) => (
              <tr key={o.id} className="border-t border-[#EEF1ED]">
                <td className="px-4 py-2 font-medium"><Link href={`/admin/orders/${o.id}`} className="text-[#1F7A4D] hover:underline">{o.reference}</Link>{o.customerPoReference ? <div className="text-xs text-[#849087]">PO {o.customerPoReference}</div> : null}</td>
                <td className="px-4 py-2">{o.customer.name}</td>
                <td className="px-4 py-2"><StatusBadge status={o.status} /></td>
                <td className="px-4 py-2">{o.salesperson?.name ?? <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Unassigned</span>}</td>
                <td className="px-4 py-2 text-right">{o.total === null ? "—" : `${o.currency} ${o.total}`}</td>
                <td className="px-4 py-2"><div className="flex flex-wrap gap-2">
                  <Link href={`/admin/orders/${o.id}`} className="rounded-lg border border-[#DDE3DC] px-3 py-1.5 text-xs font-semibold">Manage</Link>
                  {REASSIGNABLE.has(o.status) ? <ActionDialog label="Reassign" title={`Reassign ${o.reference}`} endpoint="/api/admin/assignments/reassign" payload={{ entityType: "ORDER", ids: [o.id], confirm: true }} confirmLabel="Reassign" fields={[{ name: "toUserId", label: "New salesperson", type: "select", options: userOptions(assignees), required: true }]} /> : null}
                  {CANCELLABLE.has(o.status) ? <ActionDialog label="Cancel" variant="danger" destructive title={`Cancel ${o.reference}?`} description="The order is kept and marked cancelled. Blocked if picking, SAP hand-over, invoicing or a pending approval exists." endpoint={`/api/admin/orders/${o.id}/cancel`} confirmLabel="Cancel order" /> : null}
                </div></td>
              </tr>))}</tbody>
          </table></div>
        )}
        <Pagination basePath="/admin/orders" searchParams={{ q: filters.q, status: filters.status, owner: one(raw.owner) }} page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} />
      </SectionCard>
    </AdminShell>
  );
}
