"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type DialogField = {
  name: string;
  label: string;
  type: "text" | "select";
  defaultValue?: string;
  /** For selects. An empty value is sent as null. */
  options?: { value: string; label: string }[];
};

type Props = {
  label: string;
  title: string;
  description?: string;
  endpoint: string;
  method?: "POST" | "PATCH";
  /** Extra JSON merged with { reason }. */
  payload?: Record<string, unknown>;
  confirmLabel?: string;
  destructive?: boolean;
  /** Extra inputs, declared as plain data so server components can pass them (functions cannot cross the server/client boundary). */
  fields?: DialogField[];
  /** Called with the parsed response when the server accepted the change. */
  onDone?: (data: Record<string, unknown>) => void;
  variant?: "primary" | "secondary" | "danger";
};

/**
 * Confirmation dialog for an administrative mutation: always asks for a
 * reason (sent as `reason` and written to the audit trail), shows the
 * server's own validation message on failure, and refreshes the page data
 * on success. The server is the authority; this only collects the input.
 */
export function ActionDialog({ label, title, description, endpoint, method = "POST", payload = {}, confirmLabel = "Confirm", destructive, fields, onDone, variant = "secondary" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const valueOf = (f: DialogField) => extra[f.name] ?? f.defaultValue ?? "";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const btn = variant === "primary" ? "bg-[#1F7A4D] text-white hover:bg-[#186540]" : variant === "danger" ? "border border-red-200 text-red-700 hover:bg-red-50" : "border border-[#DDE3DC] text-[#17251E] hover:bg-[#F1F4F0]";

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...payload, ...Object.fromEntries((fields ?? []).map((f) => [f.name, valueOf(f) === "" ? null : valueOf(f)])), reason }) });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.success === false) {
        setError(typeof data.message === "string" ? data.message : "The change was not saved.");
        return;
      }
      onDone?.(data);
      if (!onDone) {
        setOpen(false);
        setReason("");
        router.refresh();
      }
    } catch {
      setError("Network error. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${btn}`}>{label}</button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#17251E]">{title}</h3>
            {description ? <p className="mt-1 text-sm text-[#5F6F66]">{description}</p> : null}
            <div className="mt-4 space-y-3">
              {fields?.map((f) => (
                <label key={f.name} className="block text-xs font-semibold text-[#4B5B52]">
                  {f.label}
                  {f.type === "select" ? (
                    <select value={valueOf(f)} onChange={(e) => setExtra((x) => ({ ...x, [f.name]: e.target.value }))} className="mt-1 w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal">
                      {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : (
                    <input value={valueOf(f)} onChange={(e) => setExtra((x) => ({ ...x, [f.name]: e.target.value }))} className="mt-1 w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal" />
                  )}
                </label>
              ))}
              <label className="block text-xs font-semibold text-[#4B5B52]">
                Reason (recorded in the audit log)
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className="mt-1 w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal" />
              </label>
              {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setOpen(false); setError(null); }} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm">Cancel</button>
              <button type="button" disabled={busy || reason.trim().length < 3} onClick={submit} className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${destructive ? "bg-red-600 hover:bg-red-700" : "bg-[#1F7A4D] hover:bg-[#186540]"}`}>
                {busy ? "Saving…" : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
