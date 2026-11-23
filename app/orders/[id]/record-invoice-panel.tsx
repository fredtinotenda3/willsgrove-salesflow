"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, FileText, Loader2, Check } from "lucide-react";

/**
 * Real-world fix (native invoice recording) -- see lib/invoice-recording/
 * validation.ts's own comment for the full design this closes
 * (Delivered Orders / "No Claim, With Claim" being unreachable for an
 * order with no imported SAP invoice).
 *
 * Shown on the order detail page only once GET /api/orders/[id]/
 * record-invoice reports at least one line that's been dispatched but
 * not yet (fully) invoiced -- an order nothing has shipped on yet, or
 * one already fully invoiced, renders nothing here at all, never an
 * empty/disabled panel.
 */

type EligibilityLine = {
  orderLineId: string;
  lineNumber: number;
  description: string;
  sapItemCode: string | null;
  unitCode: string;
  dispatchedQuantity: string;
  alreadyInvoicedQuantity: string;
  remainingToInvoice: string;
  suggestedUnitPrice: string | null;
};

type Eligibility = {
  orderId: string;
  orderReference: string;
  currency: string;
  customerName: string;
  lines: EligibilityLine[];
};

type LineDraft = {
  include: boolean;
  quantityInvoiced: string;
  unitPrice: string;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function RecordInvoicePanel({ orderId }: { orderId: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [recordedInvoiceId, setRecordedInvoiceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const response = await fetch(`/api/orders/${orderId}/record-invoice`, { cache: "no-store" });
        const data = await readJson(response);
        if (cancelled) return;
        if (response.ok && data.success === true) {
          const loaded = data.eligibility as Eligibility;
          setEligibility(loaded);
          const initialDrafts: Record<string, LineDraft> = {};
          for (const line of loaded.lines) {
            initialDrafts[line.orderLineId] = {
              include: true,
              quantityInvoiced: line.remainingToInvoice,
              unitPrice: line.suggestedUnitPrice ?? "",
            };
          }
          setDrafts(initialDrafts);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  function updateDraft(lineId: string, patch: Partial<LineDraft>) {
    setDrafts((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  async function submit() {
    if (!eligibility) return;
    setError(null);
    setFieldErrors({});
    setSuccess(null);

    const lines = eligibility.lines
      .filter((line) => drafts[line.orderLineId]?.include)
      .map((line) => ({
        orderLineId: line.orderLineId,
        quantityInvoiced: drafts[line.orderLineId].quantityInvoiced,
        unitPrice: drafts[line.orderLineId].unitPrice,
      }));

    if (lines.length === 0) {
      setError("Select at least one line to invoice.");
      return;
    }
    if (lines.some((line) => !line.unitPrice.trim())) {
      setError("Every selected line needs a unit price -- this order has none on file to default to, so it must be entered by hand.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/orders/${orderId}/record-invoice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceDate, lines }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        const message = typeof data.message === "string" ? data.message : "Unable to record this invoice.";
        setError(message);
        toast.error(response.status === 403 ? "Permission denied." : "Unable to record invoice", { description: message });
        if (data.fieldErrors && typeof data.fieldErrors === "object") setFieldErrors(data.fieldErrors as Record<string, string>);
        return;
      }
      setSuccess(`Invoice ${data.sapDocNum as string} recorded.`);
      setRecordedInvoiceId(data.id as string);
      toast.success("Invoice recorded", { description: `${data.sapDocNum as string}` });
      router.refresh();
    } catch {
      setError("A network error occurred.");
      toast.error("Network error", { description: "Could not reach the server. Check your connection and try again." });
    } finally {
      setSubmitting(false);
    }
  }

  if (loading || !eligibility || eligibility.lines.length === 0) return null;

  return (
    <section className="rounded-xl border border-[#E8EBE6] bg-white">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[#17251E]">
          <FileText size={16} className="text-[#315C43]" />
          Record Invoice
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
            {eligibility.lines.length} line(s) dispatched, not yet invoiced
          </span>
        </span>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-[#E8EBE6] p-5">
          <p className="text-xs text-gray-500">
            Records this order as invoiced directly in SalesFlow -- for the normal case where no SAP invoice file has
            been (or will be) imported for it. Once recorded, this order appears on the Delivered Orders page and a
            delivery outcome (No Claim / With Claim) can be recorded against it, exactly as for a SAP-imported
            invoice. Only lines that have actually been dispatched can be invoiced, up to what&apos;s still
            outstanding on each.
          </p>

          <div className="mt-4">
            <label className="text-xs font-medium text-gray-600">Invoice date</label>
            <input
              type="date"
              value={invoiceDate}
              onChange={(event) => setInvoiceDate(event.target.value)}
              className="mt-1 block w-44 rounded-lg border border-gray-200 px-2 py-1.5 text-xs"
            />
          </div>

          <div className="mt-4 space-y-2">
            {eligibility.lines.map((line) => {
              const draft = drafts[line.orderLineId];
              if (!draft) return null;
              return (
                <div key={line.orderLineId} className={`rounded-lg border p-3 text-xs ${draft.include ? "border-[#173D2E]/30 bg-[#173D2E]/[0.02]" : "border-gray-100"}`}>
                  <label className="flex items-center gap-2 font-semibold text-gray-700">
                    <input
                      type="checkbox"
                      checked={draft.include}
                      onChange={(event) => updateDraft(line.orderLineId, { include: event.target.checked })}
                    />
                    Line {line.lineNumber} -- {line.sapItemCode ?? "?"} ({line.description})
                    <span className="ml-auto font-normal text-gray-400">
                      Dispatched {line.dispatchedQuantity} {line.unitCode}
                      {Number(line.alreadyInvoicedQuantity) > 0 ? ` -- ${line.alreadyInvoicedQuantity} already invoiced` : ""}
                    </span>
                  </label>

                  {draft.include && (
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <label className="space-y-1">
                        <span className="font-medium text-gray-600">Quantity invoiced (max {line.remainingToInvoice})</span>
                        <input
                          value={draft.quantityInvoiced}
                          onChange={(event) => updateDraft(line.orderLineId, { quantityInvoiced: event.target.value })}
                          className="w-full rounded-lg border border-gray-200 px-2 py-1.5"
                        />
                      </label>
                      <label className="space-y-1">
                        <span className="font-medium text-gray-600">Unit price ({eligibility.currency})</span>
                        <input
                          value={draft.unitPrice}
                          onChange={(event) => updateDraft(line.orderLineId, { unitPrice: event.target.value })}
                          placeholder={line.suggestedUnitPrice ? undefined : "No price on file -- enter one"}
                          className="w-full rounded-lg border border-gray-200 px-2 py-1.5"
                        />
                      </label>
                      {fieldErrors[`lines.${eligibility.lines.findIndex((l) => l.orderLineId === line.orderLineId)}`] && (
                        <p className="col-span-2 text-red-600">
                          {fieldErrors[`lines.${eligibility.lines.findIndex((l) => l.orderLineId === line.orderLineId)}`]}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {error && <p className="mt-3 text-xs text-red-600">{error}</p>}
          {success && (
            <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs">
              <p className="flex items-center gap-1.5 font-semibold text-emerald-700">
                <Check size={14} />
                {success}
              </p>
              {recordedInvoiceId && (
                <Link href={`/invoice-reconciliation/${recordedInvoiceId}`} className="mt-1 inline-block font-semibold text-[#173D2E] hover:underline">
                  Record delivery outcome (No Claim / With Claim) for this invoice &rarr;
                </Link>
              )}
            </div>
          )}

          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              Record Invoice
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
