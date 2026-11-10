"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send, ShieldCheck } from "lucide-react";
import {
  customerDecisionTypeValues,
  decisionSourceValues,
  lostSaleReasonValues,
  WHOLE_REMAINDER_DECISION_TYPES,
} from "@/lib/lost-sales/validation";
import { DECISION_TYPE_LABELS, DECISION_SOURCE_LABELS, LOST_SALE_REASON_LABELS } from "@/lib/lost-sales/display";

/**
 * Milestone 4 (Lost-Sales Management). The one client-rendered island on
 * app/lost-sales/[id]/page.tsx -- records a customer decision and (for
 * SALES_MANAGER/ADMINISTRATOR only) confirms a lost sale. Always calls
 * router.refresh() after a successful submission rather than updating
 * local state optimistically -- the same "re-fetch, don't guess"
 * convention as PickingPanel/HandoverPanel, just via Next's own
 * Server-Component-refresh mechanism (already used elsewhere in this
 * project -- app/login, app/change-password) instead of a second manual
 * client fetch, since the history lists this page also needs to refresh
 * live in the Server Component, not in this panel.
 */

// Client-side convenience check only, same DECIMAL_PATTERN convention as
// app/fulfilment/[id]/picking-panel.tsx -- the server's own check is what
// actually matters.
const DECIMAL_PATTERN = /^\d+(\.\d{1,4})?$/;

type Props = {
  unfulfilledDemandId: string;
  canConfirmLost: boolean;
  unavailableQuantity: string;
  outstandingQuantity: string;
  cancelledQuantity: string;
  substitutedQuantity: string;
  confirmedLostQuantity: string;
};

type ProductOption = { id: string; sapItemCode: string; itemName: string };

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function approxUndecided(unavailable: string, outstanding: string, cancelled: string, substituted: string): number {
  const toNum = (value: string) => Number.parseFloat(value) || 0;
  const remaining = toNum(unavailable) - toNum(outstanding) - toNum(cancelled) - toNum(substituted);
  return remaining > 0 ? remaining : 0;
}

export default function DecisionPanel({
  unfulfilledDemandId,
  canConfirmLost,
  unavailableQuantity,
  outstandingQuantity,
  cancelledQuantity,
  substitutedQuantity,
  confirmedLostQuantity,
}: Props) {
  const router = useRouter();

  const undecided = useMemo(
    () => approxUndecided(unavailableQuantity, outstandingQuantity, cancelledQuantity, substitutedQuantity),
    [unavailableQuantity, outstandingQuantity, cancelledQuantity, substitutedQuantity]
  );

  const [decisionType, setDecisionType] = useState<(typeof customerDecisionTypeValues)[number]>(
    customerDecisionTypeValues[0]
  );
  const [source, setSource] = useState<(typeof decisionSourceValues)[number]>(decisionSourceValues[0]);
  const [quantity, setQuantity] = useState("");
  const [customerContactName, setCustomerContactName] = useState("");
  const [reason, setReason] = useState("");
  const [remarks, setRemarks] = useState("");
  const [attachmentReference, setAttachmentReference] = useState("");
  const [expectedFollowUpDate, setExpectedFollowUpDate] = useState("");
  const [substituteQuery, setSubstituteQuery] = useState("");
  const [substituteOptions, setSubstituteOptions] = useState<ProductOption[]>([]);
  const [substituteProductId, setSubstituteProductId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isWholeRemainder = WHOLE_REMAINDER_DECISION_TYPES.has(decisionType);
  const isSubstitute = decisionType === "SUBSTITUTE_ACCEPTED";

  async function searchSubstitutes(query: string) {
    setSubstituteQuery(query);
    setSubstituteProductId(null);
    if (query.trim().length < 2) {
      setSubstituteOptions([]);
      return;
    }
    setSearching(true);
    try {
      const response = await fetch(`/api/products?search=${encodeURIComponent(query)}&pageSize=8`, {
        cache: "no-store",
      });
      const data = await readJson(response);
      const products = Array.isArray(data.products) ? (data.products as ProductOption[]) : [];
      setSubstituteOptions(products);
    } catch {
      setSubstituteOptions([]);
    } finally {
      setSearching(false);
    }
  }

  async function submitDecision() {
    setError(null);
    setNotice(null);

    if (!isWholeRemainder) {
      if (!quantity || !DECIMAL_PATTERN.test(quantity)) {
        setError("Enter a valid quantity (up to 4 decimal places).");
        return;
      }
    }
    if (isSubstitute && !substituteProductId) {
      setError("Choose a substitute product.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/lost-sales/${unfulfilledDemandId}/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decisionType,
          source,
          quantity: isWholeRemainder ? undefined : quantity,
          substituteProductId: isSubstitute ? substituteProductId : undefined,
          customerContactName: customerContactName || undefined,
          reason: reason || undefined,
          remarks: remarks || undefined,
          attachmentReference: attachmentReference || undefined,
          expectedFollowUpDate: expectedFollowUpDate || undefined,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to record this decision.");
        return;
      }
      setNotice("Decision recorded.");
      setQuantity("");
      setCustomerContactName("");
      setReason("");
      setRemarks("");
      setAttachmentReference("");
      setExpectedFollowUpDate("");
      setSubstituteQuery("");
      setSubstituteOptions([]);
      setSubstituteProductId(null);
      router.refresh();
    } catch {
      setError("A network error occurred while recording this decision.");
    } finally {
      setSubmitting(false);
    }
  }

  // --- Confirm lost sale (SALES_MANAGER/ADMINISTRATOR only) ---
  const [lostQuantity, setLostQuantity] = useState("");
  const [lostReason, setLostReason] = useState<(typeof lostSaleReasonValues)[number]>(lostSaleReasonValues[0]);
  const [lostReasonDetail, setLostReasonDetail] = useState("");
  const [lostDecisionSource, setLostDecisionSource] = useState<(typeof decisionSourceValues)[number]>(
    decisionSourceValues[0]
  );
  const [lostRemarks, setLostRemarks] = useState("");
  const [confirmingLost, setConfirmingLost] = useState(false);
  const [lostError, setLostError] = useState<string | null>(null);
  const [lostNotice, setLostNotice] = useState<string | null>(null);

  async function submitConfirmLost() {
    setLostError(null);
    setLostNotice(null);

    if (!lostQuantity || !DECIMAL_PATTERN.test(lostQuantity)) {
      setLostError("Enter a valid quantity (up to 4 decimal places).");
      return;
    }
    if (lostReason === "OTHER" && lostReasonDetail.trim().length === 0) {
      setLostError("A reason detail is required when the reason is 'Other'.");
      return;
    }

    setConfirmingLost(true);
    try {
      const response = await fetch(`/api/lost-sales/${unfulfilledDemandId}/confirm-lost`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: lostQuantity,
          reason: lostReason,
          reasonDetail: lostReasonDetail || undefined,
          decisionSource: lostDecisionSource,
          remarks: lostRemarks || undefined,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setLostError(typeof data.message === "string" ? data.message : "Unable to confirm this lost sale.");
        return;
      }
      setLostNotice("Lost sale confirmed.");
      setLostQuantity("");
      setLostReasonDetail("");
      setLostRemarks("");
      router.refresh();
    } catch {
      setLostError("A network error occurred while confirming this lost sale.");
    } finally {
      setConfirmingLost(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
        <h2 className="text-sm font-bold text-[#17251E]">Record Customer Decision</h2>
        <p className="mt-1 text-[11px] text-gray-400">Undecided remaining quantity: {undecided}</p>

        <div className="mt-4 space-y-3">
          <label className="block text-xs font-medium text-gray-600">
            Decision
            <select
              value={decisionType}
              onChange={(event) => setDecisionType(event.target.value as typeof decisionType)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {customerDecisionTypeValues.map((value) => (
                <option key={value} value={value}>
                  {DECISION_TYPE_LABELS[value] ?? value}
                </option>
              ))}
            </select>
          </label>

          {!isWholeRemainder && (
            <label className="block text-xs font-medium text-gray-600">
              Quantity
              <input
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                placeholder="0.0000"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
          )}
          {isWholeRemainder && (
            <p className="rounded-lg bg-gray-50 px-3 py-2 text-[11px] text-gray-500">
              This decision applies to the full undecided remaining quantity ({undecided}).
            </p>
          )}

          {isSubstitute && (
            <label className="block text-xs font-medium text-gray-600">
              Substitute product
              <input
                value={substituteQuery}
                onChange={(event) => searchSubstitutes(event.target.value)}
                placeholder="Search by name, SAP code, or barcode"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              {searching && <p className="mt-1 text-[10px] text-gray-400">Searching…</p>}
              {substituteOptions.length > 0 && !substituteProductId && (
                <ul className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-gray-100">
                  {substituteOptions.map((product) => (
                    <li key={product.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setSubstituteProductId(product.id);
                          setSubstituteQuery(`${product.itemName} (${product.sapItemCode})`);
                          setSubstituteOptions([]);
                        }}
                        className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50"
                      >
                        {product.itemName} <span className="text-gray-400">({product.sapItemCode})</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </label>
          )}

          <label className="block text-xs font-medium text-gray-600">
            Decision source
            <select
              value={source}
              onChange={(event) => setSource(event.target.value as typeof source)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            >
              {decisionSourceValues.map((value) => (
                <option key={value} value={value}>
                  {DECISION_SOURCE_LABELS[value] ?? value}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs font-medium text-gray-600">
            Customer contact (optional)
            <input
              value={customerContactName}
              onChange={(event) => setCustomerContactName(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </label>

          {(decisionType === "AWAIT_REMAINING_QUANTITY" || decisionType === "SCHEDULE_LATER_SUPPLY") && (
            <label className="block text-xs font-medium text-gray-600">
              Expected follow-up date (optional)
              <input
                type="date"
                value={expectedFollowUpDate}
                onChange={(event) => setExpectedFollowUpDate(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>
          )}

          <label className="block text-xs font-medium text-gray-600">
            Reason (optional)
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs font-medium text-gray-600">
            Supporting attachment / communication reference (optional)
            <input
              value={attachmentReference}
              onChange={(event) => setAttachmentReference(event.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-xs font-medium text-gray-600">
            Remarks (optional)
            <textarea
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
            />
          </label>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {notice && <p className="text-xs text-emerald-600">{notice}</p>}

          <button
            type="button"
            onClick={submitDecision}
            disabled={submitting || undecided <= 0}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#122E23] disabled:opacity-50"
          >
            {submitting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Record Decision
          </button>
          {undecided <= 0 && (
            <p className="text-center text-[11px] text-gray-400">
              Nothing is left undecided on this record -- every unit of the unavailable quantity has already been
              assigned to a decision.
            </p>
          )}
        </div>
      </section>

      {canConfirmLost && (
        <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
          <h2 className="text-sm font-bold text-[#17251E]">Confirm Lost Sale</h2>
          <p className="mt-1 text-[11px] text-gray-400">
            Available to confirm (cancelled not yet confirmed lost, plus outstanding): up to {cancelledQuantity}{" "}
            cancelled (already {confirmedLostQuantity} confirmed) or {outstandingQuantity} outstanding.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block text-xs font-medium text-gray-600">
              Quantity
              <input
                value={lostQuantity}
                onChange={(event) => setLostQuantity(event.target.value)}
                placeholder="0.0000"
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>

            <label className="block text-xs font-medium text-gray-600">
              Reason
              <select
                value={lostReason}
                onChange={(event) => setLostReason(event.target.value as typeof lostReason)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {lostSaleReasonValues.map((value) => (
                  <option key={value} value={value}>
                    {LOST_SALE_REASON_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </label>

            {lostReason === "OTHER" && (
              <label className="block text-xs font-medium text-gray-600">
                Reason detail (required for &quot;Other&quot;)
                <input
                  value={lostReasonDetail}
                  onChange={(event) => setLostReasonDetail(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
              </label>
            )}

            <label className="block text-xs font-medium text-gray-600">
              Customer decision source
              <select
                value={lostDecisionSource}
                onChange={(event) => setLostDecisionSource(event.target.value as typeof lostDecisionSource)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              >
                {decisionSourceValues.map((value) => (
                  <option key={value} value={value}>
                    {DECISION_SOURCE_LABELS[value] ?? value}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-gray-600">
              Remarks (optional)
              <textarea
                value={lostRemarks}
                onChange={(event) => setLostRemarks(event.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
            </label>

            {lostError && <p className="text-xs text-red-600">{lostError}</p>}
            {lostNotice && <p className="text-xs text-emerald-600">{lostNotice}</p>}

            <button
              type="button"
              onClick={submitConfirmLost}
              disabled={confirmingLost}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
            >
              {confirmingLost ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
              Confirm Lost Sale
            </button>
            <p className="text-center text-[11px] text-gray-400">
              Restricted to Sales Manager / Administrator. This estimates a value only when a real, historically
              valid price is available -- never invented.
            </p>
          </div>
        </section>
      )}
    </div>
  );
}
