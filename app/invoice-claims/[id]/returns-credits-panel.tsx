"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, PackageCheck, Receipt } from "lucide-react";
import { RETURN_CONDITION_LABELS } from "@/lib/returns-credits/display";

/**
 * Milestone 6B (Returns & Credit Notes). The claim detail page's own
 * mutating actions for this module -- recording a physical return (open
 * to any authenticated user) and recording a credit note manually
 * (SALES_MANAGER/ADMINISTRATOR only, re-enforced server-side regardless
 * of what this UI shows). Kept as its own client island, separate from
 * ClaimActionsPanel, since it is a logically distinct module (6B) added
 * on top of an already-large existing component rather than grown inside
 * it. Same "re-fetch via router.refresh() after every success" pattern.
 */

const CONDITION_VALUES = Object.keys(RETURN_CONDITION_LABELS);

type Props = {
  claimId: string;
  claimStatus: string;
  canRecordCreditNote: boolean;
  claimLines: { id: string; label: string }[];
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function ReturnsCreditsPanel({ claimId, claimStatus, canRecordCreditNote, claimLines }: Props) {
  const router = useRouter();
  const [section, setSection] = useState<"closed" | "return" | "creditNote">("closed");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Return form
  const [claimLineId, setClaimLineId] = useState("");
  const [receivedQuantity, setReceivedQuantity] = useState("");
  const [condition, setCondition] = useState(CONDITION_VALUES[0]);
  const [conditionDetail, setConditionDetail] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [receivedDate, setReceivedDate] = useState(() => new Date().toISOString().slice(0, 10));

  // Credit note form
  const [sapCreditNoteDocNum, setSapCreditNoteDocNum] = useState("");
  const [sapCreditNoteDocEntry, setSapCreditNoteDocEntry] = useState("");
  const [creditNoteDate, setCreditNoteDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState("");
  const [currencyCode, setCurrencyCode] = useState("");
  const [notes, setNotes] = useState("");

  const canRecordActuals = claimStatus === "APPROVED" || claimStatus === "PARTIALLY_RESOLVED";

  function close() {
    setSection("closed");
    setError(null);
  }

  async function submitReturn() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoice-claims/${claimId}/returns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claimLineId: claimLineId || undefined,
          receivedQuantity,
          condition,
          conditionDetail: condition === "OTHER" ? conditionDetail : undefined,
          conditionNotes: conditionNotes || undefined,
          receivedDate,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to record this return.");
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

  async function submitCreditNote() {
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoice-claims/${claimId}/credit-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sapCreditNoteDocNum,
          sapCreditNoteDocEntry: sapCreditNoteDocEntry || undefined,
          creditNoteDate: creditNoteDate || undefined,
          amount,
          currencyCode: currencyCode || undefined,
          notes: notes || undefined,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to record this credit note.");
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

  if (!canRecordActuals) {
    return (
      <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
        <h2 className="text-sm font-bold text-[#17251E]">Returns & credit notes</h2>
        <p className="mt-2 text-xs text-gray-400">
          A resolution must be approved before a physical return or credit note can be recorded against this claim.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
      <h2 className="text-sm font-bold text-[#17251E]">Returns & credit notes</h2>
      <p className="mt-1 text-[11px] text-gray-400">
        SAP Business One remains the system of record -- recording a credit note here never creates one in SAP; it
        only records that SAP already issued one.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => setSection(section === "return" ? "closed" : "return")}
          className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
        >
          <PackageCheck size={12} />
          Record physical return
        </button>
        {canRecordCreditNote ? (
          <button
            onClick={() => setSection(section === "creditNote" ? "closed" : "creditNote")}
            className="flex items-center gap-1 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-50"
          >
            <Receipt size={12} />
            Record credit note
          </button>
        ) : (
          <p className="flex items-center text-[11px] text-amber-600">Only a sales manager or administrator may record a credit note.</p>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-600">{error}</p>}

      {section === "return" && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <label className="block text-xs font-medium text-gray-600">
            Claim line (optional -- leave unset for a whole-claim return)
            <select value={claimLineId} onChange={(event) => setClaimLineId(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
              <option value="">-- not line-specific --</option>
              {claimLines.map((line) => (
                <option key={line.id} value={line.id}>{line.label}</option>
              ))}
            </select>
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Received quantity
            <input value={receivedQuantity} onChange={(event) => setReceivedQuantity(event.target.value)} placeholder="e.g. 5.0000" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Condition
            <select value={condition} onChange={(event) => setCondition(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
              {CONDITION_VALUES.map((value) => (
                <option key={value} value={value}>{RETURN_CONDITION_LABELS[value]}</option>
              ))}
            </select>
          </label>
          {condition === "OTHER" && (
            <label className="block text-xs font-medium text-gray-600">
              Detail (required for &ldquo;Other&rdquo;)
              <input value={conditionDetail} onChange={(event) => setConditionDetail(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
            </label>
          )}
          <label className="block text-xs font-medium text-gray-600">
            Notes
            <textarea value={conditionNotes} onChange={(event) => setConditionNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Received date
            <input type="date" value={receivedDate} onChange={(event) => setReceivedDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={submitReturn} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Record return
            </button>
          </div>
        </div>
      )}

      {section === "creditNote" && canRecordCreditNote && (
        <div className="mt-4 max-w-md space-y-2 rounded-lg border border-gray-100 p-3">
          <label className="block text-xs font-medium text-gray-600">
            SAP credit note DocNum
            <input value={sapCreditNoteDocNum} onChange={(event) => setSapCreditNoteDocNum(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            SAP credit note DocEntry (optional)
            <input value={sapCreditNoteDocEntry} onChange={(event) => setSapCreditNoteDocEntry(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Amount
            <input value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="e.g. 125.0000" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Currency (optional)
            <input value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value.toUpperCase())} placeholder="e.g. USD" className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Credit note date
            <input type="date" value={creditNoteDate} onChange={(event) => setCreditNoteDate(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <label className="block text-xs font-medium text-gray-600">
            Notes
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-xs" />
          </label>
          <p className="text-[10px] text-gray-400">This records that SAP has already issued this credit note -- it does not create one in SAP.</p>
          <div className="flex justify-end gap-2">
            <button onClick={close} className="rounded-lg border border-gray-200 px-3 py-1.5 text-[11px] font-semibold text-gray-500">Cancel</button>
            <button onClick={submitCreditNote} disabled={submitting} className="flex items-center gap-1 rounded-lg bg-[#173D2E] px-3 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50">
              {submitting && <Loader2 size={12} className="animate-spin" />}
              Record credit note
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
