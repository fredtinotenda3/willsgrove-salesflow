"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  Upload,
  XCircle,
} from "lucide-react";
import Sidebar from "../../components/sidebar";

type PasteChannel = "EMAIL" | "WHATSAPP";

type ListItem = {
  id: string;
  originalFileName: string;
  sourceChannel: string | null;
  classification: string | null;
  status: string;
  fileSize: number;
  createdAt: string;
  uploadedBy: { id: string; name: string };
};

type ExtractionRunSummary = {
  id: string;
  provider: string;
  model: string | null;
  promptVersion: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  processingTimeMs: number | null;
  errorMessage: string | null;
  extractedHeader: {
    customerNameRaw: string | null;
    storeOrBranchRaw: string | null;
    customerPoNumber: string | null;
    poDate: string | null;
    requestedDeliveryDate: string | null;
    deliveryAddressRaw: string | null;
    currencyRaw: string | null;
    senderInfoRaw: string | null;
  } | null;
  extractedLines:
    | {
        lineNumber: number;
        originalDescription: string;
        extractedQuantity: string | null;
        extractedUnit: string | null;
        customerProvidedUnitPrice: string | null;
        confidence: number | null;
        warnings: string[];
      }[]
    | null;
};

type DocumentDetail = {
  id: string;
  originalFileName: string;
  mimeType: string;
  fileSize: number;
  sourceChannel: string | null;
  classification: string | null;
  status: string;
  createdAt: string;
  uploadedBy: { id: string; name: string };
  extractionRuns: ExtractionRunSummary[];
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; className: string; icon: typeof Clock }> = {
    RECEIVED: { label: "Received", className: "bg-[#EEF1ED] text-[#5E7366]", icon: Clock },
    CLASSIFIED: { label: "Classified", className: "bg-[#EEF1ED] text-[#5E7366]", icon: Clock },
    EXTRACTING: { label: "Extracting…", className: "bg-[#FFF4DF] text-[#9A6B10]", icon: RefreshCw },
    EXTRACTED: { label: "Extracted", className: "bg-[#E8F5EC] text-[#1F7A43]", icon: CheckCircle2 },
    EXTRACTION_FAILED: { label: "Extraction failed", className: "bg-[#FFF6F6] text-[#9B3B3B]", icon: XCircle },
    CONFIRMED: { label: "Confirmed", className: "bg-[#E8F5EC] text-[#1F7A43]", icon: CheckCircle2 },
  };
  const entry = map[status] ?? { label: status, className: "bg-[#EEF1ED] text-[#5E7366]", icon: Clock };
  const Icon = entry.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${entry.className}`}>
      <Icon size={12} />
      {entry.label}
    </span>
  );
}

async function readJson(response: Response): Promise<{ success?: boolean; message?: string } & Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export default function PoIntakePage() {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"file" | "paste">("file");
  const [pasteChannel, setPasteChannel] = useState<PasteChannel>("WHATSAPP");
  const [pastedText, setPastedText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitNotice, setSubmitNotice] = useState<string | null>(null);

  const [documents, setDocuments] = useState<ListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  async function loadList() {
    setListLoading(true);
    setListError(null);
    try {
      const response = await fetch("/api/po-intake", { cache: "no-store" });
      const body = await readJson(response);
      if (response.ok && body.success) {
        setDocuments((body.documents as ListItem[]) ?? []);
      } else {
        setListError(body.message ?? "Unable to load PO intake documents.");
      }
    } catch {
      setListError("Could not reach the server.");
    } finally {
      setListLoading(false);
    }
  }

  async function loadDetail(id: string) {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await fetch(`/api/po-intake/${id}`, { cache: "no-store" });
      const body = await readJson(response);
      if (response.ok && body.success) {
        setDetail(body.document as DocumentDetail);
      } else {
        setDetailError(body.message ?? "Unable to load this document.");
        setDetail(null);
      }
    } catch {
      setDetailError("Could not reach the server.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => loadList());
  }, []);

  useEffect(() => {
    if (selectedId) {
      void Promise.resolve().then(() => loadDetail(selectedId));
    }
  }, [selectedId]);

  function selectDocument(id: string) {
    setSelectedId(id);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError(null);
    setSubmitNotice(null);
    setSubmitting(true);

    try {
      let response: Response;

      if (mode === "file") {
        const file = fileInputRef.current?.files?.[0];
        if (!file) {
          setSubmitError("Choose a file first.");
          setSubmitting(false);
          return;
        }
        const formData = new FormData();
        formData.set("file", file);
        response = await fetch("/api/po-intake", { method: "POST", body: formData });
      } else {
        if (pastedText.trim() === "") {
          setSubmitError("Paste some order text first.");
          setSubmitting(false);
          return;
        }
        response = await fetch("/api/po-intake", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ channel: pasteChannel, pastedText }),
        });
      }

      const body = await readJson(response);

      if (response.ok && body.success) {
        setSubmitNotice(
          body.extraction && (body.extraction as { outcome: string }).outcome === "succeeded"
            ? "Document received and extracted. See it below."
            : "Document received, but extraction failed -- see below (you can retry)."
        );
        setPastedText("");
        if (fileInputRef.current) fileInputRef.current.value = "";
        await loadList();
        setSelectedId(body.documentId as string);
      } else {
        setSubmitError(body.message ?? "Unable to process this submission.");
      }
    } catch {
      setSubmitError("Could not reach the server.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleReExtract(id: string) {
    setDetailError(null);
    try {
      const response = await fetch(`/api/po-intake/${id}/re-extract`, { method: "POST" });
      const body = await readJson(response);
      if (response.ok && body.success) {
        await loadList();
        await loadDetail(id);
      } else {
        setDetailError(body.message ?? "Unable to re-run extraction.");
      }
    } catch {
      setDetailError("Could not reach the server.");
    }
  }

  const latestRun = detail?.extractionRuns[0] ?? null;

  return (
    <div className="flex min-h-screen bg-[#F7F8F6] text-[#17251E]">
      <Sidebar />

      <main className="min-w-0 flex-1 md:ml-[260px]">
        <header className="flex h-[76px] items-center justify-between border-b border-[#E8ECE7] bg-white px-5 md:px-9">
          <div>
            <p className="text-xs text-[#89948D]">Workspace / Orders / PO intake</p>
            <h1 className="mt-1 text-lg font-semibold">PO intake (Milestone 2A)</h1>
          </div>
          <button
            onClick={loadList}
            disabled={listLoading}
            className="inline-flex items-center gap-2 rounded-lg border border-[#E5EAE4] bg-white px-3 py-2 text-xs font-medium hover:bg-[#F7F8F6] disabled:opacity-50"
          >
            <RefreshCw size={14} className={listLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </header>

        <div className="mx-auto max-w-[1200px] p-5 md:p-9">
          <Link href="/orders" className="mb-5 inline-flex items-center gap-2 text-sm text-[#5E7366] hover:text-[#315C43]">
            <ArrowLeft size={15} />
            Back to orders
          </Link>

          <div className="mb-7">
            <h2 className="text-2xl font-semibold tracking-tight">Receive and extract a purchase order</h2>
            <p className="mt-1 text-sm text-[#7D8981]">
              Upload a PDF, image, Excel, or CSV purchase order, or paste WhatsApp/email text. Once a document
              is extracted, open its review workspace to resolve the customer/product matches and confirm it
              into a real order.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
            {/* Upload / paste card */}
            <section className="rounded-2xl border border-[#E8ECE7] bg-white p-6">
              <div className="mb-4 flex rounded-lg border border-[#E5EAE4] p-1 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setMode("file")}
                  className={`flex-1 rounded-md px-3 py-1.5 ${mode === "file" ? "bg-[#10271F] text-white" : "text-[#5E7366]"}`}
                >
                  Upload file
                </button>
                <button
                  type="button"
                  onClick={() => setMode("paste")}
                  className={`flex-1 rounded-md px-3 py-1.5 ${mode === "paste" ? "bg-[#10271F] text-white" : "text-[#5E7366]"}`}
                >
                  Paste text
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === "file" ? (
                  <div>
                    <label className="mb-1.5 block text-xs font-medium text-[#5E7366]">
                      PDF, image (JPEG/PNG), Excel (.xlsx), or CSV
                    </label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.xlsx,.csv"
                      className="block w-full rounded-lg border border-[#E5EAE4] px-3 py-2 text-sm"
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex gap-2 text-xs font-medium">
                      <button
                        type="button"
                        onClick={() => setPasteChannel("WHATSAPP")}
                        className={`rounded-lg border px-3 py-1.5 ${
                          pasteChannel === "WHATSAPP" ? "border-[#10271F] bg-[#10271F] text-white" : "border-[#E5EAE4] text-[#5E7366]"
                        }`}
                      >
                        WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => setPasteChannel("EMAIL")}
                        className={`rounded-lg border px-3 py-1.5 ${
                          pasteChannel === "EMAIL" ? "border-[#10271F] bg-[#10271F] text-white" : "border-[#E5EAE4] text-[#5E7366]"
                        }`}
                      >
                        Email
                      </button>
                    </div>
                    <textarea
                      value={pastedText}
                      onChange={(event) => setPastedText(event.target.value)}
                      rows={8}
                      placeholder={"10 Baby Marrow 250g\n5 Tomatoes box\n..."}
                      className="block w-full rounded-lg border border-[#E5EAE4] px-3 py-2 text-sm"
                    />
                  </div>
                )}

                {submitError && (
                  <div className="flex items-start gap-2 rounded-lg border border-[#F1D9D9] bg-[#FFF6F6] px-3 py-2 text-xs text-[#9B3B3B]">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                    <p>{submitError}</p>
                  </div>
                )}
                {submitNotice && (
                  <div className="flex items-start gap-2 rounded-lg border border-[#D9EFE0] bg-[#F0FBF4] px-3 py-2 text-xs text-[#1F7A43]">
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
                    <p>{submitNotice}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#D7F36B] px-4 py-2.5 text-sm font-semibold text-[#10271F] hover:brightness-95 disabled:opacity-50"
                >
                  <Upload size={15} />
                  {submitting ? "Submitting…" : "Submit"}
                </button>
              </form>
            </section>

            {/* List + detail */}
            <section className="min-w-0">
              {listError && (
                <div className="mb-4 flex items-start gap-3 rounded-xl border border-[#F1D9D9] bg-[#FFF6F6] px-4 py-3 text-sm text-[#9B3B3B]">
                  <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                  <p>{listError}</p>
                </div>
              )}

              <div className="rounded-2xl border border-[#E8ECE7] bg-white">
                <div className="border-b border-[#EEF1ED] px-5 py-3 text-sm font-semibold">Recent intake documents</div>
                {listLoading && documents.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-[#7D8981]">Loading…</p>
                ) : documents.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-[#7D8981]">No documents submitted yet.</p>
                ) : (
                  <div className="divide-y divide-[#EEF1ED]">
                    {documents.map((document) => (
                      <button
                        key={document.id}
                        onClick={() => selectDocument(document.id)}
                        className={`flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm hover:bg-[#F7F8F6] ${
                          selectedId === document.id ? "bg-[#F7F8F6]" : ""
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-3">
                          <FileText size={16} className="shrink-0 text-[#89948D]" />
                          <span className="min-w-0 truncate">
                            <span className="block truncate font-medium">{document.originalFileName}</span>
                            <span className="block text-xs text-[#89948D]">
                              {document.sourceChannel ?? "—"} · {formatBytes(document.fileSize)} ·{" "}
                              {document.uploadedBy.name} · {new Date(document.createdAt).toLocaleString()}
                            </span>
                          </span>
                        </span>
                        <StatusBadge status={document.status} />
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {selectedId && (
                <div className="mt-6 rounded-2xl border border-[#E8ECE7] bg-white p-6">
                  {detailLoading && !detail ? (
                    <p className="text-sm text-[#7D8981]">Loading…</p>
                  ) : detailError ? (
                    <div className="flex items-start gap-2 rounded-lg border border-[#F1D9D9] bg-[#FFF6F6] px-3 py-2 text-xs text-[#9B3B3B]">
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <p>{detailError}</p>
                    </div>
                  ) : detail ? (
                    <>
                      <div className="mb-4 flex items-start justify-between gap-4">
                        <div>
                          <h3 className="text-base font-semibold">{detail.originalFileName}</h3>
                          <p className="mt-1 text-xs text-[#89948D]">
                            {detail.sourceChannel ?? "—"} · {detail.classification ?? "not yet classified"} ·{" "}
                            {formatBytes(detail.fileSize)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge status={detail.status} />
                          {detail.status === "EXTRACTION_FAILED" && (
                            <button
                              onClick={() => handleReExtract(detail.id)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5EAE4] bg-white px-3 py-1.5 text-xs font-medium hover:bg-[#F7F8F6]"
                            >
                              <RefreshCw size={13} />
                              Retry extraction
                            </button>
                          )}
                          {(detail.status === "EXTRACTED" || detail.status === "CONFIRMED") && (
                            <Link
                              href={`/orders/intake/${detail.id}/review`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D7F36B] px-3 py-1.5 text-xs font-semibold text-[#10271F] hover:brightness-95"
                            >
                              {detail.status === "CONFIRMED" ? "View review" : "Review & confirm"}
                            </Link>
                          )}
                        </div>
                      </div>

                      {latestRun && (
                        <>
                          <p className="mb-4 text-xs text-[#89948D]">
                            Latest run: {latestRun.provider}
                            {latestRun.model ? ` (${latestRun.model})` : ""} · schema {latestRun.promptVersion} ·{" "}
                            {latestRun.processingTimeMs ?? "—"} ms
                          </p>

                          {latestRun.status === "FAILED" && (
                            <div className="mb-4 flex items-start gap-2 rounded-lg border border-[#F1D9D9] bg-[#FFF6F6] px-3 py-2 text-xs text-[#9B3B3B]">
                              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                              <p>{latestRun.errorMessage}</p>
                            </div>
                          )}

                          {latestRun.extractedHeader && (
                            <div className="mb-5 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
                              <HeaderField label="Customer" value={latestRun.extractedHeader.customerNameRaw} />
                              <HeaderField label="Store/branch" value={latestRun.extractedHeader.storeOrBranchRaw} />
                              <HeaderField label="Customer PO #" value={latestRun.extractedHeader.customerPoNumber} />
                              <HeaderField label="PO date" value={latestRun.extractedHeader.poDate} />
                              <HeaderField label="Requested delivery" value={latestRun.extractedHeader.requestedDeliveryDate} />
                              <HeaderField label="Currency" value={latestRun.extractedHeader.currencyRaw} />
                              <HeaderField label="Delivery address" value={latestRun.extractedHeader.deliveryAddressRaw} />
                              <HeaderField label="Sender" value={latestRun.extractedHeader.senderInfoRaw} />
                            </div>
                          )}

                          {latestRun.extractedLines && latestRun.extractedLines.length > 0 && (
                            <div className="overflow-x-auto">
                              <table className="w-full min-w-[640px] text-left text-sm">
                                <thead className="text-xs text-[#89948D]">
                                  <tr>
                                    <th className="py-2 pr-3 font-medium">#</th>
                                    <th className="py-2 pr-3 font-medium">Original description</th>
                                    <th className="py-2 pr-3 font-medium">Qty</th>
                                    <th className="py-2 pr-3 font-medium">Unit</th>
                                    <th className="py-2 pr-3 font-medium">Confidence</th>
                                    <th className="py-2 font-medium">Warnings</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {latestRun.extractedLines.map((line) => (
                                    <tr key={line.lineNumber} className="border-t border-[#EEF1ED] align-top">
                                      <td className="py-2 pr-3">{line.lineNumber}</td>
                                      <td className="py-2 pr-3">{line.originalDescription}</td>
                                      <td className="py-2 pr-3">{line.extractedQuantity ?? "—"}</td>
                                      <td className="py-2 pr-3">{line.extractedUnit ?? "—"}</td>
                                      <td className="py-2 pr-3">
                                        {line.confidence !== null ? `${Math.round(line.confidence * 100)}%` : "—"}
                                      </td>
                                      <td className="py-2 text-xs text-[#9A6B10]">
                                        {line.warnings.length > 0 ? line.warnings.join(" ") : ""}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {latestRun.extractedLines && latestRun.extractedLines.length === 0 && latestRun.status === "SUCCEEDED" && (
                            <p className="text-sm text-[#7D8981]">
                              No order lines were extracted -- the document was classified as{" "}
                              <span className="font-medium">{detail.classification}</span>, not a customer order.
                            </p>
                          )}
                        </>
                      )}
                    </>
                  ) : null}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

function HeaderField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-[#89948D]">{label}</p>
      <p className="mt-0.5 truncate">{value ?? "—"}</p>
    </div>
  );
}
