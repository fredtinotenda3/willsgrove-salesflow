"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, Plus, AlertTriangle } from "lucide-react";
import { CLAIM_CATEGORY_LABELS, CLAIM_PRIORITY_LABELS } from "@/lib/invoice-claims/display";

/**
 * Milestone 6A. Claim creation workflow: pick a SAP invoice, select
 * which of its lines are disputed and how (quantity vs. amount-only),
 * then the claim-level detail. POSTs to /api/invoice-claims, whose
 * validation (lib/invoice-claims/validation.ts, lib/invoice-claims/
 * create-claim.ts) is the real authority -- this form's own checks are
 * only to avoid an obviously-invalid round trip.
 */

type InvoiceSummary = {
  id: string;
  sapDocNum: string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  customerName: string | null;
  invoiceDate: string | null;
  currencyCode: string | null;
  total: string | null;
  isCancelledOrReversed: boolean;
};

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

type InvoiceDetail = {
  id: string;
  sapDocNum: string;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  currencyCode: string | null;
  isCancelledOrReversed: boolean;
  lines: InvoiceLine[];
};

type CustomerOption = { id: string; name: string; sapCustomerCode: string | null };

type UserOption = { id: string; name: string };

type LineDraft = {
  disputed: boolean;
  disputeType: "QUANTITY" | "AMOUNT_ONLY";
  acceptedQuantity: string;
  rejectedQuantity: string;
  disputedAmount: string;
  disputedUnitPrice: string;
  reason: string;
  evidenceNotes: string;
};

const CATEGORY_VALUES = Object.keys(CLAIM_CATEGORY_LABELS);
const PRIORITY_VALUES = Object.keys(CLAIM_PRIORITY_LABELS);

function emptyLineDraft(): LineDraft {
  return { disputed: false, disputeType: "QUANTITY", acceptedQuantity: "", rejectedQuantity: "", disputedAmount: "", disputedUnitPrice: "", reason: "", evidenceNotes: "" };
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function NewClaimForm() {
  const router = useRouter();

  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [invoiceResults, setInvoiceResults] = useState<InvoiceSummary[]>([]);
  const [searchingInvoices, setSearchingInvoices] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loadingInvoice, setLoadingInvoice] = useState(false);

  const [customerId, setCustomerId] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerOption[]>([]);

  const [users, setUsers] = useState<UserOption[] | null>(null);

  const [category, setCategory] = useState("QUALITY_ISSUE");
  const [categoryDetail, setCategoryDetail] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("MEDIUM");
  const [claimDate, setClaimDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [customerComplaintReference, setCustomerComplaintReference] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [customerCommunicationNotes, setCustomerCommunicationNotes] = useState("");

  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function searchInvoices() {
    setSearchingInvoices(true);
    try {
      const response = await fetch(`/api/invoice-reconciliation?search=${encodeURIComponent(invoiceSearch)}&pageSize=10`, { cache: "no-store" });
      const data = await readJson(response);
      setInvoiceResults(Array.isArray(data.invoices) ? (data.invoices as InvoiceSummary[]) : []);
    } finally {
      setSearchingInvoices(false);
    }
  }

  async function selectInvoice(id: string) {
    setLoadingInvoice(true);
    setInvoice(null);
    setLineDrafts({});
    setCustomerId("");
    try {
      const response = await fetch(`/api/invoice-reconciliation/${id}`, { cache: "no-store" });
      const data = await readJson(response);
      const loaded = data.invoice as InvoiceDetail | undefined;
      if (loaded) {
        setInvoice(loaded);
        if (loaded.matchedCustomerId) setCustomerId(loaded.matchedCustomerId);
        const drafts: Record<string, LineDraft> = {};
        for (const line of loaded.lines) drafts[line.id] = emptyLineDraft();
        setLineDrafts(drafts);
      }
    } finally {
      setLoadingInvoice(false);
    }
  }

  async function searchCustomers() {
    const response = await fetch(`/api/customers?search=${encodeURIComponent(customerSearch)}&pageSize=10`, { cache: "no-store" });
    const data = await readJson(response);
    setCustomerResults(Array.isArray(data.customers) ? (data.customers as CustomerOption[]) : []);
  }

  async function loadUsers() {
    if (users !== null) return;
    const response = await fetch("/api/users", { cache: "no-store" });
    const data = await readJson(response);
    setUsers(Array.isArray(data.users) ? (data.users as UserOption[]).map((u) => ({ id: u.id, name: u.name })) : []);
  }

  function updateLine(lineId: string, patch: Partial<LineDraft>) {
    setLineDrafts((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  async function submit() {
    setError(null);
    setFieldErrors({});

    if (!invoice) {
      setError("Choose a SAP invoice first.");
      return;
    }
    if (!customerId) {
      setError("A customer is required.");
      return;
    }
    if (!description.trim()) {
      setError("A description is required.");
      return;
    }

    const lines = Object.entries(lineDrafts)
      .filter(([, draft]) => draft.disputed)
      .map(([sapInvoiceLineId, draft]) => {
        if (draft.disputeType === "QUANTITY") {
          return {
            sapInvoiceLineId,
            disputeType: "QUANTITY" as const,
            acceptedQuantity: draft.acceptedQuantity || "0",
            rejectedQuantity: draft.rejectedQuantity || "0",
            disputedUnitPrice: draft.disputedUnitPrice || undefined,
            reason: draft.reason,
            evidenceNotes: draft.evidenceNotes || undefined,
          };
        }
        return {
          sapInvoiceLineId,
          disputeType: "AMOUNT_ONLY" as const,
          disputedAmount: draft.disputedAmount || "0",
          disputedUnitPrice: draft.disputedUnitPrice || undefined,
          reason: draft.reason,
          evidenceNotes: draft.evidenceNotes || undefined,
        };
      });

    if (lines.length === 0) {
      setError("Select at least one invoice line to dispute.");
      return;
    }
    if (lines.some((line) => !line.reason.trim())) {
      setError("Every disputed line needs a reason.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/invoice-claims", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sapInvoiceId: invoice.id,
          customerId,
          customerComplaintReference: customerComplaintReference || undefined,
          category,
          categoryDetail: category === "OTHER" ? categoryDetail : undefined,
          description,
          assignedToId: assignedToId || undefined,
          priority,
          claimDate,
          customerCommunicationNotes: customerCommunicationNotes || undefined,
          lines,
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setError(typeof data.message === "string" ? data.message : "Unable to create this claim.");
        if (data.fieldErrors && typeof data.fieldErrors === "object") setFieldErrors(data.fieldErrors as Record<string, string>);
        return;
      }
      router.push(`/invoice-claims/${data.id as string}`);
    } catch {
      setError("A network error occurred.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <h3 className="text-sm font-bold text-[#17251E]">1. SAP invoice</h3>
        <p className="mt-1 text-xs text-gray-500">A claim must always link to the relevant SAP invoice.</p>

        {!invoice ? (
          <div className="mt-4">
            <div className="flex gap-2">
              <input
                value={invoiceSearch}
                onChange={(event) => setInvoiceSearch(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && searchInvoices()}
                placeholder="SAP invoice number or customer name"
                className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              />
              <button onClick={searchInvoices} disabled={searchingInvoices} className="flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">
                {searchingInvoices ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Search
              </button>
            </div>
            {invoiceResults.length > 0 && (
              <ul className="mt-3 divide-y divide-gray-100 rounded-lg border border-gray-100">
                {invoiceResults.map((result) => (
                  <li key={result.id} className="flex items-center justify-between px-3 py-2.5 text-xs">
                    <div>
                      <p className="font-semibold text-[#173D2E]">{result.sapDocNum}</p>
                      <p className="text-gray-500">
                        {result.matchedCustomerName ?? result.customerName ?? "Unknown customer"} ·{" "}
                        {result.invoiceDate ? new Date(result.invoiceDate).toLocaleDateString() : "no date"}
                        {result.isCancelledOrReversed && <span className="ml-1 text-amber-600">(cancelled/reversed)</span>}
                      </p>
                    </div>
                    <button onClick={() => selectInvoice(result.id)} className="rounded-lg border border-gray-200 px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-50">
                      Select
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : loadingInvoice ? (
          <p className="mt-4 text-xs text-gray-400">Loading invoice…</p>
        ) : (
          <div className="mt-4 rounded-lg bg-gray-50 p-3 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-[#173D2E]">{invoice.sapDocNum}</p>
                <p className="text-gray-500">{invoice.matchedCustomerName ?? "Unresolved customer"} · {invoice.currencyCode ?? "no currency"}</p>
              </div>
              <button onClick={() => { setInvoice(null); setLineDrafts({}); }} className="font-semibold text-gray-500 hover:underline">
                Change
              </button>
            </div>
            {invoice.isCancelledOrReversed && (
              <p className="mt-2 flex items-center gap-1.5 text-amber-700">
                <AlertTriangle size={12} />
                This invoice is marked cancelled/reversed in SAP -- confirm the claim still applies before filing.
              </p>
            )}
          </div>
        )}
      </section>

      {invoice && (
        <>
          <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h3 className="text-sm font-bold text-[#17251E]">2. Customer</h3>
            {invoice.matchedCustomerId ? (
              <p className="mt-2 text-xs text-gray-600">{invoice.matchedCustomerName} (resolved from the invoice; cannot be changed here)</p>
            ) : (
              <div className="mt-3">
                <p className="mb-2 text-xs text-amber-600">This invoice has no resolved customer in SAP reconciliation -- choose the real customer for this claim.</p>
                <div className="flex gap-2">
                  <input
                    value={customerSearch}
                    onChange={(event) => setCustomerSearch(event.target.value)}
                    onKeyDown={(event) => event.key === "Enter" && searchCustomers()}
                    placeholder="Search customers"
                    className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
                  />
                  <button onClick={searchCustomers} className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                    Search
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
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h3 className="text-sm font-bold text-[#17251E]">3. Disputed invoice lines</h3>
            <p className="mt-1 text-xs text-gray-500">
              Select each disputed line and whether this is a quantity dispute (accepted vs. rejected quantity) or an amount-only dispute (e.g. pricing). Accepted + rejected can never exceed the invoiced quantity, after accounting for any earlier claim already filed against the same line.
            </p>
            <div className="mt-4 space-y-3">
              {invoice.lines.map((line) => {
                const draft = lineDrafts[line.id] ?? emptyLineDraft();
                return (
                  <div key={line.id} className={`rounded-lg border p-3 ${draft.disputed ? "border-[#173D2E]/30 bg-[#173D2E]/[0.02]" : "border-gray-100"}`}>
                    <label className="flex items-center gap-2 text-xs font-semibold text-gray-700">
                      <input type="checkbox" checked={draft.disputed} onChange={(event) => updateLine(line.id, { disputed: event.target.checked })} />
                      Line {line.lineNumber} -- {line.sapItemCode ?? "?"} {line.sapItemDescription ? `(${line.sapItemDescription})` : ""}
                      <span className="ml-auto font-normal text-gray-400">
                        Invoiced {line.quantityInvoiced} {line.unitOfMeasure ?? ""} {line.unitPrice ? `@ ${line.unitPrice}` : ""}
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
                              <input value={draft.acceptedQuantity} onChange={(event) => updateLine(line.id, { acceptedQuantity: event.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" placeholder="0" />
                            </label>
                            <label className="space-y-1">
                              <span className="font-medium text-gray-600">Rejected / disputed quantity</span>
                              <input value={draft.rejectedQuantity} onChange={(event) => updateLine(line.id, { rejectedQuantity: event.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" placeholder="0" />
                            </label>
                          </>
                        ) : (
                          <label className="col-span-2 space-y-1">
                            <span className="font-medium text-gray-600">Disputed amount</span>
                            <input value={draft.disputedAmount} onChange={(event) => updateLine(line.id, { disputedAmount: event.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" placeholder="0" />
                          </label>
                        )}

                        <label className="space-y-1">
                          <span className="font-medium text-gray-600">Customer&rsquo;s claimed unit price (optional, informational)</span>
                          <input value={draft.disputedUnitPrice} onChange={(event) => updateLine(line.id, { disputedUnitPrice: event.target.value })} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" />
                        </label>

                        <label className="col-span-2 space-y-1">
                          <span className="font-medium text-gray-600">Reason (required)</span>
                          <textarea value={draft.reason} onChange={(event) => updateLine(line.id, { reason: event.target.value })} rows={2} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" />
                        </label>
                        <label className="col-span-2 space-y-1">
                          <span className="font-medium text-gray-600">Evidence notes (optional)</span>
                          <textarea value={draft.evidenceNotes} onChange={(event) => updateLine(line.id, { evidenceNotes: event.target.value })} rows={2} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" />
                        </label>
                        {fieldErrors[`lines.${invoice.lines.findIndex((l) => l.id === line.id)}`] && (
                          <p className="col-span-2 text-red-600">{fieldErrors[`lines.${invoice.lines.findIndex((l) => l.id === line.id)}`]}</p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h3 className="text-sm font-bold text-[#17251E]">4. Claim details</h3>
            <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2">
                  {CATEGORY_VALUES.map((value) => (
                    <option key={value} value={value}>{CLAIM_CATEGORY_LABELS[value]}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Priority</span>
                <select value={priority} onChange={(event) => setPriority(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2">
                  {PRIORITY_VALUES.map((value) => (
                    <option key={value} value={value}>{CLAIM_PRIORITY_LABELS[value]}</option>
                  ))}
                </select>
              </label>
              {category === "OTHER" && (
                <label className="col-span-2 space-y-1">
                  <span className="font-medium text-gray-600">Detail (required for &ldquo;Other&rdquo;)</span>
                  <input value={categoryDetail} onChange={(event) => setCategoryDetail(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
                </label>
              )}
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Claim date</span>
                <input type="date" value={claimDate} onChange={(event) => setClaimDate(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Customer&rsquo;s own reference (if supplied)</span>
                <input value={customerComplaintReference} onChange={(event) => setCustomerComplaintReference(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
              </label>
              <label className="col-span-2 space-y-1">
                <span className="font-medium text-gray-600">Description</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
              </label>
              <label className="space-y-1" onFocus={loadUsers}>
                <span className="font-medium text-gray-600">Assigned to (optional)</span>
                <select value={assignedToId} onChange={(event) => setAssignedToId(event.target.value)} onClick={loadUsers} className="w-full rounded-lg border border-gray-200 px-2 py-2">
                  <option value="">-- unassigned --</option>
                  {(users ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              </label>
              <label className="col-span-2 space-y-1">
                <span className="font-medium text-gray-600">Customer communication notes (optional)</span>
                <textarea value={customerCommunicationNotes} onChange={(event) => setCustomerCommunicationNotes(event.target.value)} rows={2} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
              </label>
            </div>
          </section>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pb-8">
            <button onClick={submit} disabled={submitting} className="flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-50">
              {submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              File claim
            </button>
          </div>
        </>
      )}
    </div>
  );
}
