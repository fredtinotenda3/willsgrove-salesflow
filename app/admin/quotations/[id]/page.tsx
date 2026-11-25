import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { firstParam as one } from "@/lib/admin/paging";
import { fmtDate, fmtDateTime, fmtMoney, humanize } from "@/lib/admin/format";
import { KeyValueGrid, Notice, PageHeader, Panel, Stat, Tabs } from "../../_components/ui";
import { AuditTrail, MiniTable } from "../../_components/detail-parts";
import { requireAdminPage } from "../../_components/admin-shell";
import { ActionDialog } from "../../_components/action-dialog";
import { StatusBadge, userOptions } from "../../_components/status-badge";
import { getAdminQuotationDetail } from "@/lib/admin/quotation-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";

export const instant = false;
const link = (href: string, text: string) => <Link href={href} className="text-[#1F7A4D] hover:underline">{text}</Link>;
const tabOf = (raw: string | undefined, allowed: string[]) => (raw && allowed.includes(raw) ? raw : allowed[0]);

const TABS = ["overview", "lines", "revisions", "approvals", "activity", "actions"];

export default async function AdminQuotationDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const d = await getAdminQuotationDetail(id);
  if (!d) notFound();
  const { quotation: q, revisions, approvals, history, cancellable, expirable } = d;
  const tab = tabOf(one((await searchParams).tab), TABS);
  const assignees = tab === "actions" ? await listActiveAssignees() : [];
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/admin/quotations", label: "All quotations" }} title={`${q.quotationNumber} · revision ${q.revisionNumber}`} description={`${q.customer.name} · prepared by ${q.preparedBy.name} · salesperson ${q.salesperson.name}`} actions={<><StatusBadge status={q.status} />{q.supersededAt ? <StatusBadge status="CLOSED" /> : null}<Link href={`/quotations/${q.id}`} className="rounded-lg border border-[#DDE3DC] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#F7F8F6]">Open operational view</Link></>} />
      <Tabs basePath={`/admin/quotations/${q.id}`} active={tab} tabs={[{ key: "overview", label: "Overview" }, { key: "lines", label: "Lines", count: q.lines.length }, { key: "revisions", label: "Revisions", count: revisions.length }, { key: "approvals", label: "Approvals", count: approvals.length }, { key: "activity", label: "Activity" }, { key: "actions", label: "Actions" }]} />
      {tab === "overview" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Stat label="Subtotal" value={fmtMoney(q.currency, q.subtotal)} /><Stat label="Discount" value={fmtMoney(q.currency, q.discountTotal)} /><Stat label="VAT" value={fmtMoney(q.currency, q.vatTotal)} /><Stat label="Total" value={fmtMoney(q.currency, q.total)} /></div>
          <Panel title="Quotation"><KeyValueGrid columns={3} items={[
            { label: "Customer", value: link(`/admin/customers/${q.customer.id}`, q.customer.name) }, { label: "Customer reference", value: q.customerReference ?? "—" }, { label: "Currency", value: q.currency },
            { label: "Quotation date", value: fmtDate(q.quotationDate) }, { label: "Valid until", value: fmtDate(q.validUntil) }, { label: "Next follow-up", value: fmtDate(q.nextFollowUpDate) },
            { label: "Issued", value: q.issuedAt ? `${fmtDateTime(q.issuedAt)}${q.issuedBy ? ` by ${q.issuedBy.name}` : ""}` : "Not issued" }, { label: "Response", value: q.respondedAt ? `${fmtDateTime(q.respondedAt)}${q.responseNotes ? ` — ${q.responseNotes}` : ""}` : "—" }, { label: "Rejection reason", value: q.rejectionReason ?? "—" },
            { label: "Expired", value: q.expiredAt ? fmtDateTime(q.expiredAt) : "—" }, { label: "Cancelled", value: q.cancelledAt ? `${fmtDateTime(q.cancelledAt)} — ${q.cancellationReason ?? ""}` : "—" }, { label: "Converted order", value: q.convertedOrder ? <span className="inline-flex items-center gap-2">{link(`/admin/orders/${q.convertedOrder.id}`, q.convertedOrder.reference)}<StatusBadge status={q.convertedOrder.status} /></span> : "—" },
            { label: "Internal notes", value: <span className="whitespace-pre-wrap">{q.internalNotes ?? "—"}</span> }, { label: "Customer notes", value: <span className="whitespace-pre-wrap">{q.customerNotes ?? "—"}</span> }, { label: "Created", value: fmtDateTime(q.createdAt) },
          ]} /></Panel>
        </div>
      ) : null}
      {tab === "lines" ? <Panel title="Lines" description="Prices and VAT are the snapshot taken when the quotation was prepared; later price-list changes never alter them." flush><MiniTable empty="No lines." head={["#", "Item", "Quantity", "Unit price", "Discount", "VAT %", "Subtotal", "VAT", "Total"]} rows={q.lines.map((l) => [l.lineNumber, <div key="i">{l.isUnlistedItem ? l.unlistedItemDescription : l.sapItemDescriptionSnapshot}<div className="text-xs text-[#849087]">{l.isUnlistedItem ? "Unlisted item" : l.sapItemCodeSnapshot}</div></div>, `${l.quantity.toString()} ${l.unitOfMeasure ?? ""}`, l.unitPrice.toString(), `${l.discountPercent?.toString() ?? "0"}%`, l.vatRatePercentSnapshot?.toString() ?? "—", l.lineSubtotal.toString(), l.vatAmount.toString(), l.lineTotal.toString()])} /></Panel> : null}
      {tab === "revisions" ? <Panel title="Revision chain" description="A revision supersedes the previous one; the earlier versions stay on record." flush><MiniTable empty="No revisions." head={["Revision", "Number", "Status", "Total", "Created", ""]} rows={revisions.map((r) => [`Rev ${r.revisionNumber}${r.id === q.id ? " (this)" : ""}`, r.quotationNumber, <StatusBadge key="s" status={r.supersededAt ? "CLOSED" : r.status} />, fmtMoney(r.currency, r.total), fmtDate(r.createdAt), r.id === q.id ? "" : link(`/admin/quotations/${r.id}`, "View")])} /></Panel> : null}
      {tab === "approvals" ? <Panel title="Approval requests" flush><MiniTable empty="No approvals were needed for this quotation." head={["Rule", "Status", "Required approver", "Requested by", "Submitted", "Decision"]} rows={approvals.map((a) => [humanize(a.actionType), <StatusBadge key="s" status={a.status} />, humanize(a.requiredApproverRole), a.requestedBy?.name ?? "—", fmtDateTime(a.submittedAt), a.decidedAt ? `${a.decidedBy?.name ?? ""} · ${fmtDateTime(a.decidedAt)}${a.decisionReason ? ` — ${a.decisionReason}` : ""}` : "Pending"])} /></Panel> : null}
      {tab === "activity" ? (
        <div className="space-y-4">
          <Panel title="Lifecycle events"><div className="p-4"><ol className="space-y-2 text-sm">{q.events.length === 0 ? <li className="text-[#849087]">No lifecycle events.</li> : q.events.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2"><span><strong>{humanize(e.eventType)}</strong>{e.notes ? ` — ${e.notes}` : ""}</span><span className="text-xs text-[#849087]">{e.actor?.name ?? "System"} · {fmtDateTime(e.createdAt)}</span></li>)}</ol></div></Panel>
          <AuditTrail events={history} title="Administrative changes" />
        </div>
      ) : null}
      {tab === "actions" ? (
        <div className="space-y-4">
          <Panel title="Manage this quotation"><div className="flex flex-wrap gap-2 p-4">
            {!q.supersededAt && (q.status === "DRAFT" || q.status === "ISSUED") ? <ActionDialog label="Reassign salesperson" title={`Reassign ${q.quotationNumber}`} endpoint="/api/admin/assignments/reassign" payload={{ entityType: "QUOTATION", ids: [q.id], confirm: true }} confirmLabel="Reassign" fields={[{ name: "toUserId", label: "New salesperson", type: "select", options: userOptions(assignees), required: true }]} /> : null}
            {expirable ? <ActionDialog label="Mark as expired" title={`Expire ${q.quotationNumber}?`} description="Runs the same expiry the scheduled sweep uses. Only an issued, unconverted quotation can be expired." endpoint={`/api/quotations/${q.id}/expire`} askReason={false} confirmLabel="Expire quotation" /> : null}
            {cancellable ? <ActionDialog label="Cancel quotation" variant="danger" destructive title={`Cancel ${q.quotationNumber}?`} description="The quotation is kept as cancelled. A converted quotation cannot be cancelled." endpoint={`/api/quotations/${q.id}/cancel`} askReason={false} confirmText={q.quotationNumber} confirmLabel="Cancel quotation" fields={[{ name: "cancellationReason", label: "Reason", type: "textarea", required: true }]} /> : null}
          </div>{!cancellable && !expirable && !(q.status === "DRAFT" || q.status === "ISSUED") ? <p className="border-t border-[#EEF1ED] px-4 py-3 text-xs text-[#6B7B72]">This quotation is {humanize(q.status).toLowerCase()}{q.convertedOrderId ? " and has been converted to an order" : ""}; no lifecycle change is available.</p> : null}</Panel>
          <Notice tone="info">Quotations are never deleted: numbers, revisions and customer responses are a commercial record. Issuing, revising and converting run in the operational view because they enforce approval policies.</Notice>
        </div>
      ) : null}
    </div>
  );
}
