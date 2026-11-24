"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, FileText, Loader2, Check, RotateCcw, Lock } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

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

type RecordedInvoice = {
  id: string;
  sapDocNum: string;
  invoiceDate: string | null;
  total: string | null;
  currencyCode: string | null;
  lineCount: number;
  state: "RECORDED" | "RESET";
  reset: { at: string | null; reason: string | null } | null;
  resetBlockers: string[];
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
  const [recorded, setRecorded] = useState<RecordedInvoice[]>([]);
  const [canReset, setCanReset] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [invoiceDate, setInvoiceDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [drafts, setDrafts] = useState<Record<string, LineDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  // A ref in addition to `submitting` state: two clicks in the same tick
  // both see submitting === false, the ref closes that window. The server
  // enforces the real guarantee (row lock + remaining-quantity check).
  const submitLock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState<string | null>(null);
  const [recordedInvoiceId, setRecordedInvoiceId] = useState<string | null>(null);

  const [resetTarget, setResetTarget] = useState<RecordedInvoice | null>(null);
  const [resetReason, setResetReason] = useState("");
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/orders/${orderId}/record-invoice`, { cache: "no-store" });
      const data = await readJson(response);
      if (response.ok && data.success === true) {
        const loaded = data.eligibility as Eligibility;
        setEligibility(loaded);
        setRecorded((data.recordedInvoices as RecordedInvoice[] | undefined) ?? []);
        setCanReset(data.canReset === true);
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
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    // Deferred so no setState runs synchronously in the effect body.
    const handle = setTimeout(() => {
      void load();
    }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  async function confirmReset() {
    if (!resetTarget || resetting) return;
    setResetting(true);
    setResetError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/record-invoice/${resetTarget.id}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: resetReason }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setResetError(typeof data.message === "string" ? data.message : "Unable to reset this invoice.");
        return;
      }
      toast.success("Invoice reset", { description: `${resetTarget.sapDocNum} has been voided and its quantity can be invoiced again.` });
      setResetTarget(null);
      setResetReason("");
      setSuccess(null);
      await load();
      router.refresh();
    } catch {
      setResetError("A network error occurred.");
    } finally {
      setResetting(false);
    }
  }

  function updateDraft(lineId: string, patch: Partial<LineDraft>) {
    setDrafts((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  async function submit() {
    if (!eligibility || submitLock.current) return;
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

    submitLock.current = true;
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
      await load();
      router.refresh();
    } catch {
      setError("A network error occurred.");
      toast.error("Network error", { description: "Could not reach the server. Check your connection and try again." });
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  const activeInvoices = recorded.filter((invoice) => invoice.state === "RECORDED");
  const hasRemaining = (eligibility?.lines.length ?? 0) > 0;
  // Nothing dispatched yet and nothing ever recorded: nothing to show.
  if (loading || !eligibility || (!hasRemaining && recorded.length === 0)) return null;

  return (
    <section className="rounded-xl border border-[#E8EBE6] bg-white">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex w-full items-center justify-between px-5 py-4 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-[#17251E]">
          <FileText size={16} className="text-[#315C43]" />
          {hasRemaining ? "Record Invoice" : "Invoice recorded"}
          {hasRemaining ? (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
              {eligibility.lines.length} line(s) dispatched, not yet invoiced
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
              <Check size={10} /> Completed
            </span>
          )}
        </span>
        {expanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>

      {expanded && (
        <div className="border-t border-[#E8EBE6] p-5">
          {recorded.length > 0 && (
            <ul className="mb-5 space-y-2" aria-label="Invoices recorded for this order">
              {recorded.map((invoice) => (
                <li key={invoice.id} className={`rounded-lg border p-3 text-xs ${invoice.state === "RESET" ? "border-gray-200 bg-gray-50 text-gray-500" : "border-emerald-200 bg-emerald-50/50"}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`font-semibold tabular-nums ${invoice.state === "RESET" ? "line-through" : "text-[#17251E]"}`}>{invoice.sapDocNum}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${invoice.state === "RESET" ? "bg-gray-200 text-gray-600" : "bg-emerald-100 text-emerald-700"}`}>
                      {invoice.state === "RESET" ? "Reset" : "Recorded"}
                    </span>
                    <span className="tabular-nums text-gray-500">
                      {invoice.invoiceDate ?? "—"} · {invoice.lineCount} line(s)
                      {invoice.total ? ` · ${invoice.currencyCode ?? ""} ${Number(invoice.total).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""}
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      {invoice.state === "RECORDED" && (
                        <Link href={`/invoice-reconciliation/${invoice.id}`} className="font-semibold text-[#173D2E] hover:underline">
                          Open invoice
                        </Link>
                      )}
                      {invoice.state === "RECORDED" && canReset && invoice.resetBlockers.length === 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            setResetTarget(invoice);
                            setResetReason("");
                            setResetError(null);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-red-200 px-2 py-1 font-semibold text-red-700 hover:bg-red-50"
                        >
                          <RotateCcw size={12} /> Reset
                        </button>
                      )}
                    </span>
                  </div>
                  {invoice.state === "RECORDED" && canReset && invoice.resetBlockers.length > 0 && (
                    <p className="mt-2 flex items-start gap-1.5 text-gray-500">
                      <Lock size={12} className="mt-0.5 shrink-0" />
                      Cannot be reset: {invoice.resetBlockers.join("; ")}.
                    </p>
                  )}
                  {invoice.state === "RESET" && invoice.reset?.reason && (
                    <p className="mt-1.5">Reset{invoice.reset.at ? ` on ${invoice.reset.at.slice(0, 10)}` : ""}: {invoice.reset.reason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}

          {!hasRemaining && (
            <p className="text-xs text-gray-500">
              Everything dispatched so far has been invoiced, so recording is disabled for this order.
              {activeInvoices.length > 0 && canReset ? " A Sales Manager or Administrator can reset an invoice to correct a mistake." : ""}
            </p>
          )}

          {hasRemaining && (<>
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
              disabled={submitting || !hasRemaining}
              className="flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
            >
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
              Record Invoice
            </button>
          </div>
          </>)}
        </div>
      )}

      <AlertDialog open={resetTarget !== null} onOpenChange={(open) => { if (!open && !resetting) setResetTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset invoice {resetTarget?.sapDocNum}?</AlertDialogTitle>
            <AlertDialogDescription>
              This voids the invoice recorded in SalesFlow and makes its quantities available to invoice again. The
              invoice stays visible here as &ldquo;Reset&rdquo; and the action is written to the audit history. It cannot be
              undone, but a new invoice can be recorded afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <label className="block text-xs font-medium text-gray-700">
            Reason (required)
            <textarea
              value={resetReason}
              onChange={(event) => setResetReason(event.target.value)}
              rows={3}
              maxLength={500}
              className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              placeholder="e.g. Wrong quantities entered"
            />
          </label>
          {resetError && <p role="alert" className="text-xs text-red-600">{resetError}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Keep invoice</AlertDialogCancel>
            <button
              type="button"
              onClick={confirmReset}
              disabled={resetting || resetReason.trim().length < 5}
              className="inline-flex items-center justify-center gap-1.5 rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {resetting ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
              Reset invoice
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
