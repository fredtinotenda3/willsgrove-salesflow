"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import Sidebar from "../../components/sidebar";
import { HEADER_TARGET_FIELDS, LINE_TARGET_FIELDS, REQUIRED_TARGET_FIELDS, type InvoiceColumnMapping } from "@/lib/invoice-reconciliation/csv";

/**
 * Milestone 5 (SAP Invoice Reconciliation). The import wizard (spec
 * section 10.A): upload -> inspect/preview -> map columns -> validate
 * (duplicate/customer-match plan) -> confirm -> import history. Same
 * three-stage "stateless preview, confirm writes" shape as
 * app/customers/master-import/page.tsx, extended with an operator-
 * editable column mapping step in between, since this importer (unlike
 * the fixed-header master-data importers) must adapt to whatever columns
 * the actual SAP B1 export uses (spec section 3).
 */

const FIELD_LABELS: Record<string, string> = {
  docEntry: "SAP internal document id (DocEntry)",
  docNum: "SAP invoice number (DocNum)",
  customerCode: "Customer SAP code (CardCode)",
  customerName: "Customer name (CardName)",
  invoiceDate: "Invoice date",
  currency: "Currency",
  documentStatus: "Document status",
  orderReference: "Reference to originating order",
  subtotal: "Subtotal",
  taxTotal: "Tax total",
  total: "Total",
  lineNumber: "Line number",
  itemCode: "SAP item code",
  itemDescription: "Item description",
  quantity: "Quantity invoiced",
  unitOfMeasure: "Unit of measure",
  unitPrice: "Unit price",
  discount: "Discount",
  taxCode: "Tax code",
  lineTotal: "Line total",
  docLineNum: "SAP document line id",
};

type Stage = "idle" | "readingHeaders" | "mapping" | "validating" | "planned" | "importing" | "done";

type HeadersPreview = {
  fileName: string;
  sourceHeaders: string[];
  totalDataRows: number;
  sampleRows: Record<string, string>[];
  suggestedMapping: InvoiceColumnMapping;
};

type InvoiceSample = {
  docNum: string;
  docEntry: string | null;
  customerCode: string | null;
  customerName: string | null;
  matchedCustomerId: string | null;
  invoiceDate: string | null;
  lineCount: number;
  isCancelledOrReversed: boolean;
};

type DuplicateSample = { docNum: string; docEntry: string | null; reason: string };

type Plan = {
  fileName: string;
  mapping: InvoiceColumnMapping;
  summary: {
    totalDataRows: number;
    invalidRowCount: number;
    newInvoiceCount: number;
    newLineCount: number;
    duplicateInvoiceCount: number;
    unmatchedCustomerCodeCount: number;
  };
  invalidRowErrors: string[];
  invalidRowErrorsTruncated: boolean;
  newInvoiceSample: InvoiceSample[];
  duplicateInvoiceSample: DuplicateSample[];
  unmatchedCustomerCodes: string[];
};

type ImportResult = {
  fileName: string;
  importExecuted: boolean;
  message: string;
  summary: {
    importedInvoiceCount: number;
    importedLineCount: number;
    autoMatchedLineCount: number;
    overInvoicingFlaggedCount: number;
  };
};

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export default function InvoiceImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [headers, setHeaders] = useState<HeadersPreview | null>(null);
  const [mapping, setMapping] = useState<InvoiceColumnMapping | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function resetAll() {
    setFile(null);
    setStage("idle");
    setHeaders(null);
    setMapping(null);
    setPlan(null);
    setResult(null);
    setNotice(null);
    setConfirmed(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setStage("idle");
    setHeaders(null);
    setMapping(null);
    setPlan(null);
    setResult(null);
    setNotice(null);
    setConfirmed(false);
  }

  async function readHeaders() {
    if (!file) return;
    setStage("readingHeaders");
    setNotice(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/invoice-reconciliation/import/preview", { method: "POST", body: formData });
      const body = await readJson(response);

      if (response.ok && body?.success) {
        setHeaders(body as unknown as HeadersPreview);
        setMapping((body as unknown as HeadersPreview).suggestedMapping);
        setStage("mapping");
        return;
      }

      setNotice(typeof body?.message === "string" ? body.message : "Unable to read this file.");
      setStage("idle");
    } catch {
      setNotice("Could not reach the server. Please try again.");
      setStage("idle");
    }
  }

  async function validateMapping() {
    if (!file || !mapping) return;
    setStage("validating");
    setNotice(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));

      const response = await fetch("/api/invoice-reconciliation/import/preview", { method: "POST", body: formData });
      const body = await readJson(response);

      if (response.ok && body?.success) {
        setPlan(body as unknown as Plan);
        setStage("planned");
        setConfirmed(false);
        return;
      }

      setNotice(typeof body?.message === "string" ? body.message : "The mapping could not be validated.");
      setStage("mapping");
    } catch {
      setNotice("Could not reach the server. Please try again.");
      setStage("mapping");
    }
  }

  async function runImport() {
    if (!file || !plan || !confirmed) return;
    setStage("importing");
    setNotice(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(plan.mapping));
      formData.append("expectedNewInvoiceCount", String(plan.summary.newInvoiceCount));
      formData.append("expectedDuplicateInvoiceCount", String(plan.summary.duplicateInvoiceCount));

      const response = await fetch("/api/invoice-reconciliation/import/confirm", { method: "POST", body: formData });
      const body = await readJson(response);

      if (response.ok && body?.success) {
        setResult(body as unknown as ImportResult);
        setStage("done");
        return;
      }

      if (response.status === 409) {
        setPlan(null);
        setConfirmed(false);
        setNotice(typeof body?.message === "string" ? body.message : "The invoice data changed since the preview. Please check the file again.");
        setStage("mapping");
        return;
      }

      setNotice(typeof body?.message === "string" ? body.message : "The import failed. No changes were saved.");
      setStage("planned");
    } catch {
      setNotice("Could not reach the server. Nothing is confirmed as imported.");
      setStage("planned");
    }
  }

  const busy = stage === "readingHeaders" || stage === "validating" || stage === "importing";
  const allFields = [...HEADER_TARGET_FIELDS, ...LINE_TARGET_FIELDS];
  const nothingToImport = plan !== null && plan.summary.newInvoiceCount === 0;

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / Operations / Invoice Reconciliation / Import</p>
            <h1 className="mt-1 text-lg font-semibold">Import SAP invoices</h1>
          </div>
        </header>

        <div className="mx-auto max-w-[1100px] p-5 md:p-9">
          <Link href="/invoice-reconciliation" className="mb-5 inline-flex items-center gap-2 text-sm text-[#5E7366] hover:text-[#315C43]">
            <ArrowLeft size={15} />
            Back to reconciliation queue
          </Link>

          <div className="mb-7">
            <h2 className="text-2xl font-semibold tracking-tight">Import an SAP invoice export</h2>
            <p className="mt-1 text-sm text-[#7D8981]">
              Upload a CSV export of actual SAP Business One invoices (one row per invoice line). You confirm
              which column maps to which field before anything is checked against SalesFlow -- this importer
              never assumes a fixed SAP export layout. If your export is an Excel file, save it as CSV first.
            </p>
          </div>

          {notice && (
            <div className="mb-5 flex items-start gap-3 rounded-xl border border-[#F1D9D9] bg-[#FFF6F6] px-4 py-3 text-sm text-[#9B3B3B]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <p>{notice}</p>
            </div>
          )}

          {stage === "done" && result ? (
            <section className="rounded-2xl border border-[#E8ECE7] bg-white p-6">
              <div className="flex items-center gap-2 text-[#347447]">
                <CheckCircle2 size={20} />
                <h3 className="text-lg font-semibold">{result.message}</h3>
              </div>
              <p className="mt-1 text-sm text-[#7D8981]">File: {result.fileName}</p>
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-4">
                <SummaryCard label="Invoices imported" value={result.summary.importedInvoiceCount} />
                <SummaryCard label="Lines imported" value={result.summary.importedLineCount} />
                <SummaryCard label="Auto-matched lines" value={result.summary.autoMatchedLineCount} />
                <SummaryCard label="Over-invoicing flagged" value={result.summary.overInvoicingFlaggedCount} />
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/invoice-reconciliation" className="rounded-lg bg-[#315C43] px-4 py-2 text-sm font-medium text-white hover:bg-[#274D37]">
                  View reconciliation queue
                </Link>
                <button onClick={resetAll} className="rounded-lg border border-[#E5EAE4] bg-white px-4 py-2 text-sm font-medium hover:bg-[#F7F8F6]">
                  Import another file
                </button>
              </div>
            </section>
          ) : (
            <>
              <section className="rounded-2xl border border-[#E8ECE7] bg-white p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                  <label className="flex flex-1 cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[#CFD8D1] px-4 py-4 hover:bg-[#F7F8F6]">
                    <FileSpreadsheet size={20} className="text-[#5E7366]" />
                    <span className="min-w-0 flex-1 truncate text-sm">{file ? file.name : "Choose an SAP invoice export CSV file"}</span>
                    <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={handleFileChange} disabled={busy} className="hidden" />
                  </label>
                  <button
                    onClick={readHeaders}
                    disabled={!file || busy}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#315C43] px-5 py-3 text-sm font-medium text-white hover:bg-[#274D37] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Upload size={15} />
                    {stage === "readingHeaders" ? "Reading file..." : "Read columns"}
                  </button>
                </div>
              </section>

              {headers && mapping && (stage === "mapping" || stage === "validating") && (
                <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                  <h3 className="text-base font-semibold">Map columns: {headers.fileName}</h3>
                  <p className="mt-1 text-sm text-[#7D8981]">
                    {formatNumber(headers.totalDataRows)} data row(s) found. Confirm which column in your file maps to each
                    SalesFlow field -- required fields are marked. Unmapped fields are simply left blank on import.
                  </p>

                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {allFields.map((field) => (
                      <label key={field} className="block text-xs font-medium text-gray-600">
                        {FIELD_LABELS[field] ?? field}
                        {REQUIRED_TARGET_FIELDS.includes(field) && <span className="text-red-500"> *</span>}
                        <select
                          value={mapping[field] ?? ""}
                          onChange={(event) => setMapping({ ...mapping, [field]: event.target.value || null })}
                          className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
                        >
                          <option value="">-- not mapped --</option>
                          {headers.sourceHeaders.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>

                  <button
                    onClick={validateMapping}
                    disabled={busy}
                    className="mt-5 rounded-lg bg-[#315C43] px-5 py-3 text-sm font-medium text-white hover:bg-[#274D37] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {stage === "validating" ? "Validating..." : "Validate mapping"}
                  </button>
                </section>
              )}

              {plan && (stage === "planned" || stage === "importing") && (
                <>
                  <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                    <h3 className="text-base font-semibold">Preview: {plan.fileName}</h3>
                    <p className="mt-1 text-sm text-[#7D8981]">Nothing has been saved yet.</p>
                    <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
                      <SummaryCard label="New invoices" value={plan.summary.newInvoiceCount} />
                      <SummaryCard label="New lines" value={plan.summary.newLineCount} />
                      <SummaryCard label="Duplicate invoices" value={plan.summary.duplicateInvoiceCount} />
                      <SummaryCard label="Invalid rows" value={plan.summary.invalidRowCount} />
                      <SummaryCard label="Unmatched customer codes" value={plan.summary.unmatchedCustomerCodeCount} />
                    </div>
                  </section>

                  {plan.invalidRowErrors.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#F1D9D9] bg-[#FFF6F6] p-6">
                      <h3 className="text-base font-semibold text-[#9B3B3B]">Rows that will be skipped</h3>
                      <ul className="mt-3 space-y-1 text-sm text-[#9B3B3B]">
                        {plan.invalidRowErrors.map((message, i) => (
                          <li key={i}>{message}</li>
                        ))}
                      </ul>
                      {plan.invalidRowErrorsTruncated && <p className="mt-2 text-xs text-[#9B3B3B]">Showing first 100 only.</p>}
                    </section>
                  )}

                  {plan.unmatchedCustomerCodes.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#F0E3C2] bg-[#FFFAEE] p-6">
                      <h3 className="text-base font-semibold text-[#8A6212]">Customer codes not found</h3>
                      <p className="mt-1 text-sm text-[#8A6212]">
                        These invoices will still be imported, with no SalesFlow customer resolved yet:{" "}
                        {plan.unmatchedCustomerCodes.join(", ")}.
                      </p>
                    </section>
                  )}

                  {plan.duplicateInvoiceSample.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                      <h3 className="text-base font-semibold">Duplicate invoices (will be skipped)</h3>
                      <ul className="mt-3 space-y-1 text-sm text-[#7D8981]">
                        {plan.duplicateInvoiceSample.map((d, i) => (
                          <li key={i}>
                            <span className="font-mono text-xs">{d.docNum}</span> -- {d.reason}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {plan.newInvoiceSample.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                      <h3 className="text-base font-semibold">New invoices (sample)</h3>
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[700px] text-left text-sm">
                          <thead className="text-xs text-[#89948D]">
                            <tr>
                              <th className="py-2 pr-4 font-medium">DocNum</th>
                              <th className="py-2 pr-4 font-medium">Customer</th>
                              <th className="py-2 pr-4 font-medium">Date</th>
                              <th className="py-2 pr-4 font-medium">Lines</th>
                              <th className="py-2 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plan.newInvoiceSample.map((inv) => (
                              <tr key={`${inv.docEntry ?? "x"}-${inv.docNum}`} className="border-t border-[#EEF1ED]">
                                <td className="py-2 pr-4 font-mono text-xs">{inv.docNum}</td>
                                <td className="py-2 pr-4">
                                  {inv.customerName ?? "-"}
                                  {!inv.matchedCustomerId && inv.customerCode && (
                                    <span className="ml-1 text-[10px] text-amber-600">(unresolved: {inv.customerCode})</span>
                                  )}
                                </td>
                                <td className="py-2 pr-4 text-xs">{inv.invoiceDate ?? "-"}</td>
                                <td className="py-2 pr-4 text-xs">{inv.lineCount}</td>
                                <td className="py-2 text-xs">{inv.isCancelledOrReversed ? "Cancelled/reversed" : "Active"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                    {nothingToImport ? (
                      <p className="text-sm text-[#5E7366]">Nothing to import -- every invoice in this file has already been imported.</p>
                    ) : (
                      <>
                        <label className="flex cursor-pointer items-start gap-3 text-sm">
                          <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(event) => setConfirmed(event.target.checked)}
                            disabled={busy}
                            className="mt-0.5"
                          />
                          <span>
                            I have reviewed the preview and want to import {formatNumber(plan.summary.newInvoiceCount)} new
                            invoice(s) ({formatNumber(plan.summary.newLineCount)} line(s)).
                          </span>
                        </label>
                        <button
                          onClick={runImport}
                          disabled={!confirmed || busy}
                          className="mt-4 rounded-lg bg-[#315C43] px-5 py-3 text-sm font-medium text-white hover:bg-[#274D37] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {stage === "importing" ? "Importing..." : "Confirm and import"}
                        </button>
                      </>
                    )}
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-[#E8ECE7] bg-[#FAFBF9] px-4 py-3">
      <p className="text-xs text-[#89948D]">{label}</p>
      <p className="mt-1 text-xl font-semibold">{formatNumber(value)}</p>
    </div>
  );
}
