"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Save } from "lucide-react";

/**
 * Milestone 5 (SAP Invoice Reconciliation). Invoice-level explanation of
 * its exceptions as a whole (spec section 7). Restricted to
 * SALES_MANAGER/ADMINISTRATOR at the page level (app/invoice-
 * reconciliation/[id]/page.tsx only renders this for those roles).
 */
export default function ReconciliationNoteForm({ invoiceId, initialNote }: { invoiceId: string; initialNote: string | null }) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/invoice-reconciliation/${invoiceId}/note`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note.trim() === "" ? null : note }),
      });
      const data: unknown = await response.json().catch(() => ({}));
      const body = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
      if (!response.ok || body.success !== true) {
        setError(typeof body.message === "string" ? body.message : "Unable to save this note.");
        return;
      }
      setNotice("Saved.");
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3">
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        rows={3}
        placeholder="Record an explanation for this invoice's exceptions, if any."
        className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
      />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      {notice && <p className="mt-1 text-xs text-emerald-600">{notice}</p>}
      <button
        onClick={save}
        disabled={saving}
        className="mt-2 flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
      >
        {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
        Save note
      </button>
    </div>
  );
}
