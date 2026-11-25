"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { setSelection, toggleSelection, useSelection } from "./selection-store";

export function RowCheckbox({ tableId, id, label }: { tableId: string; id: string; label: string }) {
  const selected = useSelection(tableId).includes(id);
  return <input type="checkbox" checked={selected} onChange={() => toggleSelection(tableId, id)} aria-label={`Select ${label}`} className="h-4 w-4 rounded border-[#C5CEC4] accent-[#1F7A4D]" />;
}

export function SelectAllCheckbox({ tableId, ids }: { tableId: string; ids: string[] }) {
  const selected = useSelection(tableId);
  const all = ids.length > 0 && ids.every((id) => selected.includes(id));
  return <input type="checkbox" checked={all} onChange={() => setSelection(tableId, all ? [] : ids)} aria-label="Select all rows on this page" className="h-4 w-4 rounded border-[#C5CEC4] accent-[#1F7A4D]" />;
}

export type BulkAction = {
  label: string;
  endpoint: string;
  /** Extra JSON merged into the request; the selected ids are sent as `ids`. */
  payload?: Record<string, unknown>;
  /** A select the administrator fills in (e.g. the new owner). */
  choice?: { name: string; label: string; options: { value: string; label: string }[] };
  /** Preview first: the endpoint is called with confirm:false, the result is shown, and only then is confirm:true sent. */
  preview?: boolean;
  destructive?: boolean;
};

type PlanItem = { id: string; label: string; fromUserName?: string | null; reason?: string };
type Preview = { eligible: PlanItem[]; skipped: PlanItem[] };

/** Appears when rows are selected. Bulk operations always preview what would change and need a reason before anything is written. */
export function BulkActionBar({ tableId, actions }: { tableId: string; actions: BulkAction[] }) {
  const ids = useSelection(tableId);
  const router = useRouter();
  const [active, setActive] = useState<BulkAction | null>(null);
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ids.length === 0 && !active) return null;
  const close = () => { setActive(null); setPreview(null); setChoice(""); setReason(""); setError(null); };

  async function call(confirm: boolean) {
    if (!active) return;
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { ...active.payload, ids: [...ids], reason, confirm };
      if (active.choice) body[active.choice.name] = choice;
      const res = await fetch(active.endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.success === false) { setError(typeof data.message === "string" ? data.message : "The operation was refused. Nothing was changed."); return; }
      if (!confirm && active.preview) {
        const plan = data.plan as { eligible: PlanItem[]; skipped: PlanItem[] } | undefined;
        setPreview({ eligible: plan?.eligible ?? [], skipped: plan?.skipped ?? [] });
        return;
      }
      toast.success(typeof data.applied === "number" ? `${data.applied} record(s) updated.` : "Done.");
      setSelection(tableId, []);
      close();
      router.refresh();
    } catch {
      setError("Network error. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const needsChoice = !!active?.choice && !choice;
  const reasonOk = reason.trim().length >= 3;
  return (
    <>
      <div className="sticky bottom-3 z-20 mx-auto flex w-fit max-w-full flex-wrap items-center gap-3 rounded-xl bg-[#14211B] px-4 py-2.5 text-sm text-white shadow-lg" role="region" aria-label="Bulk actions">
        <span className="font-medium tabular-nums">{ids.length} selected</span>
        {actions.map((a) => <button key={a.label} type="button" onClick={() => setActive(a)} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold hover:bg-white/20">{a.label}</button>)}
        <button type="button" onClick={() => setSelection(tableId, [])} className="text-xs text-white/70 hover:text-white">Clear</button>
      </div>
      {active ? (
        <div role="dialog" aria-modal="true" aria-label={active.label} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4" onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-semibold text-[#14211B]">{active.label} — {ids.length} record(s)</h3>
            {!preview ? (
              <div className="mt-4 space-y-3">
                {active.choice ? (
                  <label className="block text-xs font-semibold text-[#4B5B52]">{active.choice.label} *
                    <select value={choice} onChange={(e) => setChoice(e.target.value)} className="mt-1 w-full rounded-lg border border-[#D5DCD4] px-3 py-2 text-sm font-normal">{active.choice.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
                  </label>
                ) : null}
                <label className="block text-xs font-semibold text-[#4B5B52]">Reason (recorded in the audit log) *
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className="mt-1 w-full rounded-lg border border-[#D5DCD4] px-3 py-2 text-sm font-normal" />
                </label>
                <p className="text-xs text-[#6B7B72]">You will see exactly what would change before anything is written.</p>
              </div>
            ) : (
              <div className="mt-4 space-y-3 text-sm">
                <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900"><strong>{preview.eligible.length}</strong> will change{preview.skipped.length ? <>; <strong>{preview.skipped.length}</strong> will be skipped.</> : "."}</p>
                {preview.eligible.length ? <ul className="max-h-40 overflow-y-auto rounded-lg border border-[#E3E8E2] text-xs">{preview.eligible.slice(0, 50).map((i) => <li key={i.id} className="border-b border-[#EEF1ED] px-3 py-1.5 last:border-0">{i.label}{i.fromUserName !== undefined ? <span className="text-[#7A887F]"> · from {i.fromUserName ?? "unassigned"}</span> : null}</li>)}</ul> : null}
                {preview.skipped.length ? <div><p className="text-xs font-semibold text-amber-800">Skipped</p><ul className="max-h-32 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 text-xs">{preview.skipped.slice(0, 50).map((i) => <li key={i.id} className="border-b border-amber-100 px-3 py-1.5 last:border-0">{i.label} — {i.reason}</li>)}</ul></div> : null}
              </div>
            )}
            {error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={close} className="rounded-lg border border-[#D5DCD4] px-3 py-2 text-sm">Cancel</button>
              {!preview && active.preview ? (
                <button type="button" disabled={busy || needsChoice || !reasonOk} onClick={() => call(false)} className="rounded-lg bg-[#1F7A4D] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Checking…" : "Preview changes"}</button>
              ) : (
                <button type="button" disabled={busy || needsChoice || !reasonOk || (preview !== null && preview.eligible.length === 0)} onClick={() => call(true)} className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${active.destructive ? "bg-red-600" : "bg-[#1F7A4D]"}`}>{busy ? "Applying…" : `Confirm and apply${preview ? ` (${preview.eligible.length})` : ""}`}</button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
