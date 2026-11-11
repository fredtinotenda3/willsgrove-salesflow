"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Milestone 9 (SAP Business One Integration). Two small client islands
 * sharing one file (same "mutating actions as a client island next to a
 * Server Component page" split as app/approvals/[id]/approval-actions-
 * panel.tsx):
 *   - "trigger-sync": the dashboard's manual "Sync now" buttons.
 *   - "operation-actions": retry/reconcile/resolve for one FAILED/
 *     UNCERTAIN IntegrationOperation row.
 * The server is always the real authority on what each action may do;
 * these buttons only control what this UI offers.
 */

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const SYNC_JOBS: { slug: string; label: string }[] = [
  { slug: "products", label: "Sync products" },
  { slug: "customers", label: "Sync customers" },
  { slug: "invoices", label: "Sync invoices" },
  { slug: "credit-notes", label: "Sync credit notes" },
];

type Props =
  | { mode: "trigger-sync" }
  | { mode: "operation-actions"; operationId: string; status: string; canResolve: boolean };

export default function SapOperationsPanel(props: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [confirmedCreated, setConfirmedCreated] = useState(false);
  const [notes, setNotes] = useState("");
  const [sapDocEntry, setSapDocEntry] = useState("");
  const [sapDocNum, setSapDocNum] = useState("");

  async function post(path: string, body?: Record<string, unknown>) {
    setError(null);
    setBusy(path);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "The request failed.");
        return;
      }
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setBusy(null);
    }
  }

  if (props.mode === "trigger-sync") {
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          {SYNC_JOBS.map((job) => (
            <button
              key={job.slug}
              onClick={() => post(`/api/integrations/sap/sync/${job.slug}`)}
              disabled={busy !== null}
              className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              {busy === `/api/integrations/sap/sync/${job.slug}` && <Loader2 size={12} className="animate-spin" />}
              {job.label}
            </button>
          ))}
        </div>
        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  const { operationId, status, canResolve } = props;

  if (status === "FAILED") {
    return (
      <div>
        <button
          onClick={() => post(`/api/integrations/sap/operations/${operationId}/retry`)}
          disabled={busy !== null}
          className="flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {busy && <Loader2 size={12} className="animate-spin" />}
          Retry
        </button>
        {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
      </div>
    );
  }

  if (status === "UNCERTAIN") {
    return (
      <div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => post(`/api/integrations/sap/operations/${operationId}/reconcile`)}
            disabled={busy !== null || !canResolve}
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy?.includes("reconcile") && <Loader2 size={12} className="animate-spin" />}
            Look up in SAP
          </button>
          {canResolve && (
            <button
              onClick={() => setResolving((v) => !v)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              Resolve manually
            </button>
          )}
        </div>
        {!canResolve && <p className="mt-1 text-[11px] text-gray-400">Only an administrator can resolve this manually.</p>}
        {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}

        {resolving && (
          <div className="mt-3 max-w-sm space-y-2 rounded-lg border border-amber-100 bg-amber-50/40 p-3">
            <p className="text-[11px] text-gray-600">
              Only use this after checking directly in SAP whether this order was actually created. Never guess.
            </p>
            <div className="flex gap-3 text-[11px] text-gray-600">
              <label className="flex items-center gap-1">
                <input type="radio" checked={!confirmedCreated} onChange={() => setConfirmedCreated(false)} /> Not created in SAP
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={confirmedCreated} onChange={() => setConfirmedCreated(true)} /> Was created in SAP
              </label>
            </div>

            {confirmedCreated ? (
              <div className="space-y-1.5">
                <input
                  value={sapDocEntry}
                  onChange={(e) => setSapDocEntry(e.target.value)}
                  placeholder="SAP DocEntry"
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                />
                <input
                  value={sapDocNum}
                  onChange={(e) => setSapDocNum(e.target.value)}
                  placeholder="SAP DocNum"
                  className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                />
              </div>
            ) : (
              <label className="block text-xs font-medium text-gray-600">
                What did you find in SAP?
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. Confirmed: no sales order with this reference exists in SAP."
                  className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
                />
              </label>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={() => setResolving(false)} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">
                Cancel
              </button>
              <button
                onClick={() => {
                  if (confirmedCreated) {
                    if (!sapDocEntry.trim() || !sapDocNum.trim()) {
                      setError("Enter the SAP DocEntry and DocNum you found before resolving this.");
                      return;
                    }
                    post(`/api/integrations/sap/operations/${operationId}/resolve`, { confirmedCreated: true, sapDocEntry, sapDocNum });
                    return;
                  }
                  if (!notes.trim()) {
                    setError("Describe what you confirmed in SAP before resolving this.");
                    return;
                  }
                  post(`/api/integrations/sap/operations/${operationId}/resolve`, { confirmedCreated: false, notes });
                }}
                disabled={busy !== null}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50 ${confirmedCreated ? "bg-emerald-600" : "bg-red-600"}`}
              >
                {confirmedCreated ? "Confirm: created in SAP" : "Confirm: not created in SAP"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
}
