"use client";

import { useEffect, useState } from "react";
import { Clipboard, Download, FileSpreadsheet, FileText, Loader2, RefreshCw } from "lucide-react";

/**
 * Milestone 2C, reworked in Milestone 3C (SAP Invoice Handover
 * Specification). The one client-rendered "island" on an otherwise async
 * Server Component page (app/orders/[id]/page.tsx stays a Server
 * Component for everything else -- see that file's module comment).
 * Manual, per-order handover generation only, per the approved scope:
 * no automatic-on-confirm, no scheduled/batch run. Every click is a
 * real, append-only OrderHandover row (never overwritten, never
 * deduplicated), so this panel always re-fetches the list after a
 * successful generate rather than optimistically inserting a row.
 *
 * Milestone 3C: takes `readyToInvoice` (a derived boolean computed
 * server-side on the page, same pattern 3B established for
 * PickingPanel's `canAuthorize` -- never the full order object) and
 * disables the three Generate buttons with an explanation when it's
 * false, so a user sees *why* up front rather than clicking through to a
 * 409 the server already enforces (lib/handover/build-handover-rows.ts's
 * hard gate). This is UX only -- the real enforcement is server-side and
 * stays that way regardless of what this prop says.
 */

type HandoverFormat = "EXCEL" | "CSV" | "CLIPBOARD";

type HandoverListEntry = {
  id: string;
  /** Nullable only for a handover generated before Milestone 3C added this field. */
  reference: string | null;
  format: HandoverFormat;
  lineCount: number;
  matchedLineCount: number;
  unmatchedLineCount: number;
  originalFileName: string | null;
  fileSize: number | null;
  createdAt: string;
  generatedBy: { id: string; name: string } | null;
  downloadUrl: string | null;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function formatLabel(format: HandoverFormat): string {
  switch (format) {
    case "EXCEL":
      return "Excel";
    case "CSV":
      return "CSV";
    case "CLIPBOARD":
      return "Clipboard";
  }
}

function formatFileSize(bytes: number | null): string {
  if (bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function HandoverPanel({ orderId, readyToInvoice }: { orderId: string; readyToInvoice: boolean }) {
  const [handovers, setHandovers] = useState<HandoverListEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [generatingFormat, setGeneratingFormat] = useState<HandoverFormat | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<"idle" | "copied" | "copy-failed">("idle");

  async function load() {
    setLoading(true);
    setListError(null);
    try {
      const response = await fetch(`/api/orders/${orderId}/handover`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setListError((body.message as string) ?? "Unable to load this order's handovers.");
        return;
      }
      setHandovers((body.handovers as HandoverListEntry[]) ?? []);
    } catch {
      setListError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Same reasoning as app/orders/intake/[id]/review/page.tsx's mount
    // effect: wrapping in Promise.resolve().then(...) rather than calling
    // load() directly avoids react-hooks/set-state-in-effect's "calling
    // setState synchronously within an effect" lint error, since load()
    // itself calls setState before any await.
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  async function generate(format: HandoverFormat) {
    setGeneratingFormat(format);
    setGenerateError(null);
    setClipboardStatus("idle");
    try {
      const response = await fetch(`/api/orders/${orderId}/handover`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format }),
      });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setGenerateError((body.message as string) ?? "Unable to generate this handover.");
        return;
      }

      const handover = body.handover as { clipboardText?: string };
      if (format === "CLIPBOARD" && handover.clipboardText) {
        try {
          await navigator.clipboard.writeText(handover.clipboardText);
          setClipboardStatus("copied");
        } catch {
          setClipboardStatus("copy-failed");
          setGenerateError("Generated, but couldn't access the clipboard -- try again or use CSV instead.");
        }
      }

      await load();
    } catch {
      setGenerateError("Could not reach the server.");
    } finally {
      setGeneratingFormat(null);
    }
  }

  return (
    <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-bold text-[#17251E]">SAP Invoice Handover</h2>
          <p className="mt-1 text-xs text-gray-400">
            Generate the order&apos;s authorized picked quantities, with official SAP descriptions, for the invoice
            team.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {!readyToInvoice && (
        <p className="mt-3 text-[11px] text-[#9A6B10]">
          This order isn&apos;t ready yet -- picking must be completed and authorized before a handover can be
          generated.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void generate("EXCEL")}
          disabled={generatingFormat !== null || !readyToInvoice}
          className="flex items-center gap-1.5 rounded-lg bg-[#173D2E] px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {generatingFormat === "EXCEL" ? <Loader2 size={13} className="animate-spin" /> : <FileSpreadsheet size={13} />}
          Generate Excel
        </button>
        <button
          type="button"
          onClick={() => void generate("CSV")}
          disabled={generatingFormat !== null || !readyToInvoice}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          {generatingFormat === "CSV" ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
          Generate CSV
        </button>
        <button
          type="button"
          onClick={() => void generate("CLIPBOARD")}
          disabled={generatingFormat !== null || !readyToInvoice}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
        >
          {generatingFormat === "CLIPBOARD" ? <Loader2 size={13} className="animate-spin" /> : <Clipboard size={13} />}
          Copy to clipboard
        </button>
      </div>

      {clipboardStatus === "copied" && (
        <p className="mt-2 text-[11px] font-medium text-[#1F7A43]">
          Copied to your clipboard -- paste it wherever the invoice team needs it next.
        </p>
      )}
      {generateError && <p className="mt-2 text-[11px] text-[#9B3B3B]">{generateError}</p>}

      <div className="mt-5 border-t border-gray-100 pt-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Past handovers</p>

        {loading && !handovers ? (
          <p className="text-xs text-gray-400">Loading…</p>
        ) : listError ? (
          <p className="text-xs text-[#9B3B3B]">{listError}</p>
        ) : !handovers || handovers.length === 0 ? (
          <p className="text-xs text-gray-400">No handovers generated yet.</p>
        ) : (
          <ul className="space-y-2">
            {handovers.map((handover) => (
              <li key={handover.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-700">
                    {formatLabel(handover.format)}
                    {handover.fileSize !== null && <span className="font-normal text-gray-400"> · {formatFileSize(handover.fileSize)}</span>}
                  </p>
                  {handover.reference && <p className="mt-0.5 text-[10px] font-medium text-gray-500">{handover.reference}</p>}
                  <p className="mt-0.5 text-[10px] text-gray-400">
                    {handover.lineCount} line{handover.lineCount === 1 ? "" : "s"}
                    {handover.unmatchedLineCount > 0 && (
                      <span className="text-[#9A6B10]"> · {handover.unmatchedLineCount} unmatched</span>
                    )}
                    {" · "}
                    {formatDateTime(handover.createdAt)} · {handover.generatedBy?.name ?? "unknown"}
                  </p>
                </div>
                {handover.downloadUrl ? (
                  <a
                    href={handover.downloadUrl}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 transition hover:bg-gray-50"
                  >
                    <Download size={12} />
                    Download
                  </a>
                ) : (
                  <span className="shrink-0 text-[10px] text-gray-400">Not stored</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
