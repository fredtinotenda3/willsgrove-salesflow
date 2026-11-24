"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ACTION_STATUS_LABELS, type ActionOperation, type ActionStatus } from "@/lib/management-intelligence/action-state";

type Assignee = { id: string; name: string; role: string };

type Props = {
  reportId: string;
  findingKey: string;
  status: ActionStatus;
  assignedToId: string | null;
  assignedToName: string | null;
  statusNote: string | null;
  assignees: Assignee[];
};

const STATUS_STYLE: Record<ActionStatus, string> = {
  OPEN: "bg-[#F4F6F4] text-[#52605A]",
  ACKNOWLEDGED: "bg-blue-50 text-blue-800",
  IN_PROGRESS: "bg-amber-50 text-amber-800",
  COMPLETED: "bg-emerald-50 text-emerald-800",
  DISMISSED: "bg-[#F4F6F4] text-[#718078]",
};

const btn = "rounded-lg border border-[#D8E0DA] bg-white px-3 py-1.5 text-xs font-semibold text-[#17251E] hover:bg-[#F4F6F4] disabled:opacity-50";

/**
 * Acknowledge / assign / progress / complete / dismiss for one finding.
 * Each press is one audited server call; completing or dismissing asks for
 * the outcome or reason, which the server requires. Nothing here marks
 * anything complete by itself.
 */
export function ActionControls({ reportId, findingKey, status, assignedToId, assignedToName, statusNote, assignees }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignee, setAssignee] = useState(assignedToId ?? "");
  const [note, setNote] = useState("");
  const [noteFor, setNoteFor] = useState<ActionOperation | null>(null);

  async function send(operation: ActionOperation, extra: { assigneeId?: string; note?: string } = {}) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/management-actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId, findingKey, operation, ...extra }),
      });
      const payload = (await response.json().catch(() => null)) as { success?: boolean; message?: string } | null;
      if (!response.ok || !payload?.success) {
        setError(payload?.message ?? "The action could not be updated.");
        return;
      }
      setNote("");
      setNoteFor(null);
      router.refresh();
    } catch {
      setError("The action could not be updated. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const closed = status === "COMPLETED" || status === "DISMISSED";

  return (
    <div className="mt-3 space-y-2 border-t border-[#EEF1ED] pt-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-semibold ${STATUS_STYLE[status]}`}>{ACTION_STATUS_LABELS[status]}</span>
        {assignedToName && <span className="text-[#52605A]">Owner: {assignedToName}</span>}
        {statusNote && closed && <span className="text-[#52605A]">Note: {statusNote}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {status === "OPEN" && (
          <button type="button" className={btn} disabled={busy} onClick={() => send("ACKNOWLEDGE")}>
            Acknowledge
          </button>
        )}
        {!closed && (
          <>
            <label className="sr-only" htmlFor={`assignee-${findingKey}`}>
              Assign to
            </label>
            <select id={`assignee-${findingKey}`} className="rounded-lg border border-[#D8E0DA] bg-white px-2 py-1.5 text-xs" value={assignee} onChange={(e) => setAssignee(e.target.value)} disabled={busy}>
              <option value="">Assign to…</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
            <button type="button" className={btn} disabled={busy || !assignee || assignee === assignedToId} onClick={() => send("ASSIGN", { assigneeId: assignee })}>
              Assign
            </button>
          </>
        )}
        {status === "ACKNOWLEDGED" && (
          <button type="button" className={btn} disabled={busy || !assignedToId} title={assignedToId ? undefined : "Assign an owner first"} onClick={() => send("START")}>
            Start
          </button>
        )}
        {(status === "ACKNOWLEDGED" || status === "IN_PROGRESS") && (
          <button type="button" className={btn} disabled={busy} onClick={() => setNoteFor("COMPLETE")}>
            Record outcome and complete
          </button>
        )}
        {!closed && (
          <button type="button" className={btn} disabled={busy} onClick={() => setNoteFor("DISMISS")}>
            Dismiss
          </button>
        )}
        {closed && (
          <button type="button" className={btn} disabled={busy} onClick={() => send("REOPEN")}>
            Reopen
          </button>
        )}
      </div>

      {noteFor && (
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[#52605A]" htmlFor={`note-${findingKey}`}>
            {noteFor === "COMPLETE" ? "What was the outcome?" : "Why is this being dismissed?"}
          </label>
          <textarea id={`note-${findingKey}`} className="w-full rounded-lg border border-[#D8E0DA] p-2 text-xs" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className={btn} disabled={busy || note.trim().length < 3} onClick={() => send(noteFor, { note })}>
              Confirm
            </button>
            <button type="button" className={btn} disabled={busy} onClick={() => setNoteFor(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
