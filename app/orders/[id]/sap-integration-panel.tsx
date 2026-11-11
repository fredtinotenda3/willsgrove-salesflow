"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { ORDER_INTEGRATION_STATUS_LABELS } from "@/lib/integrations/sap/display";

/**
 * Milestone 9 (SAP Business One Integration). A self-contained,
 * additive panel on the order detail page -- entirely client-fetched
 * (GET /api/orders/[id]/sap-status on mount, then POST /sap-submit on
 * demand) so adding it to app/orders/[id]/page.tsx is a single import
 * plus a single JSX line, with zero changes to that page's own Server
 * Component data-fetching or layout. Mirrors app/orders/[id]/handover-
 * panel.tsx's own "self-fetching client island" shape.
 */

type StatusResponse = {
  status: string;
  blockers: string[];
  operation: {
    id: string;
    status: string;
    externalDocEntry: string | null;
    externalDocNum: string | null;
    lastErrorCategory: string | null;
    lastErrorMessage: string | null;
    attemptCount: number;
  } | null;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function SapIntegrationPanel({ orderId, canSubmit }: { orderId: string; canSubmit: boolean }) {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/sap-status`, { cache: "no-store" });
      const body = await readJson(response);
      if (response.ok && body.success === true) {
        setData(body.status as StatusResponse);
      }
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    // Same reasoning as app/orders/[id]/handover-panel.tsx's mount
    // effect: wrapping in Promise.resolve().then(...) rather than calling
    // load() directly avoids react-hooks/set-state-in-effect's "calling
    // setState synchronously within an effect" lint error, since load()
    // itself calls setState before any await.
    void Promise.resolve().then(() => load());
  }, [load]);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/sap-submit`, { method: "POST" });
      const body = await readJson(response);
      if (!response.ok || body.success !== true) {
        setError(typeof body.message === "string" ? body.message : "Unable to submit this order to SAP.");
        return;
      }
      await load();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <h2 className="text-[15px] font-bold text-[#17251E]">SAP Business One</h2>
        <p className="mt-2 flex items-center gap-2 text-xs text-gray-400">
          <Loader2 size={12} className="animate-spin" /> Checking status…
        </p>
      </section>
    );
  }

  if (!data) return null;

  const label = ORDER_INTEGRATION_STATUS_LABELS[data.status] ?? data.status;

  return (
    <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[15px] font-bold text-[#17251E]">SAP Business One</h2>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-semibold text-gray-600">{label}</span>
      </div>

      {data.status === "NOT_READY" && data.blockers.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-gray-500">
          {data.blockers.map((blocker, i) => (
            <li key={i}>• {blocker}</li>
          ))}
        </ul>
      )}

      {data.status === "SYNCED" && data.operation?.externalDocEntry && (
        <p className="mt-2 text-xs text-gray-500">
          SAP sales order {data.operation.externalDocNum ?? data.operation.externalDocEntry} (DocEntry {data.operation.externalDocEntry}).
        </p>
      )}

      {(data.status === "FAILED" || data.status === "REQUIRES_REVIEW") && data.operation?.lastErrorMessage && (
        <p className="mt-2 text-xs text-red-600">{data.operation.lastErrorMessage}</p>
      )}

      {data.status === "REQUIRES_REVIEW" && (
        <p className="mt-2 text-xs text-amber-700">
          Needs review on the <a href="/integrations/sap" className="underline">SAP Integration dashboard</a>.
        </p>
      )}

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

      {data.status === "READY" && canSubmit && (
        <button
          onClick={submit}
          disabled={submitting}
          className="mt-3 flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {submitting && <Loader2 size={12} className="animate-spin" />}
          Submit to SAP
        </button>
      )}
    </section>
  );
}
