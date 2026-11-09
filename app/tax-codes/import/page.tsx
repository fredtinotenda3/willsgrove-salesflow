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

type TaxCodeSample = { code: string; description: string | null; ratePercent: string };
type ChangedSample = { code: string; current: TaxCodeSample; incoming: TaxCodeSample };
type CsvError = { row: number; message: string };

type Preview = {
  fileName: string;
  summary: {
    totalRows: number;
    validRows: number;
    newCodes: number;
    changedCodes: number;
    unchangedCodes: number;
    errorCount: number;
  };
  newSample: TaxCodeSample[];
  changedSample: ChangedSample[];
  sampleLimit: number;
};

type ErrorReport = {
  message: string;
  errors: CsvError[];
  errorCount: number;
  errorsTruncated: boolean;
  duplicateCodes: string[];
};

type ImportResult = {
  fileName: string;
  importExecuted: boolean;
  message: string;
  summary: { created: number; updated: number; unchanged: number };
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
  duplicateCodes?: string[];
} & Record<string, unknown>;

async function readJson(response: Response): Promise<ApiResponseBody | null> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as ApiResponseBody) : null;
  } catch {
    return null;
  }
}

function display(value: string | null, fallback: string): string {
  return value === null || value === "" ? fallback : value;
}

export default function TaxCodeImportPage() {
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

      const response = await fetch("/api/tax-codes/import/preview", {
        method: "POST",
        body: formData,
      });

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
          duplicateCodes: body.duplicateCodes ?? [],
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
      formData.append("expectedNewCodes", String(preview.summary.newCodes));
      formData.append("expectedChangedCodes", String(preview.summary.changedCodes));

      const response = await fetch("/api/tax-codes/import", { method: "POST", body: formData });
      const body = await readJson(response);

      if (response.ok && body?.success) {
        setResult(body as unknown as ImportResult);
        setStage("done");
        return;
      }

      if (response.status === 409) {
        setPreview(null);
        setConfirmed(false);
        setNotice(body?.message ?? "The tax-code data changed since the preview. Please check the file again.");
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
    preview !== null && preview.summary.newCodes === 0 && preview.summary.changedCodes === 0;

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / SAP master data / Tax codes</p>
            <h1 className="mt-1 text-lg font-semibold">Tax code import</h1>
          </div>
        </header>

        <div className="mx-auto max-w-[1100px] p-5 md:p-9">
          <Link href="/products" className="mb-5 inline-flex items-center gap-2 text-sm text-[#5E7366] hover:text-[#315C43]">
            <ArrowLeft size={15} />
            Back to workspace
          </Link>

          <div className="mb-7">
            <h2 className="text-2xl font-semibold tracking-tight">Import SAP tax codes</h2>
            <p className="mt-1 text-sm text-[#7D8981]">
              VAT varies per item in SAP -- never a flat rate. Upload the list of SAP tax codes and
              their rates (e.g. zero-rated, standard-rated) before importing item master data, so the
              item import can recognize each item&apos;s VAT code. See the column layout at{" "}
              <code className="rounded bg-[#EEF1ED] px-1 py-0.5 text-xs">docs/sap-exports/tax-codes.csv.md</code>.
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
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <SummaryCard label="Created" value={result.summary.created} />
                <SummaryCard label="Updated" value={result.summary.updated} />
                <SummaryCard label="Unchanged" value={result.summary.unchanged} />
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link href="/item-master/import" className="rounded-lg bg-[#315C43] px-4 py-2 text-sm font-medium text-white hover:bg-[#274D37]">
                  Next: import item master data
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
                      {file ? file.name : "Choose a tax-code CSV file"}
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
                  {errorReport.errorsTruncated && (
                    <p className="mt-3 text-xs text-[#9B3B3B]">
                      Only the first {errorReport.errors.length} problems are shown.
                    </p>
                  )}
                </section>
              )}

              {preview && (
                <>
                  <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                    <h3 className="text-base font-semibold">Preview: {preview.fileName}</h3>
                    <p className="mt-1 text-sm text-[#7D8981]">The file is valid. Nothing has been saved yet.</p>

                    <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
                      <SummaryCard label="Rows in file" value={preview.summary.totalRows} />
                      <SummaryCard label="New codes" value={preview.summary.newCodes} />
                      <SummaryCard label="Changed codes" value={preview.summary.changedCodes} />
                      <SummaryCard label="Unchanged" value={preview.summary.unchangedCodes} />
                    </div>
                  </section>

                  {preview.newSample.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                      <h3 className="text-base font-semibold">New tax codes</h3>
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[500px] text-left text-sm">
                          <thead className="text-xs text-[#89948D]">
                            <tr>
                              <th className="py-2 pr-4 font-medium">Code</th>
                              <th className="py-2 pr-4 font-medium">Description</th>
                              <th className="py-2 font-medium">Rate %</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.newSample.map((row) => (
                              <tr key={row.code} className="border-t border-[#EEF1ED]">
                                <td className="py-2 pr-4 font-mono text-xs">{row.code}</td>
                                <td className="py-2 pr-4">{display(row.description, "-")}</td>
                                <td className="py-2">{row.ratePercent}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  {preview.changedSample.length > 0 && (
                    <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                      <h3 className="text-base font-semibold">Changed tax codes</h3>
                      <div className="mt-4 overflow-x-auto">
                        <table className="w-full min-w-[600px] text-left text-sm">
                          <thead className="text-xs text-[#89948D]">
                            <tr>
                              <th className="py-2 pr-4 font-medium">Code</th>
                              <th className="py-2 pr-4 font-medium">Current rate</th>
                              <th className="py-2 font-medium">Incoming rate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.changedSample.map((change) => (
                              <tr key={change.code} className="border-t border-[#EEF1ED]">
                                <td className="py-2 pr-4 font-mono text-xs">{change.code}</td>
                                <td className="py-2 pr-4">{change.current.ratePercent}%</td>
                                <td className="py-2">{change.incoming.ratePercent}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  )}

                  <section className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                    {nothingToImport ? (
                      <p className="text-sm text-[#5E7366]">Nothing to import. All tax codes are already up to date.</p>
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
                            I have reviewed the preview and want to import {formatNumber(preview.summary.newCodes)} new
                            and update {formatNumber(preview.summary.changedCodes)} existing tax code(s).
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
