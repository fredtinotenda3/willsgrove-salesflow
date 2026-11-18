"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, PackageCheck, AlertTriangle, Plus, Search } from "lucide-react";
import { CLAIM_CATEGORY_LABELS, CLAIM_PRIORITY_LABELS } from "@/lib/invoice-claims/display";
import { CLAIM_LINE_REASON_CATEGORIES, CLAIM_LINE_REASON_CATEGORY_LABELS } from "@/lib/invoice-claims/validation";

/**
 * Final Operational Enhancements (spec Part 5) -- the "central
 * requirement." Once an invoice's order has been delivered, this panel
 * records the outcome as "No Claim" (an explicit record -- never just
 * silence) or "With Claim" (one claim, itself able to carry multiple
 * disputed lines/reasons, created atomically alongside the delivery
 * record -- see lib/invoice-delivery/record-outcome.ts). Once recorded,
 * the outcome can never be re-recorded for the same invoice (enforced
 * server-side by InvoiceDeliveryRecord.sapInvoiceId's own uniqueness) --
 * this panel instead switches to a read-only summary, with a link to
 * /invoice-claims/new for filing any FURTHER claim against the same
 * invoice afterward (the backend supports one-or-more; this panel's own
 * form creates exactly the first one, atomically with the outcome
 * itself).
 */

type InvoiceLine = {
  id: string;
  lineNumber: number;
  sapItemCode: string | null;
  sapItemDescription: string | null;
  quantityInvoiced: string;
  unitPrice: string | null;
  lineTotal: string | null;
  unitOfMeasure: string | null;
};

type DeliveryRecord = {
  id: string;
  outcome: string;
  podReference: string | null;
  notes: string | null;
  recordedByName: string;
  recordedAt: string;
  claims: { id: string; claimReference: string; category: string; status: string }[];
};

type CustomerOption = { id: string; name: string; sapCustomerCode: string | null };

type LineDraft = {
  disputed: boolean;
  disputeType: "QUANTITY" | "AMOUNT_ONLY";
  acceptedQuantity: string;
  rejectedQuantity: string;
  disputedAmount: string;
  reason: string;
  reasonCategory: string;
  evidenceNotes: string;
};

function emptyLineDraft(): LineDraft {
  return { disputed: false, disputeType: "QUANTITY", acceptedQuantity: "", rejectedQuantity: "", disputedAmount: "", reason: "", reasonCategory: "", evidenceNotes: "" };
}

const CATEGORY_VALUES = Object.keys(CLAIM_CATEGORY_LABELS);
const PRIORITY_VALUES = Object.keys(CLAIM_PRIORITY_LABELS);

const OUTCOME_BADGE: Record<string, { label: string; style: string }> = {
  NO_CLAIM: { label: "No claim", style: "bg-emerald-50 text-emerald-700" },
  WITH_CLAIM: { label: "With claim", style: "bg-amber-50 text-amber-700" },
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function DeliveryOutcomePanel({
  invoiceId,
  matchedCustomerId,
  lines,
}: {
  invoiceId: string;
  matchedCustomerId: string | null;
  lines: InvoiceLine[];
}) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [record, setRecord] = useState<DeliveryRecord | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [outcome, setOutcome] = useState<"NO_CLAIM" | "WITH_CLAIM">("NO_CLAIM");
  const [podReference, setPodReference] = useState("");
  const [notes, setNotes] = useState("");

  const [customerId, setCustomerId] = useState(matchedCustomerId ?? "");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);

  const [category, setCategory] = useState("QUALITY_ISSUE");
  const [categoryDetail, setCategoryDetail] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [claimDate, setClaimDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerComplaintReference, setCustomerComplaintReference] = useState("");
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>(() => Object.fromEntries(lines.map((line) => [line.id, emptyLineDraft()])));

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(`/api/invoice-reconciliation/${invoiceId}/delivery`, { cache: "no-store" });
        const body = await readJson(response);
        if (!response.ok || !body.success) {
          setLoadError((body.message as string) ?? "Unable to load this invoice's delivery outcome.");
          return;
        }
        setRecord((body.delivery as DeliveryRecord | null) ?? null);
      } catch {
        setLoadError("Could not reach the server.");
      } finally {
        setLoading(false);
      }
    })();
  }, [invoiceId]);

  async function searchCustomers() {
    const response = await fetch(`/api/customers?search=${encodeURIComponent(customerSearch)}&pageSize=10`, { cache: "no-store" });
    const data = await readJson(response);
    setCustomerResults(Array.isArray(data.customers) ? (data.customers as CustomerOption[]) : []);
  }

  function updateLine(lineId: string, patch: Partial<LineDraft>) {
    setLineDrafts((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  async function submit() {
    setError(null);
    setFieldErrors({});

    if (outcome === "NO_CLAIM") {
      setSubmitting(true);
      try {
        const response = await fetch(`/api/invoice-reconciliation/${invoiceId}/delivery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ outcome: "NO_CLAIM", podReference: podReference || undefined, notes: notes || undefined }),
        });
        const body = await readJson(response);
        if (!response.ok || !body.success) {
          setError((body.message as string) ?? "Unable to record this delivery outcome.");
          return;
        }
        router.refresh();
        setRecord({ id: body.id as string, outcome: "NO_CLAIM", podReference: podReference || null, notes: notes || null, recordedByName: "You", recordedAt: new Date().toISOString(), claims: [] });
      } catch {
        setError("A network error occurred.");
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // WITH_CLAIM
    if (!customerId) {
      setError("A customer is required for this claim.");
      return;
    }
    if (!description.trim()) {
      setError("A claim description is required.");
      return;
    }

    const claimLines = Object.entries(lineDrafts)
      .filter(([, draft]) => draft.disputed)
      .map(([sapInvoiceLineId, draft]) => {
        if (draft.disputeType === "QUANTITY") {
          return {
            sapInvoiceLineId,
            disputeType: "QUANTITY" as const,
            acceptedQuantity: draft.acceptedQuantity || "0",
            rejectedQuantity: draft.rejectedQuantity || "0",
            reason: draft.reason,
            reasonCategory: draft.reasonCategory || undefined,
            evidenceNotes: draft.evidenceNotes || undefined,
          };
        }
        return {
          sapInvoiceLineId,
          disputeType: "AMOUNT_ONLY" as const,
          disputedAmount: draft.disputedAmount || "0",
          reason: draft.reason,
          reasonCategory: draft.reasonCategory || undefined,
          evidenceNotes: draft.evidenceNotes || undefined,
        };
      });

    if (claimLines.length === 0) {
      setError("Select at least one invoice line to dispute.");
      return;
    }
    if (claimLines.some((line) => !line.reason.trim())) {
      setError("Every disputed line needs a reason.");
      return;
    }
    if (claimLines.some((line) => !line.reasonCategory)) {
      setError("Every disputed line needs a claim reason category.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch(`/api/invoice-reconciliation/${invoiceId}/delivery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome: "WITH_CLAIM",
          podReference: podReference || undefined,
          notes: notes || undefined,
          claims: [
            {
              customerId,
              customerComplaintReference: customerComplaintReference || undefined,
              category,
              categoryDetail: category === "OTHER" ? categoryDetail : undefined,
              description,
              priority,
              claimDate,
              lines: claimLines,
            },
          ],
        }),
      });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setError(typeof body.message === "string" ? body.message : "Unable to record this delivery outcome.");
        if (body.fieldErrors && typeof body.fieldErrors === "object") setFieldErrors(body.fieldErrors as Record<string, string>);
        return;
      }
      router.refresh();
      const claimIds = Array.isArray(body.claimIds) ? (body.claimIds as string[]) : [];
      setRecord({
        id: body.id as string,
        outcome: "WITH_CLAIM",
        podReference: podReference || null,
        notes: notes || null,
        recordedByName: "You",
        recordedAt: new Date().toISOString(),
        claims: claimIds.map((claimId) => ({ id: claimId, claimReference: claimId, category, status: "OPEN" })),
      });
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <section className="flex items-center justify-center rounded-xl border border-[#E8EBE6] bg-white p-10">
        <Loader2 size={18} className="animate-spin text-gray-400" />
      </section>
    );
  }

  if (loadError) {
    return (
      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <p className="text-xs text-[#9B3B3B]">{loadError}</p>
      </section>
    );
  }

  if (record) {
    const badge = OUTCOME_BADGE[record.outcome] ?? { label: record.outcome, style: "bg-gray-100 text-gray-500" };
    return (
      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-[#17251E]">Delivery outcome</h2>
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${badge.style}`}>{badge.label}</span>
        </div>
        <p className="mt-2 text-[11px] text-gray-400">
          Recorded by {record.recordedByName} · {new Date(record.recordedAt).toLocaleString()}
        </p>
        {/* Part 3: once a delivery outcome exists, this invoice has moved
            to the dedicated Delivered Orders page (lib/delivered-orders/
            queries.ts's own definition is exactly "has a recorded
            InvoiceDeliveryRecord," the same thing `record` being non-null
            here means) -- forward link using the same invoiceId this
            panel already fetched against, never a guessed id. */}
        <Link
          href={`/delivered-orders/${invoiceId}`}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-[#173D2E] hover:underline"
        >
          <PackageCheck size={13} /> View full lifecycle in Delivered Orders
        </Link>
        {record.podReference && <p className="mt-2 text-xs text-gray-600">POD reference: {record.podReference}</p>}
        {record.notes && <p className="mt-1 text-xs text-gray-600">Notes: {record.notes}</p>}
        {record.claims.length > 0 && (
          <div className="mt-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Linked claims</p>
            <ul className="mt-2 space-y-1">
              {record.claims.map((claim) => (
                <li key={claim.id}>
                  <Link href={`/invoice-claims/${claim.id}`} className="text-xs font-semibold text-[#173D2E] hover:underline">
                    {claim.claimReference}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {record.outcome === "WITH_CLAIM" && (
          <Link
            href="/invoice-claims/new"
            className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]"
          >
            <Plus size={12} /> File another claim against this invoice
          </Link>
        )}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
      <div className="flex items-center gap-2">
        <PackageCheck size={16} className="text-[#173D2E]" />
        <h2 className="text-sm font-bold text-[#17251E]">Record delivery outcome</h2>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        Once this invoice&rsquo;s order has been delivered, record whether it came back clean (&ldquo;No Claim&rdquo;) or
        with a dispute (&ldquo;With Claim&rdquo;). This is required before the order moves from &ldquo;Ready for
        invoice&rdquo; to &ldquo;Delivered&rdquo; in SalesFlow -- it never changes SAP&rsquo;s own invoice status.
      </p>

      <div className="mt-4 flex gap-4 text-xs">
        <label className="flex items-center gap-2">
          <input type="radio" checked={outcome === "NO_CLAIM"} onChange={() => setOutcome("NO_CLAIM")} />
          No claim
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" checked={outcome === "WITH_CLAIM"} onChange={() => setOutcome("WITH_CLAIM")} />
          With claim
        </label>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <label className="space-y-1">
          <span className="font-medium text-gray-600">POD / delivery reference (optional)</span>
          <input value={podReference} onChange={(e) => setPodReference(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" />
        </label>
        <label className="space-y-1">
          <span className="font-medium text-gray-600">Notes (optional)</span>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" />
        </label>
      </div>

      {outcome === "WITH_CLAIM" && (
        <div className="mt-5 space-y-4 border-t border-gray-100 pt-5">
          {!matchedCustomerId && (
            <div>
              <p className="mb-2 text-xs text-amber-600">This invoice has no resolved customer -- choose the real customer for this claim.</p>
              <div className="flex gap-2">
                <input
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && searchCustomers()}
                  placeholder="Search customers"
                  className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                />
                <button onClick={searchCustomers} className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                  <Search size={14} />
                </button>
              </div>
              {customerResults.length > 0 && (
                <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-100">
                  {customerResults.map((c) => (
                    <li key={c.id} className={`flex items-center justify-between px-3 py-2 text-xs ${customerId === c.id ? "bg-emerald-50" : ""}`}>
                      <span>{c.name} {c.sapCustomerCode ? `(${c.sapCustomerCode})` : ""}</span>
                      <button onClick={() => setCustomerId(c.id)} className="font-semibold text-[#173D2E] hover:underline">
                        {customerId === c.id ? "Selected" : "Select"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <p className="mb-2 text-xs font-semibold text-gray-600">Disputed invoice lines</p>
            <div className="space-y-2">
              {lines.map((line) => {
                const draft = lineDrafts[line.id] ?? emptyLineDraft();
                return (
                  <div key={line.id} className={`rounded-lg border p-3 ${draft.disputed ? "border-[#173D2E]/30 bg-[#173D2E]/[0.02]" : "border-gray-100"}`}>
                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                      <input type="checkbox" checked={draft.disputed} onChange={(e) => updateLine(line.id, { disputed: e.target.checked })} />
                      Line {line.lineNumber} -- {line.sapItemCode ?? "?"} {line.sapItemDescription ? `(${line.sapItemDescription})` : ""}
                      <span className="ml-auto font-normal text-gray-400">
                        Invoiced {line.quantityInvoiced} {line.unitOfMeasure ?? ""}
                      </span>
                    </label>
                    {draft.disputed && (
                      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                        <label className="col-span-2 flex items-center gap-4">
                          <span className="font-medium text-gray-600">Dispute type</span>
                          <label className="flex items-center gap-1">
                            <input type="radio" checked={draft.disputeType === "QUANTITY"} onChange={() => updateLine(line.id, { disputeType: "QUANTITY" })} />
                            Quantity
                          </label>
                          <label className="flex items-center gap-1">
                            <input type="radio" checked={draft.disputeType === "AMOUNT_ONLY"} onChange={() => updateLine(line.id, { disputeType: "AMOUNT_ONLY" })} />
                            Amount only
                          </label>
                        </label>
                        {draft.disputeType === "QUANTITY" ? (
                          <>
                            <label className="space-y-1">
                              <span className="font-medium text-gray-600">Accepted quantity</span>
                              <input value={draft.acceptedQuantity} onChange={(e) => updateLine(line.id, { acceptedQuantity: e.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" placeholder="0" />
                            </label>
                            <label className="space-y-1">
                              <span className="font-medium text-gray-600">Rejected / disputed quantity</span>
                              <input value={draft.rejectedQuantity} onChange={(e) => updateLine(line.id, { rejectedQuantity: e.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" placeholder="0" />
                            </label>
                          </>
                        ) : (
                          <label className="col-span-2 space-y-1">
                            <span className="font-medium text-gray-600">Disputed amount</span>
                            <input value={draft.disputedAmount} onChange={(e) => updateLine(line.id, { disputedAmount: e.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" placeholder="0" />
                          </label>
                        )}
                        <label className="col-span-2 space-y-1">
                          <span className="font-medium text-gray-600">Claim reason category (required)</span>
                          <select value={draft.reasonCategory} onChange={(e) => updateLine(line.id, { reasonCategory: e.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5">
                            <option value="">-- select a reason --</option>
                            {CLAIM_LINE_REASON_CATEGORIES.map((value) => (
                              <option key={value} value={value}>{CLAIM_LINE_REASON_CATEGORY_LABELS[value]}</option>
                            ))}
                          </select>
                        </label>
                        <label className="col-span-2 space-y-1">
                          <span className="font-medium text-gray-600">Reason (required)</span>
                          <textarea value={draft.reason} onChange={(e) => updateLine(line.id, { reason: e.target.value })} rows={2} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" />
                        </label>
                        <label className="col-span-2 space-y-1">
                          <span className="font-medium text-gray-600">Evidence notes (optional)</span>
                          <textarea value={draft.evidenceNotes} onChange={(e) => updateLine(line.id, { evidenceNotes: e.target.value })} rows={2} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" />
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="font-medium text-gray-600">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2">
                {CATEGORY_VALUES.map((value) => (
                  <option key={value} value={value}>{CLAIM_CATEGORY_LABELS[value]}</option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="font-medium text-gray-600">Priority</span>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2">
                {PRIORITY_VALUES.map((value) => (
                  <option key={value} value={value}>{CLAIM_PRIORITY_LABELS[value]}</option>
                ))}
              </select>
            </label>
            {category === "OTHER" && (
              <label className="col-span-2 space-y-1">
                <span className="font-medium text-gray-600">Detail (required for &ldquo;Other&rdquo;)</span>
                <input value={categoryDetail} onChange={(e) => setCategoryDetail(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
              </label>
            )}
            <label className="space-y-1">
              <span className="font-medium text-gray-600">Claim date</span>
              <input type="date" value={claimDate} onChange={(e) => setClaimDate(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
            </label>
            <label className="space-y-1">
              <span className="font-medium text-gray-600">Customer&rsquo;s own reference (optional)</span>
              <input value={customerComplaintReference} onChange={(e) => setCustomerComplaintReference(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
            </label>
            <label className="col-span-2 space-y-1">
              <span className="font-medium text-gray-600">Description (required)</span>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
            </label>
          </div>
        </div>
      )}

      {error && (
        <p className="mt-4 flex items-center gap-1.5 text-[11px] text-[#9B3B3B]">
          <AlertTriangle size={12} /> {error}
        </p>
      )}
      {Object.keys(fieldErrors).length > 0 && (
        <ul className="mt-2 space-y-0.5 text-[11px] text-[#9B3B3B]">
          {Object.entries(fieldErrors).map(([key, message]) => (
            <li key={key}>{key}: {message}</li>
          ))}
        </ul>
      )}

      <div className="mt-5">
        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {submitting ? <Loader2 size={14} className="animate-spin" /> : <PackageCheck size={14} />}
          Record delivery outcome
        </button>
      </div>
    </section>
  );
}
