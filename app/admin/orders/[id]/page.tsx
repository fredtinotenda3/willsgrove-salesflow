import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { getAdminOrderDetail } from "@/lib/admin/order-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { firstParam as one } from "@/lib/admin/paging";
import { fmtDate, fmtDateTime, fmtMoney, humanize } from "@/lib/admin/format";
import { KeyValueGrid, Notice, PageHeader, Panel, Tabs } from "../../_components/ui";
import { AuditTrail, DeleteSection, MiniTable } from "../../_components/detail-parts";
import { OrderTotalCell } from "../../_components/order-total-cell";
import { requireAdminPage } from "../../_components/admin-shell";
import { ActionDialog } from "../../_components/action-dialog";
import { StatusBadge, userOptions } from "../../_components/status-badge";

export const instant = false;
const TABS = ["overview", "lines", "pricing", "documents", "approvals", "picking", "invoicing", "delivery", "activity", "actions"] as const;
const REASSIGNABLE = ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"];

export default async function AdminOrderDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const detail = await getAdminOrderDetail(id);
  if (!detail) notFound();
  const { order: o, history, canEdit, canCancel, canReopen, canDelete, pricing, orderTotal, effectiveStatus } = detail;
  const requested = one((await searchParams).tab);
  const tab = (TABS as readonly string[]).includes(requested ?? "") ? (requested as (typeof TABS)[number]) : "overview";
  const assignees = tab === "actions" ? await listActiveAssignees() : [];
  const link = (href: string, text: string) => <Link href={href} className="text-[#1F7A4D] hover:underline">{text}</Link>;

  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/admin/orders", label: "All orders" }} title={o.reference} description={`${o.customer.name} · ${o.salesperson ? `Salesperson ${o.salesperson.name}` : "No salesperson assigned"}`}
        actions={<><StatusBadge status={effectiveStatus} /><Link href={`/orders/${o.id}`} className="rounded-lg border border-[#DDE3DC] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#F7F8F6]">Open operational view</Link></>} />
      <Tabs basePath={`/admin/orders/${o.id}`} active={tab} tabs={[
        { key: "overview", label: "Overview" }, { key: "lines", label: "Lines", count: o._count.lines }, { key: "pricing", label: "Pricing" }, { key: "documents", label: "Documents", count: o._count.documents },
        { key: "approvals", label: "Approvals", count: o.approvalRequests.length + o.approvals.length }, { key: "picking", label: "Picking", count: o.pickingSessions.length }, { key: "invoicing", label: "SAP & invoicing" },
        { key: "delivery", label: "Delivery", count: o.dispatchRecords.length }, { key: "activity", label: "Activity" }, { key: "actions", label: "Actions" },
      ]} />

      {tab === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Order"><KeyValueGrid items={[
            { label: "Customer", value: link(`/admin/customers/${o.customer.id}`, o.customer.name) }, { label: "Source", value: humanize(o.source) }, { label: "Customer PO", value: o.customerPoReference ?? "—" },
            { label: "Requested delivery", value: fmtDate(o.requestedDeliveryDate) }, { label: "Delivery address", value: o.deliveryAddress ?? "—" }, { label: "Internal notes", value: <span className="whitespace-pre-wrap">{o.internalNotes ?? "—"}</span> },
            { label: "Currency", value: o.currency }, { label: "Subtotal", value: orderTotal.basis === "STORED" ? (o.subtotal === null ? "—" : fmtMoney(o.currency, o.subtotal)) : pricing.subtotal === null ? "—" : fmtMoney(o.currency, pricing.subtotal) }, { label: "Tax", value: orderTotal.basis === "STORED" ? (o.taxTotal === null ? "—" : fmtMoney(o.currency, o.taxTotal)) : pricing.taxTotal === null ? "—" : fmtMoney(o.currency, pricing.taxTotal) }, { label: "Total", value: <span><OrderTotalCell total={orderTotal} />{orderTotal.warning ? <span className="mt-1 block text-xs text-amber-800">{orderTotal.warning}</span> : null}</span> },
            { label: "Created", value: `${fmtDateTime(o.createdAt)} by ${o.createdBy.name}` }, { label: "Source quotation", value: o.sourceQuotation ? link(`/admin/quotations/${o.sourceQuotation.id}`, o.sourceQuotation.quotationNumber) : "—" }, { label: "Demo data", value: o.isDemo ? "Yes" : "No" },
          ]} /></Panel>
          <Panel title="Status history"><div className="divide-y divide-[#EEF1ED] text-sm">{o.statusHistory.length === 0 ? <p className="p-4 text-[#849087]">No status changes recorded.</p> : o.statusHistory.map((h) => <div key={h.id} className="px-4 py-2"><div className="flex justify-between gap-3"><span>{h.fromStatus ? `${humanize(h.fromStatus)} → ` : ""}<strong>{humanize(h.toStatus)}</strong></span><span className="shrink-0 text-xs text-[#849087]">{h.changedBy?.name ?? "System"} · {fmtDateTime(h.createdAt)}</span></div>{h.notes ? <p className="text-xs text-[#5F6F66]">{h.notes}</p> : null}</div>)}</div></Panel>
        </div>
      ) : null}

      {tab === "lines" ? (
        <Panel title="Order lines" description="Read-only here. Each line keeps the unit price it was created with (the price snapshot); later price-list or customer-price changes never alter it." flush>
          <MiniTable empty="This order has no lines." head={["#", "Product", "SAP item", "Quantity", `Unit price (${o.currency})`, `Line total (${o.currency})`]} rows={o.lines.map((l, i) => [l.lineNumber, <div key="d">{l.product ? link(`/admin/products/${l.product.id}`, l.product.itemName) : l.originalProductDescription}{l.product ? <div className="text-xs text-[#849087]">As ordered: {l.originalProductDescription}</div> : null}</div>, l.sapItemCodeSnapshot ?? "—", `${l.requestedQuantity.toString()} ${l.requestedUnitCode ?? ""}`, (l.approvedUnitPrice ?? l.customerUnitPrice)?.toString() ?? <span key="np" className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">No price</span>, pricing.lines[i]?.subtotal ?? "—"])} />
        </Panel>
      ) : null}

      {tab === "pricing" ? (
        <Panel title="Order total" description="Calculated by the same shared service as the operational order list, from each line's stored price. Currency is the order's currency." >
          <div className="space-y-3 p-4 text-sm">
            <KeyValueGrid items={[
              { label: "Currency", value: o.currency }, { label: "Basis", value: orderTotal.basis === "STORED" ? "Stored (approved) total" : orderTotal.basis === "CALCULATED" ? "Calculated from line prices" : orderTotal.basis === "PARTIAL" ? "Partial — see warning" : "Unavailable" },
              { label: "Priced lines", value: `${pricing.pricedLineCount} of ${pricing.pricedLineCount + pricing.unpricedLineCount}` }, { label: "Total", value: <OrderTotalCell total={orderTotal} /> },
            ]} />
            {orderTotal.warning ? <Notice tone="warn" title="Data quality">{orderTotal.warning}</Notice> : null}
          </div>
        </Panel>
      ) : null}

      {tab === "documents" ? (
        <Panel title="Documents" flush>
          <MiniTable empty="No documents are attached to this order." head={["File", "Type", "Classification", "Status", "Size", "Uploaded"]} rows={o.documents.map((d) => [d.originalFileName, humanize(d.documentType), humanize(d.classification), <StatusBadge key="s" status={d.status} />, `${Math.max(1, Math.round(d.fileSize / 1024))} KB`, `${d.uploadedBy?.name ?? "—"} · ${fmtDate(d.createdAt)}`])} />
        </Panel>
      ) : null}

      {tab === "approvals" ? (
        <div className="space-y-4">
          <Panel title="Approval requests" flush><MiniTable empty="No approval requests." head={["Rule", "Status", "Required approver", "Requested by", "Submitted", "Decision"]} rows={o.approvalRequests.map((a) => [humanize(a.actionType), <StatusBadge key="s" status={a.status} />, humanize(a.requiredApproverRole), a.requestedBy?.name ?? "—", fmtDateTime(a.submittedAt), a.decidedAt ? `${a.decidedBy?.name ?? ""} · ${fmtDateTime(a.decidedAt)}${a.decisionReason ? ` — ${a.decisionReason}` : ""}` : "Pending"])} /></Panel>
          <Panel title="Order approvals" flush><MiniTable empty="No order-level approvals." head={["Status", "Notes", "Decided by", "Decided"]} rows={o.approvals.map((a) => [<StatusBadge key="s" status={a.status} />, a.notes ?? "—", a.decidedBy?.name ?? "—", a.decidedAt ? fmtDateTime(a.decidedAt) : "—"])} /></Panel>
        </div>
      ) : null}

      {tab === "picking" ? (
        <Panel title="Picking sessions" flush><MiniTable empty="Picking has not started." head={["Status", "Started", "Started by", "Lines", "Authorised", "Notes"]} rows={o.pickingSessions.map((s) => [<StatusBadge key="s" status={s.status} />, fmtDateTime(s.startedAt), s.startedBy?.name ?? "—", s._count.lines, s.authorizedAt ? `${s.authorizedBy?.name ?? ""} · ${fmtDateTime(s.authorizedAt)}` : "—", s.notes ?? "—"])} /></Panel>
      ) : null}

      {tab === "invoicing" ? (
        <div className="space-y-4">
          <Panel title="SAP hand-over"><KeyValueGrid items={[{ label: "Handed to SAP", value: o.handedToSapAt ? fmtDateTime(o.handedToSapAt) : "Not yet" }, { label: "Invoiced", value: o.invoicedAt ? fmtDateTime(o.invoicedAt) : "Not yet" }, { label: "SAP submission", value: o.integrationOperation ? <span className="inline-flex items-center gap-2"><StatusBadge status={o.integrationOperation.status} />{o.integrationOperation.externalDocNum ? `Doc ${o.integrationOperation.externalDocNum}` : null}</span> : "None" }, { label: "Attempts", value: o.integrationOperation ? `${o.integrationOperation.attemptCount}${o.integrationOperation.lastErrorMessage ? ` — ${o.integrationOperation.lastErrorMessage}` : ""}` : "—" }]} /></Panel>
          <Panel title="Invoice hand-over files" flush><MiniTable empty="No hand-over file has been generated." head={["Reference", "Format", "Lines", "Matched", "Unmatched", "Generated"]} rows={o.handovers.map((h) => [h.reference, h.format, h.lineCount, h.matchedLineCount, h.unmatchedLineCount, `${h.generatedBy?.name ?? "—"} · ${fmtDate(h.createdAt)}`])} /></Panel>
          <Panel title="Matched SAP invoices" flush><MiniTable empty="No SAP invoice has been matched to this order." head={["Invoice", "Date", "Total", "Reconciliation"]} rows={o.matchedSapInvoices.map((i) => [link(`/admin/invoices/${i.id}`, i.sapDocNum), fmtDate(i.invoiceDate), i.total ? fmtMoney(i.currencyCode, i.total) : "—", <StatusBadge key="s" status={i.reconciliationStatus} />])} /></Panel>
          <Panel title="Claims" flush><MiniTable empty="No claims against this order." head={["Claim", "Category", "Status"]} rows={o.invoiceClaims.map((c) => [link(`/admin/claims/${c.id}`, c.claimReference), humanize(c.category), <StatusBadge key="s" status={c.status} />])} /></Panel>
        </div>
      ) : null}

      {tab === "delivery" ? (
        <Panel title="Dispatch & delivery" flush><MiniTable empty="This order has not been dispatched." head={["Dispatch", "Driver", "Vehicle", "Departed", "Outcome", "Received by"]} rows={o.dispatchRecords.map((d) => [<StatusBadge key="s" status={d.status} />, `${d.driver?.name ?? "—"}${d.assistant ? ` + ${d.assistant.name}` : ""}`, d.vehicle?.registrationNumber ?? "—", d.departedAt ? fmtDateTime(d.departedAt) : d.plannedDepartureAt ? `Planned ${fmtDateTime(d.plannedDepartureAt)}` : "—", d.deliveryRecord ? <StatusBadge key="o" status={d.deliveryRecord.outcome} /> : d.cancellationReason ? `Cancelled: ${d.cancellationReason}` : "—", d.deliveryRecord?.recipientName ?? "—"])} /></Panel>
      ) : null}

      {tab === "activity" ? <AuditTrail events={history} /> : null}

      {tab === "actions" ? (
        <div className="space-y-4">
          <Panel title="Manage this order">
            <div className="flex flex-wrap gap-2 p-4">
              {canEdit.ok ? <ActionDialog label="Edit details" title="Edit order details" description="Lines, prices, customer and totals are not changed here." endpoint={`/api/admin/orders/${o.id}`} method="PATCH" confirmLabel="Save" fields={[
                { name: "customerPoReference", label: "Customer PO reference", type: "text", defaultValue: o.customerPoReference ?? "" },
                { name: "requestedDeliveryDate", label: "Requested delivery date", type: "date", defaultValue: o.requestedDeliveryDate?.toISOString().slice(0, 10) ?? "" },
                { name: "deliveryAddress", label: "Delivery address", type: "textarea", defaultValue: o.deliveryAddress ?? "" },
                { name: "internalNotes", label: "Internal notes", type: "textarea", defaultValue: o.internalNotes ?? "" },
              ]} /> : null}
              {REASSIGNABLE.includes(o.status) ? <ActionDialog label="Reassign salesperson" title={`Reassign ${o.reference}`} endpoint="/api/admin/assignments/reassign" payload={{ entityType: "ORDER", ids: [o.id], confirm: true }} confirmLabel="Reassign" fields={[{ name: "toUserId", label: "New salesperson", type: "select", options: userOptions(assignees), required: true }]} /> : null}
              {canCancel.ok ? <ActionDialog label="Cancel order" variant="danger" destructive title={`Cancel ${o.reference}?`} description="The order stays on record as cancelled and can be reopened if it never reached SAP or invoicing." endpoint={`/api/admin/orders/${o.id}/cancel`} confirmLabel="Cancel order" confirmText={o.reference} /> : null}
              {canReopen.ok ? <ActionDialog label="Reopen order" variant="primary" title={`Reopen ${o.reference}?`} description="The order returns to RECEIVED and re-enters the normal review and approval flow." endpoint={`/api/admin/orders/${o.id}/reopen`} confirmLabel="Reopen" /> : null}
            </div>
            <div className="space-y-1 border-t border-[#EEF1ED] px-4 py-3 text-xs text-[#6B7B72]">
              {!canEdit.ok ? <p>Editing unavailable: {canEdit.message}</p> : null}
              {!canCancel.ok && o.status !== "CANCELLED" && o.status !== "REJECTED" ? <p>Cancel unavailable: {canCancel.message}</p> : null}
              {!canReopen.ok && (o.status === "CANCELLED" || o.status === "REJECTED") ? <p>Reopen unavailable: {canReopen.message}</p> : null}
            </div>
          </Panel>
          <Notice tone="info">Line-level changes (adding, removing or correcting lines and prices) are intentionally not offered here: they are handled in the operational view.</Notice>
          <DeleteSection verdict={canDelete} noun="draft order" endpoint={`/api/admin/orders/${o.id}`} confirmText={o.reference} redirect="/admin/orders" alternative="Orders that have progressed are cancelled instead of deleted, so numbering, approvals and history stay intact." lines={o._count.lines ? [`${o._count.lines} line(s) belonging only to this draft are removed with it.`] : []} />
        </div>
      ) : null}
    </div>
  );
}
