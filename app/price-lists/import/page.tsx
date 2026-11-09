"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import Sidebar from "../../components/sidebar";

type Stage = "idle" | "previewing" | "previewed" | "importing" | "done";

type ListDef = { code: string; name: string; currencyCode: string };
type ChangedList = { code: string; current: { name: string; currencyCode: string }; incoming: ListDef };
type NewEntry = { priceListCode: string; itemCode: string; unitPrice: string; currencyCode: string; validFrom: string; validTo: string | null };
type ChangedEntry = {
  priceListCode: string;
  itemCode: string;
  validFrom: string;
  current: { unitPrice: string; validTo: string | null };
  incoming: { unitPrice: string; validTo: string | null };
};
type CsvError = { row: number; message: string };

type Preview = {
  fileName: string;
  summary: {
    totalRows: number;
    validRows: number;
    newLists: number;
    changedLists: number;
    newEntries: number;
    changedEntries: number;
    unchangedEntries: number;
    unmatchedItemCodes: number;
  };
  newLists: ListDef[];
  changedLists: ChangedList[];
  newEntriesSample: NewEntry[];
  changedEntriesSample: ChangedEntry[];
  unmatchedItemCodes: string[];
  sampleLimit: number;
};

type ErrorReport = { message: string; errors: CsvError[]; errorCount: number; errorsTruncated: boolean };

type ImportResult = {
  fileName: string;
  importExecuted: boolean;
  message: string;
  summary: { listsCreated: number; listsUpdated: number; entriesCreated: number; entriesUpdated: number; entriesUnchanged: number };
};

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
}

type ApiResponseBody = {
  success?: boolean;
  message?: string;
  errors?: CsvError[];
  errorCount?: number;
  errorsTruncated?: boolean;
} & Record<string, unknown>;

async function readJson(response: Response): Promise<ApiResponseBody | null> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as ApiResponseBody) : null;
  } catch {
    return null;
  }
}

export default function PriceListImportPage() {
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [errorReport, setErrorReport] = useState<ErrorReport | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  function resetAll() {
    setFile(null);
    setStage("idle");
    setPreview(null);
    setErrorReport(null);
    setNotice(null);
    setResult(null);
    setConfirmed(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setStage("idle");
    setPreview(null);
    setErrorReport(null);
    setNotice(null);
    setResult(null);
    setConfirmed(false);
  }

  async function runPreview() {
    if (!file) return;
    setStage("previewing");
    setPreview(null);
    setErrorReport(null);
    setNotice(null);
    setConfirmed(false);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/price-lists/import/preview", { method: "POST", body: formData });
      const body = await readJson(response);

      if (response.ok && body?.success) {
        setPreview(body as unknown as Preview);
        setStage("previewed");
        return;
      }

      if (response.status === 422 && body && Array.isArray(body.errors)) {
        setErrorReport({
          message: body.message ?? "The CSV file contains validation errors.",
          errors: body.errors,
          errorCount: body.errorCount ?? body.errors.length,
          errorsTruncated: Boolean(body.errorsTruncated),
        });
        setStage("idle");
        return;
      }

      setNotice(body?.message ?? "Unable to check the file. Please try again.");
      setStage("idle");
    } catch {
      setNotice("Could not reach the server. Please try again.");
      setStage("idle");
    }
  }

  async function runImport() {
    if (!file || !preview || !confirmed) return;
    setStage("importing");
    setNotice(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("expectedNewEntries", String(preview.summary.newEntries));
      formData.append("expectedChangedEntries", String(preview.summary.changedEntries));

      const response = await fetch("/api/price-lists/import", { method: "POST", body: formData });
      const body = await readJson(response);

      if (response.ok && body?.success) {
        setResult(body as unknown as ImportResult);
        setStage("done");
        return;
      }

      if (response.status === 409) {
        setPreview(null);
        setConfirmed(false);
        setNotice(body?.message ?? "The price-list data changed since the preview. Please check the file again.");
        setStage("idle");
        return;
      }

      setNotice(body?.message ?? "The import failed. No changes were saved.");
      setStage("previewed");
    } catch {
      setNotice("Could not reach the server. Nothing is confirmed as imported.");
      setStage("previewed");
    }
  }

  const busy = stage === "previewing" || stage === "importing";
  const nothingToImport =
    preview !== null &&
    preview.summary.newLists === 0 &&
    preview.summary.changedLists === 0 &&
    preview.summary.newEntries === 0 &&
    preview.summary.changedEntries === 0;

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / SAP master data / Price lists</p>
            <h1 className="mt-1 text-lg font-semibold">Price list import</h1>
          </div>
        </header>

        <div className="mx-auto max-w-[1100px] p-5 md:p-9">
          <Link href="/products" className="mb-5 inline-flex items-center gap-2 text-sm text-[#5E7366] hover:text-[#315C43]">
            <ArrowLeft size={15} />
            Back to workspace
          </Link>

          <div className="mb-7">
            <h2 className="text-2xl font-semibold tracking-tight">Import price lists</h2>
            <p className="mt-1 text-sm text-[#7D8981]">
              One row per item per list, with a validity date range -- prices are kept as history, not
              overwritten, so a price change is a new row with a new VALID_FROM rather than an edit.
              Column layout: <code className="rounded bg-[#EEF1ED] px-1 py-0.5 text-xs">docs/sap-exports/price-lists.csv.md</code>.
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
              <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-5">
                <SummaryCard label="Lists created" value={result.summary.listsCreated} />
                <SummaryCard label="Lists updated" value={result.summary.listsUpdated} />
                <SummaryCard label="Entries created" value={result.summary.entriesCreated} />
                <SummaryCard label="Entries updated" value={result.summary.entriesUpdated} />
                <SummaryCard label="Entries unchanged" value={result.summary.entriesUnchanged} />
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/customers/master-import" className="rounded-lg bg-[#315C43] px-4 py-2 text-sm font-medium text-white hover:bg-[#274D37]">
                  Next: import customer master
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
                    <span className="min-w-0 flex-1 truncate text-sm">
                      {file ? file.name : "Choose a price-list CSV file"}
                    </span>
                    <input
                      ref={inputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={handleFileChange}
                      disabled={busy}
                      className="hidden"
                    />
                  </label>
                  <button
                    onClick={runPreview}
                    disabled={!file || busy}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#315C43] px-5 py-3 text-sm font-medium text-white hover:bg-[#274D37] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Upload size={15} />
                    {stage === "previewing" ? "Checking file..." : "Check file"}
                  </button>
                </div>
              </section>

              {errorReport && (
                <section className="mt-6 rounded-2xl border border-[#F1D9D9] bg-[#FFF6F6] p-6">
                  <h3 className="text-base font-semibold text-[#9B3B3B]">{errorReport.message}</h3>
                  <p className="mt-1 text-sm text-[#9B3B3B]">
                    Nothing can be imported until these are fixed in the file.
                    {errorReport.errorCount > 0 && ` ${formatNumber(errorReport.errorCount)} problem(s) found.`}
                  </p>
                  <ul className="mt-4 space-y-1 text-sm">
                    {errorReport.errors.map((error, index) => (
                      <li key={index}>
                        <span className="font-medium">Row {error.row}:</span> {error.message}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {preview && (
                <>
                  <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                    <h3 className="text-base font-semibold">Preview: {preview.fileName}</h3>
                    <p className="mt-1 text-sm text-[#7D8981]">The file is valid. Nothing has been saved yet.</p>
                    <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
                      <SummaryCard label="New price lists" value={preview.summary.newLists} />
                      <SummaryCard label="New price entries" value={preview.summary.newEntries} />
                      <SummaryCard label="Changed entries" value={preview.summary.changedEntries} />
                      <SummaryCard label="Unmatched items" value={preview.summary.unmatchedItemCodes} />
                    </div>
                  </section>

                  {preview.newLists.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                      <h3 className="text-base font-semibold">New price lists</h3>
                      <ul className="mt-3 space-y-1 text-sm">
                        {preview.newLists.map((l) => (
                          <li key={l.code}>
                            <span className="font-mono text-xs">{l.code}</span> — {l.name} ({l.currencyCode})
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {preview.unmatchedItemCodes.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#F0E3C2] bg-[#FFFAEE] p-6">
                      <h3 className="text-base font-semibold text-[#8A6212]">
                        Item codes not yet in Products ({formatNumber(preview.summary.unmatchedItemCodes)})
                      </h3>
                      <p className="mt-1 text-sm text-[#8A6212]">
                        These prices will still be saved, but won&apos;t link to a product page until that item
                        is imported: {preview.unmatchedItemCodes.join(", ")}.
                      </p>
                    </section>
                  )}

                  {preview.newEntriesSample.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                      <h3 className="text-base font-semibold">New price entries (sample)</h3>
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[700px] text-left text-sm">
                          <thead className="text-xs text-[#89948D]">
                            <tr>
                              <th className="py-2 pr-4 font-medium">List</th>
                              <th className="py-2 pr-4 font-medium">Item</th>
                              <th className="py-2 pr-4 font-medium">Price</th>
                              <th className="py-2 pr-4 font-medium">Valid from</th>
                              <th className="py-2 font-medium">Valid to</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.newEntriesSample.map((e, i) => (
                              <tr key={i} className="border-t border-[#EEF1ED]">
                                <td className="py-2 pr-4 font-mono text-xs">{e.priceListCode}</td>
                                <td className="py-2 pr-4 font-mono text-xs">{e.itemCode}</td>
                                <td className="py-2 pr-4">{e.unitPrice} {e.currencyCode}</td>
                                <td className="py-2 pr-4">{e.validFrom}</td>
                                <td className="py-2">{e.validTo ?? "open-ended"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      {preview.summary.newEntries > preview.newEntriesSample.length && (
                        <p className="mt-3 text-xs text-[#89948D]">
                          Showing {preview.newEntriesSample.length} of {formatNumber(preview.summary.newEntries)} new entries.
                        </p>
                      )}
                    </section>
                  )}

                  <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                    {nothingToImport ? (
                      <p className="text-sm text-[#5E7366]">Nothing to import. All price lists and entries are already up to date.</p>
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
                            I have reviewed the preview and want to create {formatNumber(preview.summary.newLists)} price
                            list(s) and {formatNumber(preview.summary.newEntries)} new price entries, and update{" "}
                            {formatNumber(preview.summary.changedEntries)} existing entries.
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
