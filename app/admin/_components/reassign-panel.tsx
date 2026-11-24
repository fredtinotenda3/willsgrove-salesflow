"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Row = { id: string; label: string; detail: string; ownerName: string | null; status: string; ageDays: number; href: string };
type Assignee = { id: string; name: string; role: string };
type Plan = { eligible: { id: string; label: string; fromUserName: string | null }[]; skipped: { id: string; label: string; reason: string }[]; toUserName: string };

/**
 * Selection + two-step bulk reassignment. Step 1 asks the server for a
 * preview (nothing is written); step 2 sends the same selection with
 * confirm=true. The server re-derives eligibility inside its transaction,
 * so anything that changed in between is skipped, never forced.
 */
export function ReassignPanel({ entityType, rows, assignees }: { entityType: string; rows: Row[]; assignees: Assignee[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [toUserId, setToUserId] = useState("");
  const [reason, setReason] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const toggle = (id: string) => { setPlan(null); setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }); };
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));

  async function call(confirm: boolean) {
    setBusy(true); setError(null); setDone(null);
    try {
      const res = await fetch("/api/admin/assignments/reassign", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType, ids: [...selected], toUserId, reason, confirm }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) { setError(data.message ?? "Reassignment failed."); return; }
      if (!confirm) setPlan(data.plan as Plan);
      else { setPlan(null); setSelected(new Set()); setDone(`${data.applied} reassigned${data.skipped?.length ? `, ${data.skipped.length} skipped` : ""}.`); router.refresh(); }
    } catch { setError("Network error. Nothing was changed."); } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]">
            <tr>
              <th className="px-4 py-2"><input type="checkbox" aria-label="Select all on this page" checked={allOnPage} onChange={() => { setPlan(null); setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id))); }} /></th>
              <th className="px-4 py-2">Record</th><th className="px-4 py-2">Customer / detail</th><th className="px-4 py-2">Current owner</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Idle</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-[#EEF1ED]">
                <td className="px-4 py-2"><input type="checkbox" aria-label={`Select ${r.label}`} checked={selected.has(r.id)} onChange={() => toggle(r.id)} /></td>
                <td className="px-4 py-2 font-medium"><Link href={r.href} className="text-[#1F7A4D] hover:underline">{r.label}</Link></td>
                <td className="px-4 py-2 text-[#5F6F66]">{r.detail}</td>
                <td className="px-4 py-2">{r.ownerName ?? <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Unassigned</span>}</td>
                <td className="px-4 py-2 text-xs">{r.status.replace(/_/g, " ")}</td>
                <td className="px-4 py-2 text-xs text-[#5F6F66]">{r.ageDays}d</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-3 border-t border-[#EEF1ED] p-4">
        <p className="text-xs text-[#5F6F66]">{selected.size} selected on this page. Only active users can receive work.</p>
        <div className="grid gap-3 md:grid-cols-3">
          <select aria-label="New owner" value={toUserId} onChange={(e) => { setToUserId(e.target.value); setPlan(null); }} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm">
            <option value="">Assign to…</option>
            {assignees.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.role.replace("_", " ").toLowerCase()})</option>)}
          </select>
          <input aria-label="Reason" value={reason} onChange={(e) => { setReason(e.target.value); setPlan(null); }} maxLength={500} placeholder="Reason (audit log)" className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm md:col-span-2" />
        </div>
        {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {done ? <p role="status" className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">{done}</p> : null}
        {plan ? (
          <div className="rounded-lg border border-[#DDE3DC] p-3 text-sm">
            <p className="font-semibold">Preview: {plan.eligible.length} will move to {plan.toUserName}{plan.skipped.length ? `, ${plan.skipped.length} will be skipped` : ""}.</p>
            {plan.skipped.length ? <ul className="mt-2 list-disc pl-5 text-xs text-[#5F6F66]">{plan.skipped.map((s) => <li key={s.id}>{s.label}: {s.reason}</li>)}</ul> : null}
          </div>
        ) : null}
        <div className="flex gap-2">
          <button type="button" disabled={busy || selected.size === 0 || !toUserId || reason.trim().length < 3} onClick={() => call(false)} className="rounded-lg border border-[#DDE3DC] px-3 py-2 text-sm font-semibold disabled:opacity-50">Preview</button>
          <button type="button" disabled={busy || !plan || plan.eligible.length === 0} onClick={() => call(true)} className="rounded-lg bg-[#1F7A4D] px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? "Working…" : `Confirm reassignment (${plan?.eligible.length ?? 0})`}</button>
        </div>
      </div>
    </div>
  );
}
