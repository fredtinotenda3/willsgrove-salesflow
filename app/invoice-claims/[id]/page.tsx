import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import { getClaimDetail } from "@/lib/invoice-claims/queries";
import { computeClaimFinancialSummary, computeClaimLineDisputedValue } from "@/lib/invoice-claims/financial";
import {
  CLAIM_STATUS_LABELS,
  CLAIM_STATUS_STYLES,
  CLAIM_CATEGORY_LABELS,
  CLAIM_PRIORITY_LABELS,
  CLAIM_PRIORITY_STYLES,
  CLAIM_LINE_DISPUTE_TYPE_LABELS,
  RESOLUTION_DECISION_LABELS,
  RESOLUTIONS_IMPLYING_6B_FOLLOWUP,
} from "@/lib/invoice-claims/display";
import { listClaimReturns, listCreditNotesForClaim } from "@/lib/returns-credits/queries";
import { RETURN_CONDITION_LABELS, RETURN_CONDITION_STYLES, CREDIT_NOTE_MATCH_STATUS_LABELS, CREDIT_NOTE_MATCH_STATUS_STYLES } from "@/lib/returns-credits/display";
import Sidebar from "../../components/sidebar";
import { ArrowLeft, Paperclip } from "lucide-react";
import ClaimActionsPanel from "./claim-actions-panel";
import ReturnsCreditsPanel from "./returns-credits-panel";

/**
 * Milestone 6A. One claim's full detail: header, the disputed invoice
 * lines (each distinct from the original SAP invoice line, never
 * overwriting it), the full investigation/resolution history (including
 * any rejected recommendation -- append-only, nothing is ever hidden),
 * attachments, and the computed financial exposure summary. Mirrors
 * app/invoice-reconciliation/[id]/page.tsx's split: this is a Server
 * Component for the read side, with ClaimActionsPanel as the one
 * client-rendered island for every mutating action.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

export default async function InvoiceClaimDetailPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const claim = await getClaimDetail(id);
  if (!claim) {
    notFound();
  }

  const financialSummary = await computeClaimFinancialSummary(id);
  const canApprove = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";

  // Milestone 6B (Returns & Credit Notes).
  const [claimReturns, creditNotes] = await Promise.all([listClaimReturns(id), listCreditNotesForClaim(id)]);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Invoice Claims / {claim.claimReference}</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Claim {claim.claimReference}</h2>
          </div>
          <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold ${CLAIM_STATUS_STYLES[claim.status] ?? "bg-gray-100 text-gray-500"}`}>
            {CLAIM_STATUS_LABELS[claim.status] ?? claim.status}
          </span>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/invoice-claims" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to claims queue
          </Link>

          <section className="grid grid-cols-1 gap-4 rounded-xl border border-[#E8EBE6] bg-white p-5 sm:grid-cols-4">
            <Field label="Customer" value={claim.customer.name} sub={claim.customer.sapCustomerCode} />
            <Field label="SAP invoice" value={claim.sapInvoice.sapDocNum} link={`/invoice-reconciliation/${claim.sapInvoice.id}`} />
            <Field label="Category" value={CLAIM_CATEGORY_LABELS[claim.category] ?? claim.category} />
            <Field label="Priority" value={CLAIM_PRIORITY_LABELS[claim.priority] ?? claim.priority} badgeClass={CLAIM_PRIORITY_STYLES[claim.priority]} />
            <Field label="Claim date" value={new Date(claim.claimDate).toLocaleDateString()} />
            <Field label="Reported by" value={claim.reportedBy.name} />
            <Field label="Assigned to" value={claim.assignedTo?.name ?? "Unassigned"} />
            <Field label="SalesFlow order" value={claim.order?.reference ?? "Not linked"} link={claim.order ? `/orders/${claim.order.id}` : undefined} />
            {claim.customerComplaintReference && <Field label="Customer's own reference" value={claim.customerComplaintReference} />}
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Description</h2>
            <p className="mt-2 whitespace-pre-wrap text-xs text-gray-600">{claim.description}</p>
            {claim.customerCommunicationNotes && (
              <>
                <h3 className="mt-4 text-xs font-bold text-gray-500">Customer communication notes</h3>
                <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{claim.customerCommunicationNotes}</p>
              </>
            )}
          </section>

          {financialSummary && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h2 className="text-sm font-bold text-[#17251E]">Financial exposure</h2>
              <p className="mt-1 text-[11px] text-gray-400">
                All figures in {financialSummary.currencyCode ?? "an unknown currency"} -- never converted. &ldquo;Actual SAP credited&rdquo; is a live sum of every credit note recorded/matched against this claim, never an estimate.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
                <Metric label="Original invoice value" value={financialSummary.originalInvoiceValue ?? "-"} />
                <Metric label="Claimed value" value={financialSummary.claimedValue} warn={financialSummary.claimedValueIncomplete} warnLabel="incomplete -- one or more lines have no SAP unit price to price against" />
                <Metric label="Approved credit exposure" value={financialSummary.approvedCreditExposure} />
                <Metric label="Actual SAP credited" value={financialSummary.actualSapCreditedAmount} warn={financialSummary.actualExceedsApproved} warnLabel="exceeds the approved credit exposure -- flagged, not clamped" />
                <Metric label="Credit shortfall" value={financialSummary.actualCreditShortfall} />
                <Metric label="Remaining unresolved exposure" value={financialSummary.remainingUnresolvedExposure} />
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-bold text-[#17251E]">Disputed invoice lines</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-y border-gray-100 bg-gray-50/70">
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">SAP item</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Dispute type</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Invoiced</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Accepted</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Rejected/disputed</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Claimed value</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Reason / outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {claim.lines.map((line) => {
                    const value = computeClaimLineDisputedValue(line, line.sapInvoiceLine);
                    return (
                      <tr key={line.id} className="border-b border-gray-50 align-top">
                        <td className="px-6 py-4 text-xs text-gray-600">
                          <p className="font-mono font-medium text-gray-700">{line.sapItemCodeSnapshot ?? line.sapInvoiceLine.sapItemCode ?? "-"}</p>
                          {(line.sapItemDescriptionSnapshot ?? line.sapInvoiceLine.sapItemDescription) && (
                            <p className="text-[10px] text-gray-400">{line.sapItemDescriptionSnapshot ?? line.sapInvoiceLine.sapItemDescription}</p>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{CLAIM_LINE_DISPUTE_TYPE_LABELS[line.disputeType] ?? line.disputeType}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{line.sapInvoiceLine.quantityInvoiced.toString()}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{line.acceptedQuantity?.toString() ?? "-"}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{line.disputeType === "QUANTITY" ? (line.rejectedQuantity?.toString() ?? "-") : (line.disputedAmount?.toString() ?? "-")}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{value ?? "unpriced"}</td>
                        <td className="px-6 py-4 text-xs text-gray-600">
                          <p>{line.reason}</p>
                          {line.evidenceNotes && <p className="mt-1 text-[10px] text-gray-400">Evidence: {line.evidenceNotes}</p>}
                          {line.investigationOutcome && <p className="mt-1 text-[10px] text-emerald-700">Outcome: {line.investigationOutcome}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <div className="mb-3 flex items-center gap-2">
              <Paperclip size={14} className="text-gray-400" />
              <h2 className="text-sm font-bold text-[#17251E]">Attachments</h2>
            </div>
            {claim.attachments.length === 0 ? (
              <p className="text-xs text-gray-400">No evidence attached yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {claim.attachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center justify-between text-xs">
                    <a href={`/api/invoice-claims/attachments/${attachment.id}`} className="font-medium text-[#173D2E] hover:underline">
                      {attachment.originalFileName}
                    </a>
                    <span className="text-[10px] text-gray-400">
                      {attachment.uploadedBy.name} · {new Date(attachment.uploadedAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Investigation & resolution history</h2>
            <p className="mt-1 text-[11px] text-gray-400">
              Append-only -- every recommendation ever recorded stays visible here, including one a manager rejected. Approving a recommendation is a separate, explicit step; recording one never issues a credit or return by itself.
            </p>
            {claim.resolutions.length === 0 ? (
              <p className="mt-3 text-xs text-gray-400">No resolution has been recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {claim.resolutions.map((resolution) => (
                  <li key={resolution.id} className="rounded-lg border border-gray-100 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <p className="font-semibold text-[#173D2E]">{RESOLUTION_DECISION_LABELS[resolution.decision] ?? resolution.decision}</p>
                      <div className="flex items-center gap-2">
                        {resolution.approvedById && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">Approved</span>}
                        {resolution.rejectedById && <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-700">Rejected</span>}
                        {!resolution.approvedById && !resolution.rejectedById && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">Pending approval</span>}
                      </div>
                    </div>
                    {RESOLUTIONS_IMPLYING_6B_FOLLOWUP.has(resolution.decision) && resolution.approvedById && (
                      <p className="mt-1 text-[10px] text-cyan-700">Approved -- the physical return and/or credit note this implies is tracked in Milestone 6B, not yet created.</p>
                    )}
                    {resolution.findings && <p className="mt-2 text-gray-600">Findings: {resolution.findings}</p>}
                    {resolution.rootCause && <p className="mt-1 text-gray-600">Root cause: {resolution.rootCause}</p>}
                    {resolution.correctiveAction && <p className="mt-1 text-gray-600">Corrective action: {resolution.correctiveAction}</p>}
                    {resolution.responsibleDepartment && <p className="mt-1 text-gray-600">Responsible department: {resolution.responsibleDepartment}</p>}
                    {resolution.customerResponse && <p className="mt-1 text-gray-600">Customer response: {resolution.customerResponse}</p>}
                    {resolution.decisionDetail && <p className="mt-1 text-gray-600">Detail: {resolution.decisionDetail}</p>}
                    <p className="mt-2 text-[10px] text-gray-400">
                      Recorded by {resolution.recordedBy.name} · {new Date(resolution.recordedAt).toLocaleString()}
                      {resolution.approvedBy && <> · Approved by {resolution.approvedBy.name}{resolution.approvedCreditAmount ? ` (credit: ${resolution.approvedCreditAmount.toString()})` : ""}</>}
                      {resolution.rejectedBy && <> · Rejected by {resolution.rejectedBy.name}: {resolution.rejectionReason}</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Physical returns</h2>
            {claimReturns.length === 0 ? (
              <p className="mt-2 text-xs text-gray-400">No physical return has been recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {claimReturns.map((ret) => (
                  <li key={ret.id} className="rounded-lg border border-gray-100 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <p className="font-mono font-semibold text-[#173D2E]">{ret.returnReference}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${RETURN_CONDITION_STYLES[ret.condition] ?? "bg-gray-100 text-gray-600"}`}>
                        {RETURN_CONDITION_LABELS[ret.condition] ?? ret.condition}
                      </span>
                    </div>
                    <p className="mt-1 text-gray-600">Received quantity: {ret.receivedQuantity.toString()}{ret.claimLine && <> · {ret.claimLine.sapInvoiceLine.sapItemCode ?? "line"}</>}</p>
                    {ret.conditionDetail && <p className="mt-1 text-gray-600">Detail: {ret.conditionDetail}</p>}
                    {ret.conditionNotes && <p className="mt-1 text-gray-600">Notes: {ret.conditionNotes}</p>}
                    {ret.creditNote && <p className="mt-1 text-[10px] text-cyan-700">Linked to credit note {ret.creditNote.sapCreditNoteDocNum}</p>}
                    <p className="mt-2 text-[10px] text-gray-400">
                      Received {new Date(ret.receivedDate).toLocaleDateString()} by {ret.receivedBy.name} · recorded {new Date(ret.receivedAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Credit notes</h2>
            {creditNotes.length === 0 ? (
              <p className="mt-2 text-xs text-gray-400">No credit note has been recorded or matched yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {creditNotes.map((cn) => (
                  <li key={cn.id} className="rounded-lg border border-gray-100 p-3 text-xs">
                    <div className="flex items-center justify-between">
                      <p className="font-mono font-semibold text-[#173D2E]">{cn.sapCreditNoteDocNum}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${CREDIT_NOTE_MATCH_STATUS_STYLES[cn.matchStatus] ?? "bg-gray-100 text-gray-600"}`}>
                        {CREDIT_NOTE_MATCH_STATUS_LABELS[cn.matchStatus] ?? cn.matchStatus}
                      </span>
                    </div>
                    <p className="mt-1 text-gray-600">Amount: {cn.amount.toString()} {cn.currencyCode ?? ""}</p>
                    {cn.notes && <p className="mt-1 text-gray-600">Notes: {cn.notes}</p>}
                    <p className="mt-2 text-[10px] text-gray-400">
                      Recorded by {cn.recordedBy.name} · {new Date(cn.recordedAt).toLocaleString()}
                      {cn.importBatch && <> · imported from {cn.importBatch.originalFileName}</>}
                      {cn.matchedBy && <> · matched by {cn.matchedBy.name}</>}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ReturnsCreditsPanel
            claimId={claim.id}
            claimStatus={claim.status}
            canRecordCreditNote={canApprove}
            claimLines={claim.lines.map((line) => ({
              id: line.id,
              label: `${line.sapItemCodeSnapshot ?? line.sapInvoiceLine.sapItemCode ?? "line"} -- ${CLAIM_LINE_DISPUTE_TYPE_LABELS[line.disputeType] ?? line.disputeType}`,
            }))}
          />

          <ClaimActionsPanel
            claimId={claim.id}
            status={claim.status}
            canApprove={canApprove}
            pendingResolution={claim.resolutions.find((r) => !r.approvedById && !r.rejectedById) ? { id: claim.resolutions.find((r) => !r.approvedById && !r.rejectedById)!.id } : null}
          />

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Field({ label, value, sub, link, badgeClass }: { label: string; value: string; sub?: string | null; link?: string; badgeClass?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      {link ? (
        <Link href={link} className="mt-0.5 block text-sm font-semibold text-[#173D2E] hover:underline">
          {value}
        </Link>
      ) : badgeClass ? (
        <span className={`mt-0.5 inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${badgeClass}`}>{value}</span>
      ) : (
        <p className="mt-0.5 text-sm font-semibold text-gray-700">{value}</p>
      )}
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}

function Metric({ label, value, warn, warnLabel, muted }: { label: string; value: string; warn?: boolean; warnLabel?: string; muted?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${muted ? "text-gray-400" : "text-gray-700"}`}>{value}</p>
      {warn && warnLabel && <p className="mt-0.5 text-[10px] text-amber-600">{warnLabel}</p>}
    </div>
  );
}
