"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = { settingKey: string; label: string; description: string; unit: string; min: number; max: number; value: number; defaultValue: number; effect: string; changedBy: string | null };

export function SettingRow({ settingKey, label, description, unit, min, max, value, defaultValue, effect, changedBy }: Props) {
  const router = useRouter();
  const [draft, setDraft] = useState(String(value));
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = draft !== String(value);

  async function save(reset: boolean) {
    setBusy(true); setError(null); setSaved(false);
    try {
      const num = Number(draft);
      const res = await fetch("/api/admin/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: settingKey, value: reset ? null : num, reason }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) { setError(data.message ?? "Not saved."); return; }
      setSaved(true); setReason(""); router.refresh();
    } catch { setError("Network error. Nothing was changed."); } finally { setBusy(false); }
  }

  return (
    <div className="grid gap-2 border-t border-[#EEF1ED] px-4 py-3 md:grid-cols-[1fr_auto] md:items-start">
      <div>
        <p className="text-sm font-semibold text-[#17251E]">{label}</p>
        <p className="text-xs text-[#5F6F66]">{description}</p>
        <p className="mt-1 text-[11px] text-[#9AA59E]">Applies to: {effect} · Allowed {min}–{max} {unit === "percent" ? "%" : unit} · Default {defaultValue}{changedBy ? ` · Last changed by ${changedBy}` : ""}</p>
        {error ? <p role="alert" className="mt-1 text-xs text-red-700">{error}</p> : null}
        {saved ? <p role="status" className="mt-1 text-xs text-green-800">Saved.</p> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input aria-label={label} inputMode="numeric" value={draft} onChange={(e) => { setDraft(e.target.value); setSaved(false); }} className="w-20 rounded-lg border border-[#DDE3DC] px-2 py-1.5 text-sm" />
        <input aria-label={`Reason for changing ${label}`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" maxLength={500} className="w-44 rounded-lg border border-[#DDE3DC] px-2 py-1.5 text-sm" />
        <button type="button" disabled={busy || !dirty || reason.trim().length < 3} onClick={() => save(false)} className="rounded-lg bg-[#1F7A4D] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">Save</button>
        {value !== defaultValue ? <button type="button" disabled={busy || reason.trim().length < 3} onClick={() => save(true)} className="rounded-lg border border-[#DDE3DC] px-3 py-1.5 text-xs font-semibold disabled:opacity-50">Reset</button> : null}
      </div>
    </div>
  );
}
