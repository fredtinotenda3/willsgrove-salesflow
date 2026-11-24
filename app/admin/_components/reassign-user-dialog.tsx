"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const TYPES = [["ORDER", "Orders"], ["QUOTATION", "Quotations"], ["CUSTOMER", "Customers"], ["CLAIM", "Claims"], ["MANAGEMENT_ACTION", "Management actions"]] as const;

/** Hand all of one person's open work to another active user: preview first, then confirm. */
export function ReassignUserDialog({ fromUserId, assignees }: { fromUserId: string; assignees: { id: string; name: string }[] }) {
  const router = useRouter();
  const [toUserId, setToUserId] = useState("");
  const [types, setTypes] = useState<Set<string>>(new Set(TYPES.map((t) => t[0])));
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Record<string, { eligible: number; skipped: number }> | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function call(confirm: boolean) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/admin/assignments/reassign-user", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromUserId, toUserId, entityTypes: [...types], reason, confirm }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) { setMsg({ kind: "err", text: data.message ?? "Failed." }); return; }
      if (!confirm) setPreview(data.perType ?? {});
      else { setPreview(null); setMsg({ kind: "ok", text: `Reassigned: ${Object.entries(data.perType as Record<string, number>).map(([k, v]) => `${v} ${k.toLowerCase().replace("_", " ")}`).join(", ") || "nothing"}.` }); router.refresh(); }
    } catch { setMsg({ kind: "err", text: "Network error. Nothing was changed." }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-xs">{TYPES.map(([id, label]) => <label key={id} className="flex items-center gap-1"><input type="checkbox" checked={types.has(id)} onChange={() => { setPreview(null); setTypes((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }} />{label}</label>)}</div>
      <select aria-label="Receiving user" value={toUserId} onChange={(e) => { setToUserId(e.target.value); setPreview(null); }} className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm"><option value="">Hand over to…</option>{assignees.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
      <input aria-label="Reason" value={reason} onChange={(e) => { setReason(e.target.value); setPreview(null); }} placeholder="Reason (audit log)" maxLength={500} className="w-full rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm" />
      {msg ? <p role={msg.kind === "err" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${msg.kind === "err" ? "bg-red-50 text-red-700" : "bg-green-50 text-green-800"}`}>{msg.text}</p> : null}
      {preview ? <ul className="rounded-lg border border-[#DDE3DC] p-3 text-xs">{Object.entries(preview).map(([k, v]) => <li key={k}>{k.replace("_", " ").toLowerCase()}: {v.eligible} will move{v.skipped ? `, ${v.skipped} skipped` : ""}</li>)}</ul> : null}
      <div className="flex gap-2">
        <button type="button" disabled={busy || !toUserId || types.size === 0 || reason.trim().length < 3} onClick={() => call(false)} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold disabled:opacity-50">Preview</button>
        <button type="button" disabled={busy || !preview} onClick={() => call(true)} className="rounded-lg bg-[#1F7A4D] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">Confirm handover</button>
      </div>
    </div>
  );
}
