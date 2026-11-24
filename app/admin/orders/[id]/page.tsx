import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { getAdminOrderDetail } from "@/lib/admin/order-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { EmptyState, PageHeader, SectionCard } from "../../../reports/_components/ui";
import { AdminShell, requireAdminPage } from "../../_components/admin-shell";
import { ActionDialog } from "../../_components/action-dialog";
import { StatusBadge, userOptions } from "../../_components/status-badge";

export const instant = false;
const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const detail = await getAdminOrderDetail(id);
  if (!detail) notFound();
  const { order: o, history, canEdit, canCancel, canReopen } = detail;
  const assignees = await listActiveAssignees();
  const reassignable = ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"].includes(o.status);
  return (
    <AdminShell active="/admin/orders">
      <PageHeader breadcrumb="Workspace / Administration / Orders" title={o.reference} description={`${o.customer.name} · ${o.salesperson ? `Salesperson ${o.salesperson.name}` : "No salesperson assigned"}`} actions={<div className="flex gap-2"><Link href={`/orders/${o.id}`} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold">Open operational view</Link><Link href="/admin/orders" className="px-3 py-2 text-sm font-semibold text-[#1F7A4D]">← All orders</Link></div>} />
      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Order">
          <dl className="grid grid-cols-2 gap-3 p-4 text-sm">
            <dt className="text-[#849087]">Status</dt><dd><StatusBadge status={o.status} /></dd>
            <dt className="text-[#849087]">Source</dt><dd>{o.source.replace(/_/g, " ")}</dd>
            <dt className="text-[#849087]">Customer PO</dt><dd>{o.customerPoReference ?? "—"}</dd>
            <dt className="text-[#849087]">Requested delivery</dt><dd>{o.requestedDeliveryDate?.toISOString().slice(0, 10) ?? "—"}</dd>
            <dt className="text-[#849087]">Delivery address</dt><dd>{o.deliveryAddress ?? "—"}</dd>
            <dt className="text-[#849087]">Internal notes</dt><dd className="whitespace-pre-wrap">{o.internalNotes ?? "—"}</dd>
            <dt className="text-[#849087]">Total</dt><dd>{o.total === null ? "—" : `${o.currency} ${o.total.toString()}`} ({o._count.lines} lines)</dd>
            <dt className="text-[#849087]">Created</dt><dd>{fmt(o.createdAt)} by {o.createdBy.name}</dd>
            <dt className="text-[#849087]">Source quotation</dt><dd>{o.sourceQuotation ? <Link className="text-[#1F7A4D]" href={`/quotations/${o.sourceQuotation.id}`}>{o.sourceQuotation.quotationNumber}</Link> : "—"}</dd>
            <dt className="text-[#849087]">SAP / invoice</dt><dd>{o.handedToSapAt ? `Handed to SAP ${fmt(o.handedToSapAt)}` : "Not handed to SAP"}{o.invoicedAt ? ` · invoiced ${fmt(o.invoicedAt)}` : ""}</dd>
          </dl>
          <div className="flex flex-wrap gap-2 border-t border-[#EEF1ED] p-4">
            {canEdit.ok ? (
              <ActionDialog label="Edit details" title="Edit order details" description="Lines, prices, customer and totals are not changed here." endpoint={`/api/admin/orders/${o.id}`} method="PATCH" confirmLabel="Save" fields={[
                { name: "customerPoReference", label: "Customer PO reference", type: "text", defaultValue: o.customerPoReference ?? "" },
                { name: "requestedDeliveryDate", label: "Requested delivery date", type: "date", defaultValue: o.requestedDeliveryDate?.toISOString().slice(0, 10) ?? "" },
                { name: "deliveryAddress", label: "Delivery address", type: "textarea", defaultValue: o.deliveryAddress ?? "" },
                { name: "internalNotes", label: "Internal notes", type: "textarea", defaultValue: o.internalNotes ?? "" },
              ]} />
            ) : <span className="text-xs text-[#849087]">Editing: {canEdit.ok ? "" : canEdit.message}</span>}
            {reassignable ? <ActionDialog label="Reassign salesperson" title={`Reassign ${o.reference}`} endpoint="/api/admin/assignments/reassign" payload={{ entityType: "ORDER", ids: [o.id], confirm: true }} confirmLabel="Reassign" fields={[{ name: "toUserId", label: "New salesperson", type: "select", options: userOptions(assignees), required: true }]} /> : null}
            {canCancel.ok ? <ActionDialog label="Cancel order" variant="danger" destructive title={`Cancel ${o.reference}?`} description="The order stays on record as cancelled and can be reopened later if it never reached SAP or invoicing." endpoint={`/api/admin/orders/${o.id}/cancel`} confirmLabel="Cancel order" /> : null}
            {canReopen.ok ? <ActionDialog label="Reopen order" variant="primary" title={`Reopen ${o.reference}?`} description="The order returns to RECEIVED and re-enters the normal review and approval flow." endpoint={`/api/admin/orders/${o.id}/reopen`} confirmLabel="Reopen" /> : null}
          </div>
          {!canCancel.ok && o.status !== "CANCELLED" && o.status !== "REJECTED" ? <p className="border-t border-[#EEF1ED] px-4 py-3 text-xs text-[#849087]">Cancel unavailable: {canCancel.message}</p> : null}
        </SectionCard>
        <SectionCard title="Status history">
          {o.statusHistory.length === 0 ? <EmptyState message="No status changes recorded." /> : (
            <ul className="divide-y divide-[#EEF1ED] text-sm">{o.statusHistory.map((h) => <li key={h.id} className="px-4 py-2"><div className="flex justify-between gap-3"><span>{h.fromStatus ? `${h.fromStatus.replace(/_/g, " ")} → ` : ""}<strong>{h.toStatus.replace(/_/g, " ")}</strong></span><span className="shrink-0 text-xs text-[#849087]">{h.changedBy?.name ?? "System"} · {fmt(h.createdAt)}</span></div>{h.notes ? <p className="text-xs text-[#5F6F66]">{h.notes}</p> : null}</li>)}</ul>
          )}
        </SectionCard>
      </div>
      <SectionCard title="Administrative changes" description="Edits, reassignments, cancellations and reopenings recorded in the audit log.">
        {history.length === 0 ? <EmptyState message="No administrative changes to this order." /> : (
          <ul className="divide-y divide-[#EEF1ED] text-sm">{history.map((h) => <li key={h.id} className="px-4 py-2"><div className="flex justify-between"><span className="font-medium">{h.action.replace(/_/g, " ").toLowerCase()}</span><span className="text-xs text-[#849087]">{h.actor?.name ?? "System"} · {fmt(h.createdAt)}</span></div><pre className="mt-1 overflow-x-auto whitespace-pre-wrap text-xs text-[#5F6F66]">{JSON.stringify({ before: h.beforeData, after: h.afterData })}</pre></li>)}</ul>
        )}
      </SectionCard>
    </AdminShell>
  );
}
