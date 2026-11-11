"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, FileSpreadsheet, Upload } from "lucide-react";
import Sidebar from "../../components/sidebar";
import { CREDIT_NOTE_TARGET_FIELDS, REQUIRED_CREDIT_NOTE_FIELDS, type CreditNoteColumnMapping } from "@/lib/returns-credits/csv";

/**
 * Milestone 6B (Returns & Credit Notes). The SAP credit note import
 * wizard -- mirrors app/invoice-reconciliation/import/page.tsx's own
 * three-stage "stateless preview, confirm writes" shape exactly: upload
 * -> map columns -> validate (duplicate/base-invoice-resolution plan) ->
 * confirm -> done. Restricted to SALES_MANAGER/ADMINISTRATOR server-side
 * (the preview/confirm routes), same gate as every other 6B action that
 * asserts a credit-note fact.
 */

const FIELD_LABELS: Record<string, string> = {
  docEntry: "SAP internal document id (DocEntry)",
  docNum: "SAP credit note number (DocNum)",
  baseInvoiceDocEntry: "Base invoice internal id (DocEntry)",
  baseInvoiceDocNum: "Base invoice number (DocNum)",
  creditNoteDate: "Credit note date",
  currency: "Currency",
  amount: "Amount",
  notes: "Notes",
};

type Stage = "idle" | "readingHeaders" | "mapping" | "validating" | "planned" | "importing" | "done";

type HeadersPreview = {
  fileName: string;
  sourceHeaders: string[];
  totalDataRows: number;
  sampleRows: Record<string, string>[];
  suggestedMapping: CreditNoteColumnMapping;
};

type NewCreditNoteSample = {
  docNum: string;
  docEntry: string | null;
  baseInvoiceDocEntry: string | null;
  baseInvoiceDocNum: string | null;
  resolvedSapInvoiceId: string | null;
  amount: string;
  currency: string | null;
  creditNoteDate: string | null;
};

type DuplicateSample = { docNum: string; docEntry: string | null; reason: string };

type Plan = {
  fileName: string;
  mapping: CreditNoteColumnMapping;
  summary: {
    totalDataRows: number;
    invalidRowCount: number;
    newCreditNoteCount: number;
    duplicateCreditNoteCount: number;
    unresolvedBaseInvoiceReferenceCount: number;
  };
  invalidRowErrors: string[];
  invalidRowErrorsTruncated: boolean;
  newCreditNoteSample: NewCreditNoteSample[];
  duplicateCreditNoteSample: DuplicateSample[];
  unresolvedBaseInvoiceReferences: string[];
};

type ImportResult = {
  fileName: string;
  importExecuted: boolean;
  message: string;
  summary: {
    importedCreditNoteCount: number;
    duplicateRowCount: number;
    invalidRowCount?: number;
    autoMatchedCount?: number;
    unresolvedBaseInvoiceReferences?: string[];
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

export default function CreditNoteImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [headers, setHeaders] = useState<HeadersPreview | null>(null);
  const [mapping, setMapping] = useState<CreditNoteColumnMapping | null>(null);
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

      const response = await fetch("/api/returns-credits/import/preview", { method: "POST", body: formData });
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

      const response = await fetch("/api/returns-credits/import/preview", { method: "POST", body: formData });
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
      formData.append("expectedNewCreditNoteCount", String(plan.summary.newCreditNoteCount));
      formData.append("expectedDuplicateCreditNoteCount", String(plan.summary.duplicateCreditNoteCount));

      const response = await fetch("/api/returns-credits/import/confirm", { method: "POST", body: formData });
      const body = await readJson(response);

      if (response.ok && body?.success) {
        setResult(body as unknown as ImportResult);
        setStage("done");
        return;
      }

      if (response.status === 409) {
        setPlan(null);
        setConfirmed(false);
        setNotice(typeof body?.message === "string" ? body.message : "The credit note data changed since the preview. Please check the file again.");
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
  const nothingToImport = plan !== null && plan.summary.newCreditNoteCount === 0;

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / Operations / Returns & Credits / Import</p>
            <h1 className="mt-1 text-lg font-semibold">Import SAP credit notes</h1>
          </div>
        </header>

        <div className="mx-auto max-w-[1100px] p-5 md:p-9">
          <Link href="/returns-credits" className="mb-5 inline-flex items-center gap-2 text-sm text-[#5E7366] hover:text-[#315C43]">
            <ArrowLeft size={15} />
            Back to credit note reconciliation
          </Link>

          <div className="mb-7">
            <h2 className="text-2xl font-semibold tracking-tight">Import an SAP credit note export</h2>
            <p className="mt-1 text-sm text-[#7D8981]">
              Upload a CSV export of actual SAP Business One AR credit memos. You confirm which column maps to
              which field before anything is checked against SalesFlow -- this never creates a credit note in SAP,
              it only records that SAP already issued one. If your export is an Excel file, save it as CSV first.
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
                <SummaryCard label="Credit notes imported" value={result.summary.importedCreditNoteCount} />
                <SummaryCard label="Duplicate rows skipped" value={result.summary.duplicateRowCount} />
                <SummaryCard label="Auto-matched to a claim" value={result.summary.autoMatchedCount ?? 0} />
                <SummaryCard label="Invalid rows skipped" value={result.summary.invalidRowCount ?? 0} />
              </div>
              {result.summary.unresolvedBaseInvoiceReferences && result.summary.unresolvedBaseInvoiceReferences.length > 0 && (
                <p className="mt-4 text-xs text-amber-600">
                  Unresolved base invoice references: {result.summary.unresolvedBaseInvoiceReferences.join(", ")}
                </p>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/returns-credits" className="rounded-lg bg-[#315C43] px-4 py-2 text-sm font-medium text-white hover:bg-[#274D37]">
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
                    <span className="min-w-0 flex-1 truncate text-sm">{file ? file.name : "Choose an SAP credit note export CSV file"}</span>
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
                    field -- required fields are marked. Unmapped fields are simply left blank on import.
                  </p>

                  <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {CREDIT_NOTE_TARGET_FIELDS.map((field) => (
                      <label key={field} className="block text-xs font-medium text-gray-600">
                        {FIELD_LABELS[field] ?? field}
                        {(REQUIRED_CREDIT_NOTE_FIELDS as readonly string[]).includes(field) && <span className="text-red-500"> *</span>}
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
                      <SummaryCard label="New credit notes" value={plan.summary.newCreditNoteCount} />
                      <SummaryCard label="Duplicate credit notes" value={plan.summary.duplicateCreditNoteCount} />
                      <SummaryCard label="Invalid rows" value={plan.summary.invalidRowCount} />
                      <SummaryCard label="Unresolved base invoices" value={plan.summary.unresolvedBaseInvoiceReferenceCount} />
                      <SummaryCard label="Data rows" value={plan.summary.totalDataRows} />
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

                  {plan.unresolvedBaseInvoiceReferences.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#F0E3C2] bg-[#FFFAEE] p-6">
                      <h3 className="text-base font-semibold text-[#8A6212]">Base invoice references not found</h3>
                      <p className="mt-1 text-sm text-[#8A6212]">
                        These credit notes will still be imported, with no base invoice resolved yet:{" "}
                        {plan.unresolvedBaseInvoiceReferences.join(", ")}.
                      </p>
                    </section>
                  )}

                  {plan.duplicateCreditNoteSample.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                      <h3 className="text-base font-semibold">Duplicate credit notes (will be skipped)</h3>
                      <ul className="mt-3 space-y-1 text-sm text-[#7D8981]">
                        {plan.duplicateCreditNoteSample.map((d, i) => (
                          <li key={i}>
                            <span className="font-mono text-xs">{d.docNum}</span> -- {d.reason}
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {plan.newCreditNoteSample.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                      <h3 className="text-base font-semibold">New credit notes (sample)</h3>
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[700px] text-left text-sm">
                          <thead className="text-xs text-[#89948D]">
                            <tr>
                              <th className="py-2 pr-4 font-medium">DocNum</th>
                              <th className="py-2 pr-4 font-medium">Base invoice</th>
                              <th className="py-2 pr-4 font-medium">Amount</th>
                              <th className="py-2 pr-4 font-medium">Date</th>
                              <th className="py-2 font-medium">Resolved?</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plan.newCreditNoteSample.map((cn) => (
                              <tr key={`${cn.docEntry ?? "x"}-${cn.docNum}`} className="border-t border-[#EEF1ED]">
                                <td className="py-2 pr-4 font-mono text-xs">{cn.docNum}</td>
                                <td className="py-2 pr-4 text-xs">{cn.baseInvoiceDocNum ?? cn.baseInvoiceDocEntry ?? "-"}</td>
                                <td className="py-2 pr-4 text-xs">
                                  {cn.amount} {cn.currency ?? ""}
                                </td>
                                <td className="py-2 pr-4 text-xs">{cn.creditNoteDate ?? "-"}</td>
                                <td className="py-2 text-xs">
                                  {cn.resolvedSapInvoiceId ? "Resolved" : <span className="text-amber-600">Unresolved</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                    {nothingToImport ? (
                      <p className="text-sm text-[#5E7366]">Nothing to import -- every credit note in this file has already been imported.</p>
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
                            I have reviewed the preview and want to import {formatNumber(plan.summary.newCreditNoteCount)} new credit
                            note(s).
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
