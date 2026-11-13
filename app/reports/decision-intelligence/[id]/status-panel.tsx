"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Milestone 15 (Decision Intelligence), spec section 5. The one
 * mutating action this milestone exposes -- changing a recommendation's
 * lifecycle status -- isolated in its own client island, same split as
 * app/approvals/[id]/approval-actions-panel.tsx. `allowedNextStatuses`
 * is a UX convenience only (so the dropdown never offers an invalid
 * transition); the server re-validates every transition against
 * DECISION_RECOMMENDATION_STATUS_TRANSITIONS in
 * lib/reporting/decision-intelligence-queries.ts's
 * updateDecisionRecommendationStatus regardless of what this UI sends.
 */

type Props = {
  recommendationId: string;
  currentStatus: string;
  allowedNextStatuses: readonly string[];
  statusLabels: Record<string, string>;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function StatusPanel({ recommendationId, currentStatus, allowedNextStatuses, statusLabels }: Props) {
  const router = useRouter();
  const [nextStatus, setNextStatus] = useState<string>(allowedNextStatuses[0] ?? "");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!nextStatus) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/reports/decision-intelligence/recommendations/${recommendationId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus, note: note || undefined }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to update this recommendation's status.");
        return;
      }
      setNote("");
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  if (allowedNextStatuses.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-[#E7ECE7] bg-white p-5 shadow-sm md:p-6">
      <h2 className="font-bold text-[#17251E]">Update status</h2>
      <p className="mt-1 text-xs text-[#849087]">
        Current status: <span className="font-semibold text-[#17251E]">{statusLabels[currentStatus] ?? currentStatus}</span>. Every change is recorded in the status history below with your name and the time.
      </p>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-[#718078]">New status</span>
          <select value={nextStatus} onChange={(event) => setNextStatus(event.target.value)} className="h-[38px] w-full min-w-[180px] rounded-lg border border-[#E1E7E2] bg-white px-3 text-sm text-[#17251E] outline-none focus:border-[#78964A] sm:w-auto">
            {allowedNextStatuses.map((status) => (
              <option key={status} value={status}>
                {statusLabels[status] ?? status}
              </option>
            ))}
          </select>
        </label>

        <label className="block flex-1">
          <span className="mb-1.5 block text-xs font-medium text-[#718078]">Note (optional)</span>
          <input type="text" value={note} onChange={(event) => setNote(event.target.value)} maxLength={2000} className="h-[38px] w-full rounded-lg border border-[#E1E7E2] bg-white px-3 text-sm text-[#17251E] outline-none focus:border-[#78964A]" />
        </label>

        <button onClick={submit} disabled={submitting} className="flex h-10 items-center justify-center gap-2 rounded-xl bg-[#183B2D] px-4 text-sm font-semibold text-white transition hover:bg-[#24513D] disabled:opacity-50">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          Save
        </button>
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
    </section>
  );
}
