import Link from "next/link";
import { listAdminQuotations } from "@/lib/admin/order-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { firstParam as one, readPaging } from "@/lib/admin/paging";
import { EmptyState, PageHeader, Pagination, SectionCard } from "../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../_components/admin-shell";
import { ActionDialog } from "../_components/action-dialog";
import { StatusBadge, userOptions } from "../_components/status-badge";

export const instant = false;
const STATUSES = ["DRAFT", "ISSUED", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"];

export default async function AdminQuotationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const raw = await searchParams;
  const filters = { q: one(raw.q), status: one(raw.status), salespersonId: one(raw.owner) };
  const { page, pageSize } = readPaging({ page: one(raw.page), pageSize: one(raw.pageSize) });
  const [{ total, rows }, assignees] = await Promise.all([listAdminQuotations(filters, page, pageSize), listActiveAssignees()]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <AdminShell active="/admin/quotations">
      <PageHeader breadcrumb="Workspace / Administration / Quotations" title="Quotations" description="Current revisions only. Create, edit drafts and revise on the quotation screens; assign, cancel with a reason and expire here. Converted quotations keep their order link." actions={<Link href="/quotations/new" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">New quotation</Link>} />
      <form action="/admin/quotations" className="flex flex-wrap items-end gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
        <input name="q" defaultValue={filters.q ?? ""} placeholder="Number or customer" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
        <select name="status" defaultValue={filters.status ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any status</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <select name="owner" defaultValue={filters.salespersonId ?? ""} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Any salesperson</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <button className="rounded-lg bg-[#17251E] px-4 py-2 text-sm font-semibold text-white">Filter</button>
      </form>
      <SectionCard title={`Quotations (${total})`}>
        {rows.length === 0 ? <EmptyState message="No quotations match these filters." /> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr><th className="px-4 py-2">Number</th><th className="px-4 py-2">Customer</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Valid until</th><th className="px-4 py-2">Salesperson</th><th className="px-4 py-2 text-right">Total</th><th className="px-4 py-2">Actions</th></tr></thead>
            <tbody>{rows.map((q) => {
              const open = (q.status === "DRAFT" || q.status === "ISSUED") && !q.convertedOrderId;
              const overdue = q.status === "ISSUED" && q.validUntil < today;
              return (
                <tr key={q.id} className="border-t border-[#EEF1ED]">
                  <td className="px-4 py-2 font-medium"><Link href={`/quotations/${q.id}`} className="text-[#1F7A4D] hover:underline">{q.quotationNumber} r{q.revisionNumber}</Link></td>
                  <td className="px-4 py-2">{q.customer.name}</td>
                  <td className="px-4 py-2"><StatusBadge status={q.status} />{q.convertedOrderId ? <span className="ml-2 text-xs text-[#849087]">converted</span> : null}</td>
                  <td className="px-4 py-2 text-xs">{q.validUntil}{overdue ? <span className="ml-1 font-semibold text-amber-700">past validity</span> : null}</td>
                  <td className="px-4 py-2">{q.salesperson.name}</td>
                  <td className="px-4 py-2 text-right">{q.currency} {q.total}</td>
                  <td className="px-4 py-2"><div className="flex flex-wrap gap-2">
                    <Link href={`/quotations/${q.id}`} className="rounded-lg border border-[#DDE3DC] px-3 py-1.5 text-xs font-semibold">Open</Link>
                    {open ? <ActionDialog label="Reassign" title={`Reassign ${q.quotationNumber}`} endpoint="/api/admin/assignments/reassign" payload={{ entityType: "QUOTATION", ids: [q.id], confirm: true }} confirmLabel="Reassign" fields={[{ name: "toUserId", label: "New salesperson", type: "select", options: userOptions(assignees), required: true }]} /> : null}
                    {q.status === "ISSUED" && overdue ? <ActionDialog label="Expire" title={`Expire ${q.quotationNumber}?`} description="Marks this issued quotation as expired. The record and its lines are kept." endpoint={`/api/quotations/${q.id}/expire`} askReason={false} confirmLabel="Expire" /> : null}
                    {open ? <ActionDialog label="Cancel" variant="danger" destructive title={`Cancel ${q.quotationNumber}?`} description="Cancelled quotations are kept for history and cannot be converted." endpoint={`/api/quotations/${q.id}/cancel`} askReason={false} confirmLabel="Cancel quotation" fields={[{ name: "cancellationReason", label: "Cancellation reason", type: "textarea", required: true }]} /> : null}
                  </div></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
        <Pagination basePath="/admin/quotations" searchParams={{ q: filters.q, status: filters.status, owner: filters.salespersonId }} page={page} totalPages={Math.max(1, Math.ceil(total / pageSize))} totalItems={total} pageSize={pageSize} />
      </SectionCard>
    </AdminShell>
  );
}
