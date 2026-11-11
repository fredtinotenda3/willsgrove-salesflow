"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Search, Plus, Trash2, Loader2, AlertCircle } from "lucide-react";

/**
 * Milestone 7. Quotation creation form: customer, header detail, and an
 * initial set of lines. Mirrors app/orders/new/page.tsx's per-line SAP
 * product search pattern (debounced /api/products search, same
 * suggestion dropdown), extended with the unlisted/requested-item toggle
 * spec section 3 requires ("must be clearly distinguished... never
 * treated as an SAP product") and discount/VAT-relevant fields that
 * orders don't have. POSTs to /api/quotations, whose own validation
 * (lib/quotations/validation.ts, lib/quotations/create.ts) is the real
 * authority -- this form's checks are only to avoid an obviously-invalid
 * round trip.
 */

type CustomerSummary = {
  id: string;
  name: string;
  sapCustomerCode: string | null;
  primaryLocation: { label: string; city: string } | null;
};

type ProductSuggestion = {
  id: string;
  itemName: string;
  sapItemCode: string | null;
};

type UserOption = { id: string; name: string };

type LineDraft = {
  key: string;
  isUnlistedItem: boolean;
  productQuery: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  unlistedItemDescription: string;
  quantity: string;
  unitOfMeasure: string;
  unitPrice: string;
  discountPercent: string;
  notes: string;
  suggestions: ProductSuggestion[];
  showSuggestions: boolean;
};

let lineKeyCounter = 0;
function newLine(): LineDraft {
  lineKeyCounter += 1;
  return {
    key: `line-${lineKeyCounter}`,
    isUnlistedItem: false,
    productQuery: "",
    productId: null,
    sapItemCodeSnapshot: null,
    unlistedItemDescription: "",
    quantity: "",
    unitOfMeasure: "",
    unitPrice: "",
    discountPercent: "",
    notes: "",
    suggestions: [],
    showSuggestions: false,
  };
}

function isLineBlank(line: LineDraft): boolean {
  return !line.productId && line.unlistedItemDescription.trim() === "" && line.quantity.trim() === "" && line.unitPrice.trim() === "";
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function NewQuotationForm({ defaultSalespersonId }: { defaultSalespersonId: string }) {
  const router = useRouter();

  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<CustomerSummary[]>([]);
  const [showCustomerResults, setShowCustomerResults] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerSummary | null>(null);

  const [quotationDate, setQuotationDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [validUntil, setValidUntil] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [customerReference, setCustomerReference] = useState("");
  const [salespersonId, setSalespersonId] = useState(defaultSalespersonId);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [internalNotes, setInternalNotes] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");

  const [lines, setLines] = useState<LineDraft[]>([newLine()]);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    const query = customerQuery.trim();
    if (query === "") return;
    const timer = setTimeout(() => {
      fetch(`/api/customers?search=${encodeURIComponent(query)}&pageSize=8`, { cache: "no-store" })
        .then((res) => res.json())
        .then((data) => {
          if (data.success) setCustomerResults(data.customers ?? []);
        })
        .catch(() => setCustomerResults([]));
    }, 300);
    return () => clearTimeout(timer);
  }, [customerQuery]);

  useEffect(() => {
    fetch("/api/users", { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setUsers((data.users ?? []).map((u: UserOption) => ({ id: u.id, name: u.name })));
      })
      .catch(() => {});
  }, []);

  function updateLine(key: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((prev) => [...prev, newLine()]);
  }

  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((line) => line.key !== key) : prev));
  }

  function handleProductQueryChange(key: string, value: string) {
    updateLine(key, { productQuery: value, showSuggestions: true });
    if (value.trim() === "") {
      updateLine(key, { suggestions: [] });
      return;
    }
    fetch(`/api/products?search=${encodeURIComponent(value.trim())}&pageSize=6`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          updateLine(key, {
            suggestions: (data.products ?? []).map((p: ProductSuggestion) => ({ id: p.id, itemName: p.itemName, sapItemCode: p.sapItemCode })),
          });
        }
      })
      .catch(() => {});
  }

  function selectProduct(key: string, product: ProductSuggestion) {
    updateLine(key, {
      productId: product.id,
      sapItemCodeSnapshot: product.sapItemCode,
      productQuery: product.itemName,
      suggestions: [],
      showSuggestions: false,
    });
  }

  async function submit() {
    setFormError(null);
    setFieldErrors({});

    if (!selectedCustomer) {
      setFormError("Select a customer first.");
      return;
    }
    if (!validUntil) {
      setFormError("A validity date is required.");
      return;
    }

    const startedLines = lines.filter((line) => !isLineBlank(line));
    for (const line of startedLines) {
      if (line.isUnlistedItem && !line.unlistedItemDescription.trim()) {
        setFormError("Every unlisted line needs a description.");
        return;
      }
      if (!line.isUnlistedItem && !line.productId) {
        setFormError("Every catalogued line needs a selected SAP product -- use the search box, or mark it as an unlisted item.");
        return;
      }
      if (!line.quantity.trim() || !line.unitPrice.trim()) {
        setFormError("Every line needs a quantity and a unit price.");
        return;
      }
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/quotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: selectedCustomer.id,
          quotationDate,
          validUntil,
          currency,
          customerReference: customerReference || undefined,
          salespersonId: salespersonId || undefined,
          internalNotes: internalNotes || undefined,
          customerNotes: customerNotes || undefined,
          lines: startedLines.map((line) =>
            line.isUnlistedItem
              ? {
                  isUnlistedItem: true,
                  unlistedItemDescription: line.unlistedItemDescription.trim(),
                  quantity: line.quantity.trim(),
                  unitOfMeasure: line.unitOfMeasure || undefined,
                  unitPrice: line.unitPrice.trim(),
                  discountPercent: line.discountPercent || undefined,
                  notes: line.notes || undefined,
                }
              : {
                  isUnlistedItem: false,
                  productId: line.productId,
                  quantity: line.quantity.trim(),
                  unitOfMeasure: line.unitOfMeasure || undefined,
                  unitPrice: line.unitPrice.trim(),
                  discountPercent: line.discountPercent || undefined,
                  notes: line.notes || undefined,
                }
          ),
        }),
      });
      const data = await readJson(response);
      if (!response.ok || data.success !== true) {
        setFormError(typeof data.message === "string" ? data.message : "Unable to create this quotation.");
        if (data.fieldErrors && typeof data.fieldErrors === "object") setFieldErrors(data.fieldErrors as Record<string, string>);
        return;
      }
      router.push(`/quotations/${data.id as string}`);
    } catch {
      setFormError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/quotations" className="inline-flex items-center gap-2 text-xs font-semibold text-gray-500 hover:text-gray-700">
        Back to Quotations
      </Link>

      {formError && (
        <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700">
          <AlertCircle size={15} />
          {formError}
        </div>
      )}

      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <h3 className="text-sm font-bold text-[#17251E]">Customer</h3>
        {selectedCustomer ? (
          <div className="mt-3 flex items-center justify-between rounded-lg border border-gray-100 px-4 py-3">
            <div>
              <p className="text-xs font-semibold text-gray-700">{selectedCustomer.name}</p>
              {selectedCustomer.sapCustomerCode && <p className="text-[10px] text-gray-400">SAP code: {selectedCustomer.sapCustomerCode}</p>}
            </div>
            <button type="button" onClick={() => { setSelectedCustomer(null); setCustomerQuery(""); }} className="text-[11px] font-semibold text-gray-400 hover:text-red-600">
              Change
            </button>
          </div>
        ) : (
          <div className="relative mt-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={customerQuery}
              onChange={(event) => { setCustomerQuery(event.target.value); setShowCustomerResults(true); }}
              onFocus={() => setShowCustomerResults(true)}
              placeholder="Search customers by name or SAP code..."
              className="h-10 w-full rounded-lg border border-gray-200 pl-9 pr-4 text-xs outline-none focus:border-[#7C9D87]"
            />
            {showCustomerResults && customerQuery.trim() !== "" && (
              <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-100 bg-white shadow-lg">
                {customerResults.length === 0 && <p className="px-4 py-3 text-xs text-gray-400">No customers found.</p>}
                {customerResults.map((customer) => (
                  <button key={customer.id} type="button" onClick={() => { setSelectedCustomer(customer); setShowCustomerResults(false); }} className="block w-full px-4 py-3 text-left text-xs hover:bg-gray-50">
                    <p className="font-medium text-gray-700">{customer.name}</p>
                    {customer.sapCustomerCode && <p className="text-[10px] text-gray-400">{customer.sapCustomerCode}</p>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <h3 className="text-sm font-bold text-[#17251E]">Quotation details</h3>
        <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
          <label className="space-y-1">
            <span className="font-medium text-gray-600">Quotation date</span>
            <input type="date" value={quotationDate} onChange={(event) => setQuotationDate(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
          </label>
          <label className="space-y-1">
            <span className="font-medium text-gray-600">Valid until *</span>
            <input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
            {fieldErrors.validUntil && <p className="text-red-600">{fieldErrors.validUntil}</p>}
          </label>
          <label className="space-y-1">
            <span className="font-medium text-gray-600">Currency</span>
            <input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase())} maxLength={10} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
          </label>
          <label className="space-y-1">
            <span className="font-medium text-gray-600">Customer&rsquo;s own reference (optional)</span>
            <input value={customerReference} onChange={(event) => setCustomerReference(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
          </label>
          <label className="space-y-1">
            <span className="font-medium text-gray-600">Salesperson</span>
            <select value={salespersonId} onChange={(event) => setSalespersonId(event.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-2">
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
          </label>
          <label className="col-span-2 space-y-1">
            <span className="font-medium text-gray-600">Internal notes (staff only)</span>
            <textarea value={internalNotes} onChange={(event) => setInternalNotes(event.target.value)} rows={2} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
          </label>
          <label className="col-span-2 space-y-1">
            <span className="font-medium text-gray-600">Customer-facing notes / terms</span>
            <textarea value={customerNotes} onChange={(event) => setCustomerNotes(event.target.value)} rows={2} className="w-full rounded-lg border border-gray-200 px-2 py-2" />
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-[#17251E]">Lines</h3>
            <p className="mt-1 text-xs text-gray-500">
              Search the catalogue for a known SAP product, or mark a line as &ldquo;unlisted / requested item&rdquo; for
              something the customer asked about that isn&rsquo;t in SAP -- it will never be treated as a real SAP product.
              Prices are entered by Sales; nothing here is derived from cost, stock or history.
            </p>
          </div>
          <button type="button" onClick={addLine} className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-[11px] font-semibold text-gray-600 hover:bg-gray-50">
            <Plus size={14} />
            Add line
          </button>
        </div>

        <div className="mt-4 space-y-4">
          {lines.map((line, index) => (
            <div key={line.key} className="rounded-xl border border-gray-100 p-4">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold text-gray-400">Line {index + 1}</p>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-1.5 text-[11px] font-medium text-gray-600">
                    <input
                      type="checkbox"
                      checked={line.isUnlistedItem}
                      onChange={(event) => updateLine(line.key, { isUnlistedItem: event.target.checked, productId: null, productQuery: "", sapItemCodeSnapshot: null })}
                    />
                    Unlisted / requested item
                  </label>
                  {lines.length > 1 && (
                    <button type="button" onClick={() => removeLine(line.key)} className="text-gray-300 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 grid grid-cols-4 gap-3">
                {line.isUnlistedItem ? (
                  <div className="relative col-span-2">
                    <label className="text-[10px] font-semibold text-gray-400">Description (as the customer asked for it) *</label>
                    <input
                      type="text"
                      value={line.unlistedItemDescription}
                      onChange={(event) => updateLine(line.key, { unlistedItemDescription: event.target.value })}
                      placeholder="e.g. 25kg bags of X (not currently in our SAP catalogue)"
                      className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                    />
                  </div>
                ) : (
                  <div className="relative col-span-2">
                    <label className="text-[10px] font-semibold text-gray-400">SAP product (search by code, name or barcode) *</label>
                    <input
                      type="text"
                      value={line.productQuery}
                      onChange={(event) => handleProductQueryChange(line.key, event.target.value)}
                      onFocus={() => updateLine(line.key, { showSuggestions: true })}
                      placeholder="Search by SAP code, name or barcode..."
                      className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]"
                    />
                    {line.showSuggestions && line.suggestions.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full rounded-lg border border-gray-100 bg-white shadow-lg">
                        {line.suggestions.map((product) => (
                          <button key={product.id} type="button" onClick={() => selectProduct(line.key, product)} className="block w-full px-3 py-2 text-left text-xs hover:bg-gray-50">
                            <p className="font-medium text-gray-700">{product.itemName}</p>
                            {product.sapItemCode && <p className="text-[10px] text-gray-400">{product.sapItemCode}</p>}
                          </button>
                        ))}
                      </div>
                    )}
                    {line.productId && <p className="mt-1 text-[10px] text-green-600">Linked to SAP product{line.sapItemCodeSnapshot ? ` (${line.sapItemCodeSnapshot})` : ""}</p>}
                  </div>
                )}

                <div>
                  <label className="text-[10px] font-semibold text-gray-400">Quantity *</label>
                  <input type="text" inputMode="decimal" value={line.quantity} onChange={(event) => updateLine(line.key, { quantity: event.target.value })} placeholder="10" className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-400">Unit</label>
                  <input type="text" value={line.unitOfMeasure} onChange={(event) => updateLine(line.key, { unitOfMeasure: event.target.value })} placeholder="KG / EA / BOX" className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-400">Unit price *</label>
                  <input type="text" inputMode="decimal" value={line.unitPrice} onChange={(event) => updateLine(line.key, { unitPrice: event.target.value })} placeholder="0.0000" className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-gray-400">Discount % (optional)</label>
                  <input type="text" inputMode="decimal" value={line.discountPercent} onChange={(event) => updateLine(line.key, { discountPercent: event.target.value })} placeholder="0" className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]" />
                </div>
                <div className="col-span-2">
                  <label className="text-[10px] font-semibold text-gray-400">Notes (optional)</label>
                  <input type="text" value={line.notes} onChange={(event) => updateLine(line.key, { notes: event.target.value })} className="mt-1 h-9 w-full rounded-lg border border-gray-200 px-3 text-xs outline-none focus:border-[#7C9D87]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex items-center justify-end gap-3 pb-8">
        <Link href="/quotations" className="rounded-lg border border-gray-200 px-5 py-3 text-xs font-semibold text-gray-600 hover:bg-gray-50">
          Cancel
        </Link>
        <button type="button" onClick={submit} disabled={submitting} className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-5 py-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-60">
          {submitting && <Loader2 size={14} className="animate-spin" />}
          {submitting ? "Creating..." : "Create Quotation"}
        </button>
      </div>
    </div>
  );
}
