"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Paperclip, Upload } from "lucide-react";
import { CLAIM_STATUS_LABELS, RESOLUTION_DECISION_LABELS } from "@/lib/invoice-claims/display";

/**
 * Milestone 6A. Every mutating claim action, as one client-rendered
 * island (same split as app/invoice-reconciliation/[id]/
 * reconciliation-panel.tsx): change status, record an investigation/
 * resolution recommendation, approve or reject a pending recommendation
 * (manager-only, enforced again server-side regardless of what this UI
 * shows), and upload evidence. Re-fetches via router.refresh() after
 * every successful action rather than guessing at the new state.
 */

const STATUS_VALUES = Object.keys(CLAIM_STATUS_LABELS);
const DECISION_VALUES = Object.keys(RESOLUTION_DECISION_LABELS);

type Props = {
  claimId: string;
  status: string;
  canApprove: boolean;
  pendingResolution: { id: string } | null;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function ClaimActionsPanel({ claimId, status, canApprove, pendingResolution }: Props) {
  const router = useRouter();
  const [section, setSection] = useState<"closed" | "status" | "resolution" | "reject" | "upload">("closed");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Status change
  const [toStatus, setToStatus] = useState(STATUS_VALUES[0]);
  const [statusReason, setStatusReason] = useState("");

  // Resolution
  const [findings, setFindings] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [correctiveAction, setCorrectiveAction] = useState("");
  const [responsibleDepartment, setResponsibleDepartment] = useState("");
  const [customerResponse, setCustomerResponse] = useState("");
  const [decision, setDecision] = useState(DECISION_VALUES[0]);
  const [decisionDetail, setDecisionDetail] = useState("");
  const [approvedCreditAmount, setApprovedCreditAmount] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");

  function close() {
    setSection("closed");
    setError(null);
    setStatusReason("");
    setApprovedCreditAmount("");
    setRejectionReason("");
  }

  async function submitStatusChange() {
    if (!statusReason.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoice-claims/${claimId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus, reason: statusReason }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to change status.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitResolution() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoice-claims/${claimId}/resolutions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          findings: findings || undefined,
          rootCause: rootCause || undefined,
          correctiveAction: correctiveAction || undefined,
          responsibleDepartment: responsibleDepartment || undefined,
          customerResponse: customerResponse || undefined,
          decision,
          decisionDetail: decision === "OTHER" ? decisionDetail : undefined,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to record this resolution.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitApprove() {
    if (!pendingResolution) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoice-claims/${claimId}/resolutions/${pendingResolution.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvedCreditAmount: approvedCreditAmount || undefined }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to approve this resolution.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitReject() {
    if (!pendingResolution) return;
    if (!rejectionReason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoice-claims/${claimId}/resolutions/${pendingResolution.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rejectionReason }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to reject this resolution.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function uploadFile(file: File) {
    setSubmitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch(`/api/invoice-claims/${claimId}/attachments`, { method: "POST", body: formData });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to upload this file.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  const isTerminal = status === "CLOSED";

  return (
    <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
      <h2 className="text-sm font-bold text-[#17251E]">Actions</h2>

      {!isTerminal && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setSection(section === "status" ? "closed" : "status")} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Change status
          </button>
          <button onClick={() => setSection(section === "resolution" ? "closed" : "resolution")} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Record investigation / resolution
          </button>
          <button onClick={() => setSection(section === "upload" ? "closed" : "upload")} className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            <Paperclip size={12} />
            Add evidence
          </button>
          {pendingResolution && canApprove && (
            <>
              <button onClick={submitApprove} disabled={submitting} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
                Approve pending resolution
              </button>
              <button onClick={() => setSection(section === "reject" ? "closed" : "reject")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">
                Reject pending resolution
              </button>
            </>
          )}
          {pendingResolution && !canApprove && (
            <p className="flex items-center text-[11px] text-amber-600">A resolution is awaiting a sales manager&rsquo;s or administrator&rsquo;s approval.</p>
          )}
        </div>
      )}

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {section === "status" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <label className="block text-xs font-medium text-gray-600">
            New status
            <select value={toStatus} onChange={(event) => setToStatus(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
              {STATUS_VALUES.map((value) => (
                <option key={value} value={value}>{CLAIM_STATUS_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Reason
            <textarea value={statusReason} onChange={(event) => setStatusReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <p className="text-[10px] text-gray-400">Moving to Approved/Partially resolved/Resolved/Rejected/Closed requires a sales manager or administrator; the server enforces this regardless of what this form allows you to select.</p>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={submitStatusChange} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Confirm
            </button>
          </div>
        </div>
      )}

      {section === "resolution" && (
        <div className="mt-4 max-w-xl space-y-2 rounded-lg border border-gray-100 p-3">
          <p className="text-[11px] text-gray-500">Recording a resolution moves the claim to &ldquo;Awaiting internal approval&rdquo; -- it is a recommendation, not an executed action. Only a sales manager or administrator can approve it.</p>
          <label className="block text-xs font-medium text-gray-600">Findings<textarea value={findings} onChange={(event) => setFindings(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></label>
          <label className="block text-xs font-medium text-gray-600">Root cause<textarea value={rootCause} onChange={(event) => setRootCause(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></label>
          <label className="block text-xs font-medium text-gray-600">Corrective action<textarea value={correctiveAction} onChange={(event) => setCorrectiveAction(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></label>
          <label className="block text-xs font-medium text-gray-600">Responsible department<input value={responsibleDepartment} onChange={(event) => setResponsibleDepartment(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></label>
          <label className="block text-xs font-medium text-gray-600">Customer response<textarea value={customerResponse} onChange={(event) => setCustomerResponse(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></label>
          <label className="block text-xs font-medium text-gray-600">
            Resolution decision
            <select value={decision} onChange={(event) => setDecision(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
              {DECISION_VALUES.map((value) => (
                <option key={value} value={value}>{RESOLUTION_DECISION_LABELS[value]}</option>
              ))}
            </select>
          </label>
          {decision === "OTHER" && (
            <label className="block text-xs font-medium text-gray-600">Detail (required for &ldquo;Other&rdquo;)<input value={decisionDetail} onChange={(event) => setDecisionDetail(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></label>
          )}
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={submitResolution} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Record resolution
            </button>
          </div>
        </div>
      )}

      {section === "reject" && pendingResolution && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <label className="block text-xs font-medium text-gray-600">Rejection reason (required)<textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" /></label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={submitReject} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Reject
            </button>
          </div>
        </div>
      )}

      {pendingResolution && canApprove && section === "closed" && (
        <div className="mt-4 max-w-sm rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
          <label className="block text-xs font-medium text-gray-600">
            Approved credit amount (optional -- only if this resolution implies a credit)
            <input value={approvedCreditAmount} onChange={(event) => setApprovedCreditAmount(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" placeholder="e.g. 125.0000" />
          </label>
          <p className="mt-1 text-[10px] text-gray-400">Set this before clicking &ldquo;Approve pending resolution&rdquo; above if you are approving less (or more) than the full claimed value.</p>
        </div>
      )}

      {section === "upload" && (
        <div className="mt-4 max-w-sm space-y-2 rounded-lg border border-gray-100 p-3">
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-6 text-xs text-gray-500 hover:bg-gray-50">
            <Upload size={14} />
            Choose a file
            <input
              type="file"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) uploadFile(file);
              }}
            />
          </label>
          {submitting && <p className="text-[11px] text-gray-400">Uploading…</p>}
        </div>
      )}
    </section>
  );
}
