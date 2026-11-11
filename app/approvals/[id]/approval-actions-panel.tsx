"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Milestone 8. Every mutating decision on one approval request, as one
 * client-rendered island (same split as
 * app/invoice-claims/[id]/claim-actions-panel.tsx). The server is always
 * the real authority on who may decide what -- `canDecide`/`canWithdraw`/
 * `canCancel` only control which buttons this UI offers; a stale page or
 * a direct API call still gets the same role/self-approval/concurrency
 * checks enforced in lib/approvals/requests.ts.
 */

type Props = {
  requestId: string;
  status: string;
  canDecide: boolean;
  canWithdraw: boolean;
  canCancel: boolean;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function ApprovalActionsPanel({ requestId, status, canDecide, canWithdraw, canCancel }: Props) {
  const router = useRouter();
  const [section, setSection] = useState<"closed" | "approve" | "reject" | "withdraw" | "cancel">("closed");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  function close() {
    setSection("closed");
    setError(null);
    setReason("");
  }

  async function submit(path: "approve" | "reject" | "withdraw" | "cancel", body: Record<string, unknown>) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/approvals/${requestId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : `Unable to ${path} this request.`);
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

  const isTerminal = status !== "PENDING" && status !== "DRAFT";

  if (isTerminal) {
    return null;
  }

  return (
    <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
      <h2 className="text-sm font-bold text-[#17251E]">Actions</h2>

      <div className="mt-3 flex flex-wrap gap-2">
        {canDecide && (
          <>
            <button onClick={() => setSection(section === "approve" ? "closed" : "approve")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
              Approve
            </button>
            <button onClick={() => setSection(section === "reject" ? "closed" : "reject")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">
              Reject
            </button>
          </>
        )}
        {canWithdraw && (
          <button onClick={() => setSection(section === "withdraw" ? "closed" : "withdraw")} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Withdraw
          </button>
        )}
        {canCancel && (
          <button onClick={() => setSection(section === "cancel" ? "closed" : "cancel")} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Cancel (admin)
          </button>
        )}
        {!canDecide && !canWithdraw && !canCancel && (
          <p className="text-[11px] text-gray-400">You do not have an action available on this request.</p>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {section === "approve" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
          <label className="block text-xs font-medium text-gray-600">
            Decision reason (optional)
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={() => submit("approve", { decisionReason: reason || undefined })} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Confirm approval
            </button>
          </div>
        </div>
      )}

      {section === "reject" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-red-100 bg-red-50/40 p-3">
          <label className="block text-xs font-medium text-gray-600">
            Rejection reason (required)
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button
              onClick={() => {
                if (!reason.trim()) {
                  setError("A reason is required to reject an approval request.");
                  return;
                }
                submit("reject", { decisionReason: reason });
              }}
              disabled={submitting}
              className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Confirm rejection
            </button>
          </div>
        </div>
      )}

      {section === "withdraw" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <p className="text-[11px] text-gray-500">Withdraws this request before any decision is made. You may resubmit later if the underlying values are still valid.</p>
          <label className="block text-xs font-medium text-gray-600">
            Note (optional)
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Back</button>
            <button onClick={() => submit("withdraw", { decisionReason: reason || undefined })} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Confirm withdrawal
            </button>
          </div>
        </div>
      )}

      {section === "cancel" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <label className="block text-xs font-medium text-gray-600">
            Cancellation reason (required)
            <textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Back</button>
            <button
              onClick={() => {
                if (!reason.trim()) {
                  setError("A reason is required to cancel an approval request.");
                  return;
                }
                submit("cancel", { cancellationReason: reason });
              }}
              disabled={submitting}
              className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Confirm cancellation
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
