import Link from "next/link";
import { notFound } from "next/navigation";
import { isValidId } from "@/lib/http";
import { firstParam as one } from "@/lib/admin/paging";
import { fmtDate, fmtDateTime, fmtMoney, humanize } from "@/lib/admin/format";
import { getAdminClaimDetail } from "@/lib/admin/finance-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { KeyValueGrid, Notice, PageHeader, Panel, Tabs } from "../../_components/ui";
import { AuditTrail, MiniTable } from "../../_components/detail-parts";
import { requireAdminPage } from "../../_components/admin-shell";
import { ActionDialog } from "../../_components/action-dialog";
import { StatusBadge, userOptions } from "../../_components/status-badge";

export const instant = false;
const link = (href: string, text: string) => <Link href={href} className="text-[#1F7A4D] hover:underline">{text}</Link>;
const TABS = ["overview", "lines", "financial", "resolutions", "documents", "activity", "actions"];
const CONCLUDED = ["RESOLVED", "REJECTED", "CLOSED"];

export default async function AdminClaimDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const { id } = await params;
  if (!isValidId(id)) notFound();
  const d = await getAdminClaimDetail(id);
  if (!d) notFound();
  const { claim: c, financial: f, history } = d;
  const requested = one((await searchParams).tab);
  const tab = requested && TABS.includes(requested) ? requested : "overview";
  const assignees = tab === "actions" ? await listActiveAssignees() : [];
  const cur = f?.currencyCode ?? c.sapInvoice?.currencyCode ?? null;
  const money = (v: string | null | undefined) => (v === null || v === undefined ? "—" : fmtMoney(cur, v));
  return (
    <div className="space-y-4">
      <PageHeader back={{ href: "/admin/claims", label: "All claims" }} title={c.claimReference} description={`${c.customer.name} · ${humanize(c.category)}${c.sapInvoice ? ` · invoice ${c.sapInvoice.sapDocNum}` : ""}`} actions={<><StatusBadge status={c.priority} /><StatusBadge status={c.status} /><Link href={`/invoice-claims/${c.id}`} className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open claim workspace</Link></>} />
      <Tabs basePath={`/admin/claims/${c.id}`} active={tab} tabs={[{ key: "overview", label: "Overview" }, { key: "lines", label: "Claim lines", count: c.lines.length }, { key: "financial", label: "Financial" }, { key: "resolutions", label: "Resolutions & returns", count: c.resolutions.length + c.returns.length }, { key: "documents", label: "Evidence", count: c.attachments.length }, { key: "activity", label: "Activity" }, { key: "actions", label: "Actions" }]} />
      {tab === "overview" ? <Panel title="Claim"><KeyValueGrid columns={3} items={[
        { label: "Customer", value: link(`/admin/customers/${c.customer.id}`, c.customer.name) }, { label: "Invoice", value: c.sapInvoice ? link(`/admin/invoices/${c.sapInvoice.id}`, c.sapInvoice.sapDocNum) : "—" }, { label: "Order", value: c.order ? link(`/admin/orders/${c.order.id}`, c.order.reference) : "—" },
        { label: "Category", value: humanize(c.category) }, { label: "Claim date", value: fmtDate(c.claimDate) }, { label: "Customer complaint ref", value: c.customerComplaintReference ?? "—" },
        { label: "Reported by", value: c.reportedBy?.name ?? "—" }, { label: "Owner", value: c.assignedTo ? `${c.assignedTo.name}${c.assignedTo.status !== "ACTIVE" ? " (inactive)" : ""}` : <span className="font-semibold text-amber-700">Unassigned</span> }, { label: "Resolved / closed", value: c.closedAt ? fmtDateTime(c.closedAt) : c.resolvedAt ? fmtDateTime(c.resolvedAt) : "Open" },
        { label: "Description", value: <span className="whitespace-pre-wrap">{c.description}</span> }, { label: "Customer communication", value: <span className="whitespace-pre-wrap">{c.customerCommunicationNotes ?? "—"}</span> }, { label: "Raised", value: fmtDateTime(c.createdAt) },
      ]} /></Panel> : null}
      {tab === "lines" ? <Panel title="Claim lines" flush><MiniTable empty="No lines." head={["Item", "Dispute", "Accepted", "Rejected", "Disputed amount", "Reason", "Investigation"]} rows={c.lines.map((l) => [<div key="i">{l.sapItemDescriptionSnapshot}<div className="text-xs text-[#849087]">{l.sapItemCodeSnapshot}</div></div>, humanize(l.disputeType), l.acceptedQuantity?.toString() ?? "—", l.rejectedQuantity?.toString() ?? "—", money(l.disputedAmount?.toString()), l.reason ?? "—", l.investigationOutcome ? humanize(l.investigationOutcome) : "—"])} /></Panel> : null}
      {tab === "financial" ? (f ? (
        <div className="space-y-4">
          <Notice tone="info">Figures come from the same routine as the claims dashboard and are in {cur ?? "an unknown currency"} only. Credit notes are imported from SAP; nothing is recalculated or edited here.</Notice>
          <Panel title={`Financial position (${cur ?? "currency unknown"})`}><KeyValueGrid columns={3} items={[
            { label: "Original invoice value", value: money(f.originalInvoiceValue) }, { label: "Claimed value", value: `${money(f.claimedValue)}${f.claimedValueIncomplete ? " (incomplete — some lines have no price)" : ""}` }, { label: "Potential credit exposure", value: money(f.potentialCreditExposure) },
            { label: "Approved credit exposure", value: money(f.approvedCreditExposure) }, { label: "Credited in SAP", value: money(f.actualSapCreditedAmount) }, { label: "Remaining unresolved", value: money(f.remainingUnresolvedExposure) },
            { label: "Credit shortfall", value: money(f.actualCreditShortfall) }, { label: "Credited more than approved", value: f.actualExceedsApproved ? <span className="font-semibold text-red-700">Yes — review</span> : "No" },
          ]} /></Panel>
          <Panel title="Credit notes" flush><MiniTable empty="No credit notes are linked." head={["Credit note", "Amount", "Match", "Date"]} rows={c.creditNotes.map((n) => [n.sapCreditNoteDocNum, fmtMoney(n.currencyCode, n.amount), <StatusBadge key="s" status={n.matchStatus} />, fmtDate(n.creditNoteDate)])} /></Panel>
        </div>
      ) : <Notice tone="warn">Financial figures are unavailable for this claim.</Notice>) : null}
      {tab === "resolutions" ? (
        <div className="space-y-4">
          <Panel title="Resolutions" flush><MiniTable empty="No resolution has been recorded." head={["Decision", "Findings", "Root cause", "Department", "Recorded", "Approval"]} rows={c.resolutions.map((r) => [<div key="d"><strong>{humanize(r.decision)}</strong>{r.decisionDetail ? <div className="text-xs text-[#849087]">{r.decisionDetail}</div> : null}</div>, r.findings ?? "—", r.rootCause ?? "—", r.responsibleDepartment ? humanize(r.responsibleDepartment) : "—", `${r.recordedBy?.name ?? "—"} · ${fmtDate(r.recordedAt)}`, r.approvedAt ? `Approved ${fmtDate(r.approvedAt)} by ${r.approvedBy?.name ?? "—"}${r.approvedCreditAmount ? ` (${money(r.approvedCreditAmount.toString())})` : ""}` : r.rejectedAt ? `Rejected ${fmtDate(r.rejectedAt)}: ${r.rejectionReason ?? ""}` : "Awaiting decision"])} /></Panel>
          <Panel title="Returns" flush><MiniTable empty="No goods have been returned." head={["Return", "Quantity", "Condition", "Received"]} rows={c.returns.map((r) => [r.returnReference, r.receivedQuantity.toString(), humanize(r.condition), `${fmtDate(r.receivedDate)}${r.receivedBy ? ` · ${r.receivedBy.name}` : ""}`])} /></Panel>
        </div>
      ) : null}
      {tab === "documents" ? <Panel title="Evidence & attachments" flush><MiniTable empty="No evidence has been attached." head={["File", "Type", "Size", "Uploaded"]} rows={c.attachments.map((a) => [a.originalFileName, a.mimeType, `${Math.max(1, Math.round(a.fileSize / 1024))} KB`, `${a.uploadedBy?.name ?? "—"} · ${fmtDate(a.uploadedAt)}`])} /></Panel> : null}
      {tab === "activity" ? <AuditTrail events={history} /> : null}
      {tab === "actions" ? (
        <div className="space-y-4">
          <Panel title="Manage this claim"><div className="flex flex-wrap gap-2 p-4">
            {CONCLUDED.includes(c.status) ? <p className="text-sm text-[#6B7B72]">This claim is {humanize(c.status).toLowerCase()}; ownership can no longer be changed.</p> : <ActionDialog label={c.assignedTo ? "Reassign owner" : "Assign owner"} title={`Assign ${c.claimReference}`} endpoint="/api/admin/assignments/reassign" payload={{ entityType: "CLAIM", ids: [c.id], confirm: true }} confirmLabel="Save" fields={[{ name: "toUserId", label: "Owner", type: "select", options: userOptions(assignees), required: true, defaultValue: c.assignedTo?.id }]} />}
          </div></Panel>
          <Notice tone="info">Claims are never deleted: they are a financial and customer-service record, and credit notes and returns point to them. Investigation, decisions, status changes and credit-note links are recorded in the claim workspace, which enforces the approval rules.</Notice>
        </div>
      ) : null}
    </div>
  );
}
