"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type DialogField = {
  name: string;
  label: string;
  type: "text" | "textarea" | "select" | "date" | "number";
  defaultValue?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  placeholder?: string;
};

type Props = {
  label: string;
  title: string;
  description?: string;
  endpoint: string;
  method?: "POST" | "PATCH" | "DELETE";
  /** Constant JSON merged into the body. */
  payload?: Record<string, unknown>;
  confirmLabel?: string;
  destructive?: boolean;
  /** Inputs declared as plain data so server components can pass them (functions cannot cross the server/client boundary). */
  fields?: DialogField[];
  /** Ask for an audit reason (default true). Create forms and legacy endpoints turn it off. */
  askReason?: boolean;
  /** How blank inputs are sent: null (admin APIs) or omitted (legacy APIs that use optional strings). */
  blank?: "null" | "omit";
  /** Navigate here on success; "{id}" is replaced by the id the server returned. */
  successHref?: string;
  onDone?: (data: Record<string, unknown>) => void;
  variant?: "primary" | "secondary" | "danger";
};

/**
 * Dialog for an administrative create / edit / status / delete. Collects the
 * declared fields (and an audit reason where wanted), shows the server's own
 * validation message on failure, refreshes the page on success. The server is
 * the authority; nothing here is trusted.
 */
export function ActionDialog({ label, title, description, endpoint, method = "POST", payload = {}, confirmLabel = "Confirm", destructive, fields = [], askReason = true, blank = "null", successHref, onDone, variant = "secondary" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [extra, setExtra] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const valueOf = (f: DialogField) => extra[f.name] ?? f.defaultValue ?? "";
  const btn = variant === "primary" ? "bg-[#1F7A4D] text-white hover:bg-[#186540]" : variant === "danger" ? "border border-red-200 text-red-700 hover:bg-red-50" : "border border-[#DDE3DC] text-[#17251E] hover:bg-[#F1F4F0]";
  const missingRequired = fields.some((f) => f.required && valueOf(f).trim() === "");
  const disabled = busy || missingRequired || (askReason && reason.trim().length < 3);

  async function submit() {
    setBusy(true);
    setError(null);
    setFieldErrors({});
    const body: Record<string, unknown> = { ...payload };
    for (const f of fields) {
      const v = valueOf(f);
      if (v === "") { if (blank === "null") body[f.name] = null; }
      else body[f.name] = f.type === "number" ? Number(v) : v;
    }
    if (askReason) body.reason = reason;
    const hasBody = Object.keys(body).length > 0;
    try {
      const res = await fetch(endpoint, { method, headers: hasBody ? { "Content-Type": "application/json" } : undefined, body: hasBody ? JSON.stringify(body) : undefined });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok || data.success === false) {
        setError(typeof data.message === "string" ? data.message : "The change was not saved.");
        if (data.fieldErrors && typeof data.fieldErrors === "object") setFieldErrors(data.fieldErrors as Record<string, string>);
        return;
      }
      if (onDone) { onDone(data); return; }
      setOpen(false);
      setReason("");
      setExtra({});
      const createdId = typeof data.id === "string" ? data.id : typeof (data.customer as { id?: unknown } | undefined)?.id === "string" ? ((data.customer as { id: string }).id) : null;
      if (successHref && createdId) router.push(successHref.replace("{id}", createdId));
      else router.refresh();
    } catch {
      setError("Network error. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  const control = "mt-1 w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-normal";
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${btn}`}>{label}</button>
      {open ? (
        <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="text-base font-bold text-[#17251E]">{title}</h3>
            {description ? <p className="mt-1 text-sm text-[#5F6F66]">{description}</p> : null}
            <div className="mt-4 space-y-3">
              {fields.map((f) => (
                <label key={f.name} className="block text-xs font-semibold text-[#4B5B52]">
                  {f.label}{f.required ? " *" : ""}
                  {f.type === "select" ? (
                    <select value={valueOf(f)} onChange={(e) => setExtra((x) => ({ ...x, [f.name]: e.target.value }))} className={control}>
                      {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : f.type === "textarea" ? (
                    <textarea value={valueOf(f)} rows={3} placeholder={f.placeholder} onChange={(e) => setExtra((x) => ({ ...x, [f.name]: e.target.value }))} className={control} />
                  ) : (
                    <input type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"} value={valueOf(f)} placeholder={f.placeholder} onChange={(e) => setExtra((x) => ({ ...x, [f.name]: e.target.value }))} className={control} />
                  )}
                  {fieldErrors[f.name] ? <span className="font-normal text-red-700">{fieldErrors[f.name]}</span> : null}
                </label>
              ))}
              {askReason ? (
                <label className="block text-xs font-semibold text-[#4B5B52]">
                  Reason (recorded in the audit log)
                  <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} className={control} />
                </label>
              ) : null}
              {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => { setOpen(false); setError(null); setFieldErrors({}); }} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm">Cancel</button>
              <button type="button" disabled={disabled} onClick={submit} className={`rounded-lg px-3 py-2 text-sm font-semibold text-white disabled:opacity-50 ${destructive ? "bg-red-600 hover:bg-red-700" : "bg-[#1F7A4D] hover:bg-[#186540]"}`}>
                {busy ? "Saving…" : confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
