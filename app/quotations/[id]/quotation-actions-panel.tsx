"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, Plus, Trash2, Pencil } from "lucide-react";

/**
 * Milestone 7. Every mutating quotation action, as one client-rendered
 * island (same split as app/invoice-claims/[id]/claim-actions-panel.tsx):
 * DRAFT line editing (add/update/remove), issue, record customer
 * response, cancel, revise, convert to order, mark expired, and
 * follow-up scheduling. Re-fetches via router.refresh() after every
 * successful action rather than guessing at the new state -- the server
 * is always the authority on what transitioned and what didn't.
 */

type LineRow = {
  id: string;
  lineNumber: number;
  isUnlistedItem: boolean;
  sapItemCodeSnapshot: string | null;
  unlistedItemDescription: string | null;
  quantity: string;
  unitOfMeasure: string | null;
  unitPrice: string;
  discountPercent: string | null;
  notes: string | null;
};

type ProductSuggestion = { id: string; itemName: string; sapItemCode: string | null };

type LineFormState = {
  isUnlistedItem: boolean;
  productQuery: string;
  productId: string | null;
  unlistedItemDescription: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  discountPercent: string;
  notes: string;
};

function emptyLineForm(): LineFormState {
  return { isUnlistedItem: false, productQuery: "", productId: null, unlistedItemDescription: "", quantity: "", unitOfMeasure: "", unitPrice: "", discountPercent: "", notes: "" };
}

function lineRowToForm(line: LineRow): LineFormState {
  return {
    isUnlistedItem: line.isUnlistedItem,
    productQuery: line.sapItemCodeSnapshot ?? "",
    productId: null, // re-selecting a catalogued line's product is required on edit -- never assumed unchanged
    unlistedItemDescription: line.unlistedItemDescription ?? "",
    quantity: line.quantity,
    unitOfMeasure: line.unitOfMeasure ?? "",
    unitPrice: line.unitPrice,
    discountPercent: line.discountPercent ?? "",
    notes: line.notes ?? "",
  };
}

function lineFormToPayload(form: LineFormState): Record<string, unknown> {
  return form.isUnlistedItem
    ? {
        isUnlistedItem: true,
        unlistedItemDescription: form.unlistedItemDescription.trim(),
        quantity: form.quantity.trim(),
        unitOfMeasure: form.unitOfMeasure || undefined,
        unitPrice: form.unitPrice.trim(),
        discountPercent: form.discountPercent || undefined,
        notes: form.notes || undefined,
      }
    : {
        isUnlistedItem: false,
        productId: form.productId,
        quantity: form.quantity.trim(),
        unitOfMeasure: form.unitOfMeasure || undefined,
        unitPrice: form.unitPrice.trim(),
        discountPercent: form.discountPercent || undefined,
        notes: form.notes || undefined,
      };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

type Props = {
  quotationId: string;
  status: string;
  lineCount: number;
  isSuperseded: boolean;
  hasConvertedOrder: boolean;
  eligibleForExpiry: boolean;
  currency: string;
  nextFollowUpDate: string | null;
  followUpNotes: string | null;
  lines: LineRow[];
};

const REVISABLE_STATUSES = new Set(["ISSUED", "ACCEPTED", "REJECTED", "EXPIRED"]);

export default function QuotationActionsPanel({
  quotationId,
  status,
  lineCount,
  isSuperseded,
  hasConvertedOrder,
  eligibleForExpiry,
  nextFollowUpDate,
  followUpNotes,
  lines,
}: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Milestone 8. Set only when /issue is blocked because this quotation's
  // discount exceeds a configured threshold -- lib/quotations/issue.ts's
  // gate returns the newly-created (or already-pending) approval
  // request's id alongside its 403, so this panel can link straight to
  // it instead of leaving the salesperson to guess what happened.
  const [blockedApprovalId, setBlockedApprovalId] = useState<string | null>(null);
  const [section, setSection] = useState<
    "closed" | "addLine" | "editLine" | "respond" | "cancel" | "revise" | "convert" | "followUp"
  >("closed");
  const [editingLineId, setEditingLineId] = useState<string | null>(null);

  const [lineForm, setLineForm] = useState<LineFormState>(emptyLineForm());
  const [suggestions, setSuggestions] = useState<ProductSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  const [decision, setDecision] = useState<"ACCEPTED" | "REJECTED">("ACCEPTED");
  const [responseNotes, setResponseNotes] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [customerResponseReference, setCustomerResponseReference] = useState("");

  const [cancellationReason, setCancellationReason] = useState("");
  const [reviseReason, setReviseReason] = useState("");

  const [customerPoReference, setCustomerPoReference] = useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = useState("");

  const [followUpDate, setFollowUpDate] = useState(nextFollowUpDate ?? "");
  const [followUpNotesInput, setFollowUpNotesInput] = useState(followUpNotes ?? "");

  function close() {
    setSection("closed");
    setError(null);
    setEditingLineId(null);
    setLineForm(emptyLineForm());
  }

  function searchProducts(value: string) {
    setLineForm((prev) => ({ ...prev, productQuery: value }));
    setShowSuggestions(true);
    if (value.trim() === "") {
      setSuggestions([]);
      return;
    }
    fetch(`/api/products?search=${encodeURIComponent(value.trim())}&pageSize=6`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setSuggestions((data.products ?? []).map((p: ProductSuggestion) => ({ id: p.id, itemName: p.itemName, sapItemCode: p.sapItemCode })));
      })
      .catch(() => {});
  }

  function selectProduct(product: ProductSuggestion) {
    setLineForm((prev) => ({ ...prev, productId: product.id, productQuery: product.itemName }));
    setSuggestions([]);
    setShowSuggestions(false);
  }

  async function submitAddLine() {
    if (!lineForm.isUnlistedItem && !lineForm.productId) {
      setError("Select a SAP product, or mark this as an unlisted item.");
      return;
    }
    if (lineForm.isUnlistedItem && !lineForm.unlistedItemDescription.trim()) {
      setError("An unlisted item needs a description.");
      return;
    }
    if (!lineForm.quantity.trim() || !lineForm.unitPrice.trim()) {
      setError("Quantity and unit price are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/lines`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lineFormToPayload(lineForm)),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to add this line.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  function startEditLine(line: LineRow) {
    setEditingLineId(line.id);
    setLineForm(lineRowToForm(line));
    setSection("editLine");
    setError(null);
  }

  async function submitEditLine() {
    if (!editingLineId) return;
    if (!lineForm.isUnlistedItem && !lineForm.productId) {
      setError("Re-select the SAP product for this line (it is not carried over automatically when editing).");
      return;
    }
    if (lineForm.isUnlistedItem && !lineForm.unlistedItemDescription.trim()) {
      setError("An unlisted item needs a description.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/lines/${editingLineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(lineFormToPayload(lineForm)),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to update this line.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function removeLine(lineId: string) {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/lines/${lineId}`, { method: "DELETE" });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to remove this line.");
        return;
      }
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitIssue() {
    setSubmitting(true);
    setError(null);
    setBlockedApprovalId(null);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/issue`, { method: "POST" });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to issue this quotation.");
        if (typeof data.approvalRequestId === "string") {
          setBlockedApprovalId(data.approvalRequestId);
        }
        return;
      }
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRespond() {
    if (decision === "REJECTED" && !rejectionReason.trim()) {
      setError("A rejection reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body =
        decision === "ACCEPTED"
          ? { decision, responseNotes: responseNotes || undefined, customerResponseReference: customerResponseReference || undefined }
          : { decision, rejectionReason, responseNotes: responseNotes || undefined };
      const response = await fetch(`/api/quotations/${quotationId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to record this response.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitCancel() {
    if (!cancellationReason.trim()) {
      setError("A cancellation reason is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancellationReason }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to cancel this quotation.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRevise() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/revise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reviseReason || undefined }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to revise this quotation.");
        return;
      }
      router.push(`/quotations/${data.id as string}`);
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitConvert() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/convert-to-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerPoReference: customerPoReference || undefined,
          requestedDeliveryDate: requestedDeliveryDate || undefined,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to convert this quotation into an order.");
        return;
      }
      router.push(`/orders/${data.orderId as string}`);
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitExpire() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/expire`, { method: "POST" });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to expire this quotation.");
        return;
      }
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitFollowUp() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/quotations/${quotationId}/follow-up`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nextFollowUpDate: followUpDate || null, followUpNotes: followUpNotesInput || null }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to update the follow-up schedule.");
        return;
      }
      close();
      router.refresh();
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  const isDraft = status === "DRAFT";
  const isIssued = status === "ISSUED";
  const isAccepted = status === "ACCEPTED";
  const canCancel = !isSuperseded && !hasConvertedOrder && status !== "CANCELLED" && status !== "REJECTED";
  const canRevise = REVISABLE_STATUSES.has(status) && !isSuperseded;
  const canConvert = isAccepted && !hasConvertedOrder;
  const canFollowUp = status !== "CANCELLED";

  function renderLineForm(onSubmit: () => void, submitLabel: string) {
    return (
      <div className="mt-4 max-w-2xl space-y-2 rounded-lg border border-gray-100 p-3">
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
          <input
            type="checkbox"
            checked={lineForm.isUnlistedItem}
            onChange={(event) => setLineForm((prev) => ({ ...prev, isUnlistedItem: event.target.checked, productId: null, productQuery: "" }))}
          />
          Unlisted / requested item
        </label>

        {lineForm.isUnlistedItem ? (
          <label className="block text-xs font-medium text-gray-600">
            Description *
            <input value={lineForm.unlistedItemDescription} onChange={(event) => setLineForm((prev) => ({ ...prev, unlistedItemDescription: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
        ) : (
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600">
              SAP product (search by code, name or barcode) *
              <input value={lineForm.productQuery} onChange={(event) => searchProducts(event.target.value)} onFocus={() => setShowSuggestions(true)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
            </label>
            {showSuggestions && suggestions.length > 0 && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-100 bg-white shadow-lg">
                {suggestions.map((product) => (
                  <button key={product.id} type="button" onClick={() => selectProduct(product)} className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50">
                    <p className="font-medium text-gray-700">{product.itemName}</p>
                    {product.sapItemCode && <p className="text-[10px] text-gray-400">{product.sapItemCode}</p>}
                  </button>
                ))}
              </div>
            )}
            {lineForm.productId && <p className="text-[10px] text-green-600">Product selected.</p>}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs font-medium text-gray-600">
            Quantity *
            <input value={lineForm.quantity} onChange={(event) => setLineForm((prev) => ({ ...prev, quantity: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Unit
            <input value={lineForm.unitOfMeasure} onChange={(event) => setLineForm((prev) => ({ ...prev, unitOfMeasure: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Unit price *
            <input value={lineForm.unitPrice} onChange={(event) => setLineForm((prev) => ({ ...prev, unitPrice: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Discount % (optional)
            <input value={lineForm.discountPercent} onChange={(event) => setLineForm((prev) => ({ ...prev, discountPercent: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
        </div>
        <label className="block text-xs font-medium text-gray-600">
          Notes (optional)
          <input value={lineForm.notes} onChange={(event) => setLineForm((prev) => ({ ...prev, notes: event.target.value }))} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
        </label>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
          <button onClick={onSubmit} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
            {submitting && <Loader2 size={12} className="animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
      <h2 className="text-sm font-bold text-[#17251E]">Actions</h2>

      <div className="mt-3 flex flex-wrap gap-2">
        {isDraft && (
          <button onClick={() => { setLineForm(emptyLineForm()); setSection(section === "addLine" ? "closed" : "addLine"); }} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            <Plus size={13} />
            Add line
          </button>
        )}
        {isDraft && (
          <button onClick={submitIssue} disabled={submitting || lineCount === 0} title={lineCount === 0 ? "Add at least one line first" : undefined} className="rounded-lg bg-[#173D2E] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
            Issue to customer
          </button>
        )}
        {isIssued && (
          <button onClick={() => setSection(section === "respond" ? "closed" : "respond")} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Record customer response
          </button>
        )}
        {eligibleForExpiry && (
          <button onClick={submitExpire} disabled={submitting} className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">
            Mark expired
          </button>
        )}
        {canFollowUp && (
          <button onClick={() => setSection(section === "followUp" ? "closed" : "followUp")} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Follow-up schedule
          </button>
        )}
        {canRevise && (
          <button onClick={() => setSection(section === "revise" ? "closed" : "revise")} className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50">
            Create revision
          </button>
        )}
        {canConvert && (
          <button onClick={() => setSection(section === "convert" ? "closed" : "convert")} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
            Convert to order
          </button>
        )}
        {canCancel && (
          <button onClick={() => setSection(section === "cancel" ? "closed" : "cancel")} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50">
            Cancel quotation
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 text-xs text-red-600">
          {error}
          {blockedApprovalId && (
            <>
              {" "}
              <Link href={`/approvals/${blockedApprovalId}`} className="font-semibold underline">
                View the approval request &rarr;
              </Link>
            </>
          )}
        </p>
      )}

      {section === "addLine" && renderLineForm(submitAddLine, "Add line")}
      {section === "editLine" && renderLineForm(submitEditLine, "Save line")}

      {isDraft && lines.length > 0 && (
        <div className="mt-4 space-y-1.5">
          <p className="text-[11px] font-semibold text-gray-500">Existing lines (DRAFT -- editable)</p>
          {lines.map((line) => (
            <div key={line.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs">
              <span className="text-gray-600">
                #{line.lineNumber} -- {line.isUnlistedItem ? line.unlistedItemDescription : line.sapItemCodeSnapshot} ({line.quantity} {line.unitOfMeasure ?? ""} @ {line.unitPrice})
              </span>
              <span className="flex items-center gap-2">
                <button onClick={() => startEditLine(line)} className="text-gray-400 hover:text-[#173D2E]">
                  <Pencil size={13} />
                </button>
                <button onClick={() => removeLine(line.id)} className="text-gray-300 hover:text-red-600">
                  <Trash2 size={13} />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {section === "respond" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <div className="flex items-center gap-4 text-xs">
            <label className="flex items-center gap-1"><input type="radio" checked={decision === "ACCEPTED"} onChange={() => setDecision("ACCEPTED")} /> Accepted</label>
            <label className="flex items-center gap-1"><input type="radio" checked={decision === "REJECTED"} onChange={() => setDecision("REJECTED")} /> Rejected</label>
          </div>
          {decision === "REJECTED" && (
            <label className="block text-xs font-medium text-gray-600">
              Rejection reason *
              <textarea value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
            </label>
          )}
          {decision === "ACCEPTED" && (
            <label className="block text-xs font-medium text-gray-600">
              Customer&rsquo;s reference (optional)
              <input value={customerResponseReference} onChange={(event) => setCustomerResponseReference(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
            </label>
          )}
          <label className="block text-xs font-medium text-gray-600">
            Notes (optional)
            <textarea value={responseNotes} onChange={(event) => setResponseNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <p className="text-[10px] text-gray-400">This records a fact reported by the customer -- it never creates an order or any SAP/financial record by itself.</p>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={submitRespond} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Record response
            </button>
          </div>
        </div>
      )}

      {section === "cancel" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <label className="block text-xs font-medium text-gray-600">
            Cancellation reason *
            <textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Back</button>
            <button onClick={submitCancel} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-red-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Cancel quotation
            </button>
          </div>
        </div>
      )}

      {section === "revise" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <p className="text-[11px] text-gray-500">Creates a new DRAFT revision, copying this quotation&rsquo;s header and lines exactly. This revision will be superseded but its history stays visible.</p>
          <label className="block text-xs font-medium text-gray-600">
            Reason (optional)
            <textarea value={reviseReason} onChange={(event) => setReviseReason(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={submitRevise} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Create revision
            </button>
          </div>
        </div>
      )}

      {section === "convert" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-emerald-100 bg-emerald-50/40 p-3">
          <p className="text-[11px] text-gray-600">Creates a real customer order from this quotation&rsquo;s lines. Safe to click only once -- clicking again (or a duplicate request) returns the same order rather than creating a second one.</p>
          <label className="block text-xs font-medium text-gray-600">
            Customer&rsquo;s PO reference (optional)
            <input value={customerPoReference} onChange={(event) => setCustomerPoReference(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Requested delivery date (optional)
            <input type="date" value={requestedDeliveryDate} onChange={(event) => setRequestedDeliveryDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={submitConvert} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Convert to order
            </button>
          </div>
        </div>
      )}

      {section === "followUp" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <label className="block text-xs font-medium text-gray-600">
            Next follow-up date
            <input type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Follow-up notes
            <textarea value={followUpNotesInput} onChange={(event) => setFollowUpNotesInput(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={submitFollowUp} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
