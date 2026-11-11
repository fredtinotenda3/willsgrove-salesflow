"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2, Ban, RotateCcw } from "lucide-react";

/**
 * Milestone 6B (Returns & Credit Notes). A credit note's manual
 * reconciliation actions -- match it to a specific claim by hand, mark it
 * as unlinkable to any claim, or reopen a previous decision back to
 * UNMATCHED. Mirrors app/invoice-reconciliation/[id]/reconciliation-panel.tsx
 * exactly, with one difference: none of lib/returns-credits/credit-notes.ts's
 * manuallyMatchCreditNote/markCreditNoteCannotLink actions restrict which
 * matchStatus they run from (only reopenCreditNoteMatch rejects an
 * already-UNMATCHED note), so every action except Reopen is offered
 * regardless of the current status -- a wrongly-matched note can be
 * re-matched or marked cannot-link directly, without reopening first.
 */

type CandidateClaim = {
  id: string;
  claimReference: string;
  status: string;
  resolutions: { decision: string; approvedCreditAmount: string | null }[];
};

type Props = {
  creditNoteId: string;
  matchStatus: string;
  sapInvoiceId: string | null;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function CreditNotePanel({ creditNoteId, matchStatus, sapInvoiceId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"closed" | "match" | "cannotLink" | "reopen">("closed");
  const [candidates, setCandidates] = useState<CandidateClaim[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedClaimId, setSelectedClaimId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openMatch() {
    setMode("match");
    setError(null);
    if (!sapInvoiceId) return;
    setLoadingCandidates(true);
    try {
      const response = await fetch(`/api/returns-credits/credit-notes/${creditNoteId}/candidate-claims`, { cache: "no-store" });
      const data = await readJson(response);
      setCandidates(Array.isArray(data.candidateClaims) ? (data.candidateClaims as CandidateClaim[]) : []);
    } finally {
      setLoadingCandidates(false);
    }
  }

  function close() {
    setMode("closed");
    setSelectedClaimId("");
    setNote("");
    setError(null);
  }

  async function submitMatch() {
    if (!selectedClaimId) {
      setError("Choose a claim.");
      return;
    }
    if (!note.trim()) {
      setError("An explanation is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/returns-credits/credit-notes/${creditNoteId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claimId: selectedClaimId, note }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to record this match.");
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

  async function submitCannotLink() {
    if (!note.trim()) {
      setError("An explanation is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/returns-credits/credit-notes/${creditNoteId}/cannot-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to record this.");
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

  async function submitReopen() {
    if (!note.trim()) {
      setError("A reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/returns-credits/credit-notes/${creditNoteId}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: note }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to reopen this credit note.");
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

  if (mode === "closed") {
    return (
      <div className="mt-3 flex flex-wrap gap-3">
        <button onClick={openMatch} className="flex items-center gap-1 text-[11px] font-semibold text-[#173D2E] hover:underline">
          <Link2 size={12} />
          Match to claim
        </button>
        <button onClick={() => setMode("cannotLink")} className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:underline">
          <Ban size={12} />
          Cannot link
        </button>
        {matchStatus !== "UNMATCHED" && (
          <button onClick={() => setMode("reopen")} className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:underline">
            <RotateCcw size={12} />
            Reopen (unlink)
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-3 max-w-md rounded-lg border border-gray-200 bg-white p-3">
      {mode === "match" && (
        <>
          <p className="mb-2 text-[11px] font-semibold text-gray-600">Match to a claim</p>
          {!sapInvoiceId ? (
            <p className="text-[11px] text-amber-600">This credit note has no resolved base invoice to find candidate claims against.</p>
          ) : loadingCandidates ? (
            <p className="text-[11px] text-gray-400">Loading candidate claims…</p>
          ) : candidates.length === 0 ? (
            <p className="text-[11px] text-gray-400">No claims raised against this credit note&apos;s base invoice.</p>
          ) : (
            <select
              value={selectedClaimId}
              onChange={(event) => setSelectedClaimId(event.target.value)}
              className="mb-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
            >
              <option value="">-- choose a claim --</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.claimReference} · {c.status}
                  {c.resolutions[0] ? ` · ${c.resolutions[0].decision}${c.resolutions[0].approvedCreditAmount ? ` (${c.resolutions[0].approvedCreditAmount})` : ""}` : ""}
                </option>
              ))}
            </select>
          )}
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why this is the correct match"
            rows={2}
            className="mb-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
          />
          {error && <p className="mb-2 text-[11px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">
              Cancel
            </button>
            <button
              onClick={submitMatch}
              disabled={submitting}
              className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Confirm match
            </button>
          </div>
        </>
      )}

      {mode === "cannotLink" && (
        <>
          <p className="mb-2 text-[11px] font-semibold text-gray-600">Mark as unlinkable to any claim</p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why this credit note has nothing to do with any recorded claim"
            rows={2}
            className="mb-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
          />
          {error && <p className="mb-2 text-[11px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">
              Cancel
            </button>
            <button
              onClick={submitCannotLink}
              disabled={submitting}
              className="flex items-center gap-1 rounded-lg bg-gray-700 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Confirm
            </button>
          </div>
        </>
      )}

      {mode === "reopen" && (
        <>
          <p className="mb-2 text-[11px] font-semibold text-gray-600">Reopen this credit note</p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why this decision is being reopened"
            rows={2}
            className="mb-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
          />
          {error && <p className="mb-2 text-[11px] text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">
              Cancel
            </button>
            <button
              onClick={submitReopen}
              disabled={submitting}
              className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Reopen
            </button>
          </div>
        </>
      )}
    </div>
  );
}
