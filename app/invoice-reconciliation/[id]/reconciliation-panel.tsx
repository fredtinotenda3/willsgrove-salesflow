"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Link2, Ban, RotateCcw } from "lucide-react";

/**
 * Milestone 5 (SAP Invoice Reconciliation). One invoice line's manual
 * reconciliation actions (spec section 7): match it to a specific order
 * line by hand, mark it as having nothing to do with SalesFlow, or reopen
 * a previous decision. Same "re-fetch via router.refresh(), don't guess
 * at the new state" convention as app/lost-sales/[id]/decision-panel.tsx.
 */

type CandidateOrderLine = {
  orderId: string;
  orderReference: string;
  orderLineId: string;
  sapItemCodeSnapshot: string | null;
  productDescription: string;
  authorizedQuantity: string;
  invoicedQuantity: string;
  remainingQuantity: string;
  status: string;
};

type Props = {
  invoiceId: string;
  lineId: string;
  matchStatus: string;
  matchedCustomerId: string | null;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function ReconciliationPanel({ invoiceId, lineId, matchStatus, matchedCustomerId }: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<"closed" | "match" | "cannotLink" | "reopen">("closed");
  const [candidates, setCandidates] = useState<CandidateOrderLine[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedOrderLineId, setSelectedOrderLineId] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openMatch() {
    setMode("match");
    setError(null);
    if (!matchedCustomerId) return;
    setLoadingCandidates(true);
    try {
      const response = await fetch(`/api/invoice-reconciliation/${invoiceId}/candidate-orders`, { cache: "no-store" });
      const data = await readJson(response);
      setCandidates(Array.isArray(data.candidateOrderLines) ? (data.candidateOrderLines as CandidateOrderLine[]) : []);
    } finally {
      setLoadingCandidates(false);
    }
  }

  function close() {
    setMode("closed");
    setSelectedOrderLineId("");
    setNote("");
    setError(null);
  }

  async function submitMatch() {
    const chosen = candidates.find((c) => c.orderLineId === selectedOrderLineId);
    if (!chosen) {
      setError("Choose an order line.");
      return;
    }
    if (!note.trim()) {
      setError("An explanation is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoice-reconciliation/lines/${lineId}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: chosen.orderId, orderLineId: chosen.orderLineId, note }),
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
      const response = await fetch(`/api/invoice-reconciliation/lines/${lineId}/cannot-link`, {
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
      const response = await fetch(`/api/invoice-reconciliation/lines/${lineId}/reopen`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: note }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to reopen this line.");
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
      <div className="flex justify-end gap-2">
        {matchStatus === "UNMATCHED" ? (
          <>
            <button onClick={openMatch} className="flex items-center gap-1 text-[11px] font-semibold text-[#173D2E] hover:underline">
              <Link2 size={12} />
              Match
            </button>
            <button onClick={() => setMode("cannotLink")} className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:underline">
              <Ban size={12} />
              Cannot link
            </button>
          </>
        ) : (
          <button onClick={() => setMode("reopen")} className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:underline">
            <RotateCcw size={12} />
            Reopen
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="w-[320px] rounded-lg border border-gray-200 bg-white p-3 text-left shadow-lg">
      {mode === "match" && (
        <>
          <p className="mb-2 text-[11px] font-semibold text-gray-600">Match to an order line</p>
          {!matchedCustomerId ? (
            <p className="text-[11px] text-amber-600">This invoice has no resolved customer to match against.</p>
          ) : loadingCandidates ? (
            <p className="text-[11px] text-gray-400">Loading candidate orders…</p>
          ) : candidates.length === 0 ? (
            <p className="text-[11px] text-gray-400">No outstanding authorized order lines for this customer.</p>
          ) : (
            <select
              value={selectedOrderLineId}
              onChange={(event) => setSelectedOrderLineId(event.target.value)}
              className="mb-2 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
            >
              <option value="">-- choose an order line --</option>
              {candidates.map((c) => (
                <option key={c.orderLineId} value={c.orderLineId}>
                  {c.orderReference} · {c.sapItemCodeSnapshot ?? "?"} · auth {c.authorizedQuantity} / inv {c.invoicedQuantity} / rem {c.remainingQuantity}
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
          <p className="mb-2 text-[11px] font-semibold text-gray-600">Mark as unlinkable to SalesFlow</p>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Why this line has nothing to do with SalesFlow (e.g. a walk-in/cash sale)"
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
          <p className="mb-2 text-[11px] font-semibold text-gray-600">Reopen this line</p>
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
