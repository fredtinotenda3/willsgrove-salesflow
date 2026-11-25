import type { ReactNode } from "react";
import { fmtDateTime, humanize } from "@/lib/admin/format";
import type { DeleteVerdict } from "@/lib/admin/deletion-policy";
import { EmptyState, Notice, Panel, Timeline } from "./ui";
import { ActionDialog } from "./action-dialog";

type AuditEventRow = { id: string; action: string; beforeData: unknown; afterData: unknown; createdAt: Date; actor: { name: string } | null };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const short = (v: unknown) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > 80 ? `${s.slice(0, 77)}…` : s; };

/** Readable audit history: who, what, when, the stated reason, the outcome and which fields changed from what to what. */
export function AuditTrail({ events, title = "Activity & audit trail" }: { events: AuditEventRow[]; title?: string }) {
  return (
    <Panel title={title} description="Every administrative change is recorded with the actor, reason and before/after values.">
      <div className="p-4">
        <Timeline empty="No administrative changes recorded for this record." items={events.map((e) => {
          const before = isObj(e.beforeData) ? e.beforeData : {};
          const after = isObj(e.afterData) ? e.afterData : {};
          const reason = typeof after.reason === "string" ? after.reason : null;
          const outcome = typeof after.outcome === "string" ? after.outcome : null;
          const keys = Object.keys({ ...before, ...after }).filter((k) => k !== "reason" && k !== "outcome" && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
          return {
            id: e.id,
            title: <>{humanize(e.action)}{outcome && outcome !== "SUCCESS" ? <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">{outcome}</span> : null}</>,
            meta: <>{e.actor?.name ?? "System"} · {fmtDateTime(e.createdAt)}</>,
            body: <>{reason ? <p>Reason: {reason}</p> : null}{keys.length ? <ul className="mt-1 space-y-0.5">{keys.slice(0, 8).map((k) => <li key={k}><span className="font-medium">{humanize(k)}:</span> {k in before ? <span className="text-[#849087] line-through">{short(before[k])}</span> : null}{k in before && k in after ? " → " : ""}{k in after ? short(after[k]) : null}</li>)}</ul> : null}</>,
          };
        })} />
      </div>
    </Panel>
  );
}

/** A compact read-only table for related records. Pass already-formatted cells. */
export function MiniTable({ head, rows, empty }: { head: string[]; rows: ReactNode[][]; empty: string }) {
  if (rows.length === 0) return <EmptyState compact message={empty} />;
  return (
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="bg-[#F7F8F6] text-xs uppercase tracking-wide text-[#849087]"><tr>{head.map((h) => <th key={h} className="whitespace-nowrap px-4 py-2 font-semibold">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-[#EEF1ED]">{r.map((c, j) => <td key={j} className="px-4 py-2 align-top">{c}</td>)}</tr>)}</tbody>
    </table></div>
  );
}

/**
 * The "delete or not" panel. It never shows a delete button that cannot work:
 * when the policy forbids deletion it explains exactly why and points to the
 * correct alternative (cancel / deactivate / archive). The server re-checks
 * everything inside the delete transaction regardless.
 */
export function DeleteSection({ verdict, noun, endpoint, confirmText, redirect, alternative, lines = [] }: { verdict: DeleteVerdict; noun: string; endpoint: string; confirmText: string; redirect: string; alternative: string; lines?: string[] }) {
  return (
    <Panel title={`Delete ${noun}`} description="Permanent removal is only offered when nothing else refers to the record.">
      <div className="space-y-3 p-4 text-sm">
        {verdict.deletable ? (
          <>
            <Notice tone="warn" title="This cannot be undone">No other record refers to this {noun}, so it can be removed. An audit event keeps a snapshot of what was deleted, who deleted it and why.{lines.length ? <ul className="mt-1 list-disc pl-5">{lines.map((l) => <li key={l}>{l}</li>)}</ul> : null}</Notice>
            <ActionDialog label={`Delete ${noun}…`} variant="danger" destructive title={`Delete ${confirmText}?`} description="Type the reference to confirm. Nothing that other records depend on is removed." endpoint={endpoint} method="DELETE" confirmText={confirmText} confirmLabel="Delete permanently" successHref={redirect} successMessage={`${noun[0].toUpperCase()}${noun.slice(1)} deleted.`} consequences={[`The ${noun} and its own sub-records are removed permanently.`, "An audit event records the deletion and your reason."]} />
          </>
        ) : (
          <>
            <Notice tone="info" title="Deletion is not available">{verdict.reason}</Notice>
            {verdict.blockers.length ? <ul className="flex flex-wrap gap-2">{verdict.blockers.map((b) => <li key={b.label} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{b.count} {b.label}</li>)}</ul> : null}
            <p className="text-[#5E6B63]">{alternative}</p>
          </>
        )}
      </div>
    </Panel>
  );
}
