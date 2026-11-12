"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Download, FileInput, Link2, Ban, Copy } from "lucide-react";

/**
 * Milestone 10 (Communication Channels & Fulfilment). The one client
 * island for app/communications/inbox/[id]/page.tsx -- every review
 * action (convert/link/ignore/duplicate) against the Milestone 10 API,
 * same "re-fetch after every mutation, never optimistic" convention as
 * app/fulfilment/[id]/picking-panel.tsx.
 */

type Attachment = { id: string; originalFileName: string; mimeType: string; fileSize: number };

type IntakeDetail = {
  id: string;
  channel: string;
  status: string;
  fromAddress: string;
  fromDisplayName: string | null;
  subject: string | null;
  bodyText: string | null;
  receivedAt: string;
  customer: { id: string; name: string; email: string | null; phone: string | null } | null;
  customerContact: { id: string; name: string; email: string | null; phone: string | null } | null;
  reviewedBy: { id: string; name: string } | null;
  reviewedAt: string | null;
  reviewNotes: string | null;
  resultingOrderDocumentId: string | null;
  linkedOrder: { id: string; reference: string } | null;
  linkedQuotation: { id: string; quotationNumber: string } | null;
  duplicateOfId: string | null;
  attachments: Attachment[];
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    const data: unknown = await response.json();
    return data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function ReviewPanel({ messageIntakeId }: { messageIntakeId: string }) {
  const [intake, setIntake] = useState<IntakeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [attachmentId, setAttachmentId] = useState<string>("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [targetType, setTargetType] = useState<"ORDER" | "QUOTATION">("ORDER");
  const [targetId, setTargetId] = useState("");
  const [duplicateOfId, setDuplicateOfId] = useState("");

  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/channels/intake/${messageIntakeId}`, { cache: "no-store" });
      const body = await readJson(response);
      if (!response.ok || !body.success) {
        setLoadError((body.message as string) ?? "Unable to load this message.");
        return;
      }
      setIntake(body.intake as IntakeDetail);
    } catch {
      setLoadError("Could not reach the server.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void Promise.resolve().then(() => load());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messageIntakeId]);

  async function runAction(action: string, path: string, body: Record<string, unknown>) {
    setActionPending(action);
    setActionError(null);
    try {
      const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const parsed = await readJson(response);
      if (!response.ok || !parsed.success) {
        setActionError((parsed.message as string) ?? "That action failed.");
        return;
      }
      await load();
    } catch {
      setActionError("Could not reach the server.");
    } finally {
      setActionPending(null);
    }
  }

  if (loading && !intake) {
    return (
      <section className="flex items-center justify-center rounded-xl border border-[#E8EBE6] bg-white p-12">
        <Loader2 size={20} className="animate-spin text-gray-400" />
      </section>
    );
  }

  if (loadError || !intake) {
    return (
      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <p className="text-xs text-[#9B3B3B]">{loadError ?? "Message not found."}</p>
      </section>
    );
  }

  const actionable = intake.status === "RECEIVED";

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-lg font-bold text-[#17251E]">{intake.subject ?? "No subject"}</h1>
            <p className="mt-1 text-xs text-gray-500">
              {intake.channel} from {intake.fromDisplayName ? `${intake.fromDisplayName} ` : ""}
              <span className="text-gray-400">{intake.fromAddress}</span> · {formatDateTime(intake.receivedAt)}
            </p>
          </div>
          <span className="rounded-full bg-gray-100 px-3 py-1.5 text-[11px] font-semibold text-gray-600">{intake.status}</span>
        </div>

        {intake.bodyText && (
          <div className="mt-4 whitespace-pre-wrap rounded-lg border border-gray-100 bg-gray-50/60 p-4 text-xs text-gray-700">{intake.bodyText}</div>
        )}

        {intake.customer && (
          <p className="mt-4 text-xs text-gray-500">
            Matched customer: <span className="font-semibold text-gray-700">{intake.customer.name}</span>
            {intake.customerContact ? ` (contact: ${intake.customerContact.name})` : ""}
          </p>
        )}

        {intake.attachments.length > 0 && (
          <div className="mt-4 space-y-1.5">
            <p className="text-[11px] font-semibold text-gray-500">Attachments</p>
            {intake.attachments.map((attachment) => (
              <div key={attachment.id} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2 text-xs">
                <span className="text-gray-700">
                  {attachment.originalFileName} <span className="text-gray-400">({formatBytes(attachment.fileSize)})</span>
                </span>
                <a
                  href={`/api/channels/intake/${intake.id}/attachments/${attachment.id}`}
                  className="flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]"
                >
                  <Download size={12} /> Download
                </a>
              </div>
            ))}
          </div>
        )}
      </section>

      {!actionable ? (
        <section className="rounded-xl border border-[#E8EBE6] bg-white p-6">
          <p className="text-xs font-semibold text-gray-700">
            {intake.status === "CONVERTED" && "Converted to a PO intake."}
            {intake.status === "LINKED" && "Linked to an existing order or quotation."}
            {intake.status === "IGNORED" && "Ignored."}
            {intake.status === "DUPLICATE" && "Marked as a duplicate of an earlier message."}
          </p>
          <p className="mt-1 text-[11px] text-gray-400">
            {intake.reviewedBy ? `By ${intake.reviewedBy.name} on ${formatDateTime(intake.reviewedAt)}` : ""}
          </p>
          {intake.reviewNotes && <p className="mt-2 text-xs text-gray-600">&quot;{intake.reviewNotes}&quot;</p>}
          <div className="mt-3 flex gap-4 text-xs">
            {intake.resultingOrderDocumentId && (
              <Link href="/orders/intake" className="font-semibold text-[#173D2E] hover:underline">
                View in PO Intake →
              </Link>
            )}
            {intake.linkedOrder && (
              <Link href={`/orders/${intake.linkedOrder.id}`} className="font-semibold text-[#173D2E] hover:underline">
                View order {intake.linkedOrder.reference} →
              </Link>
            )}
            {intake.linkedQuotation && (
              <Link href={`/quotations/${intake.linkedQuotation.id}`} className="font-semibold text-[#173D2E] hover:underline">
                View quotation {intake.linkedQuotation.quotationNumber} →
              </Link>
            )}
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          {actionError && (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-[#9B3B3B]">{actionError}</div>
          )}

          <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h2 className="text-[13px] font-bold text-[#17251E]">Convert to PO intake</h2>
            <p className="mt-1 text-xs text-gray-400">
              Sends the selected attachment (or the pasted message text, if there is no attachment) into the
              existing PO extraction pipeline, where it can be reviewed and confirmed into an order like any other
              intake.
            </p>
            {intake.attachments.length > 0 && (
              <select
                value={attachmentId}
                onChange={(e) => setAttachmentId(e.target.value)}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
              >
                <option value="">Use pasted message text instead</option>
                {intake.attachments.map((attachment) => (
                  <option key={attachment.id} value={attachment.id}>
                    {attachment.originalFileName}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={actionPending === "convert"}
              onClick={() =>
                void runAction("convert", `/api/channels/intake/${intake.id}/convert`, {
                  attachmentId: attachmentId || undefined,
                  reviewNotes: reviewNotes.trim() || undefined,
                })
              }
              className="mt-3 flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {actionPending === "convert" ? <Loader2 size={14} className="animate-spin" /> : <FileInput size={14} />}
              Convert to PO intake
            </button>
          </div>

          <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h2 className="text-[13px] font-bold text-[#17251E]">Link to an existing order or quotation</h2>
            <p className="mt-1 text-xs text-gray-400">For a follow-up message about something that already exists -- never creates a new order.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select value={targetType} onChange={(e) => setTargetType(e.target.value as "ORDER" | "QUOTATION")} className="rounded-lg border border-gray-200 px-3 py-2 text-xs">
                <option value="ORDER">Order</option>
                <option value="QUOTATION">Quotation</option>
              </select>
              <input
                type="text"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                placeholder={targetType === "ORDER" ? "Order id" : "Quotation id"}
                className="w-64 rounded-lg border border-gray-200 px-3 py-2 text-xs"
              />
              <button
                type="button"
                disabled={actionPending === "link" || !targetId.trim()}
                onClick={() =>
                  void runAction("link", `/api/channels/intake/${intake.id}/link`, {
                    targetType,
                    targetId: targetId.trim(),
                    reviewNotes: reviewNotes.trim() || undefined,
                  })
                }
                className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
              >
                {actionPending === "link" ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
                Link
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h2 className="text-[13px] font-bold text-[#17251E]">Mark as duplicate</h2>
            <p className="mt-1 text-xs text-gray-400">For a message that re-delivers an earlier one this inbox already has.</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={duplicateOfId}
                onChange={(e) => setDuplicateOfId(e.target.value)}
                placeholder="Original message id"
                className="w-64 rounded-lg border border-gray-200 px-3 py-2 text-xs"
              />
              <button
                type="button"
                disabled={actionPending === "duplicate" || !duplicateOfId.trim()}
                onClick={() =>
                  void runAction("duplicate", `/api/channels/intake/${intake.id}/duplicate`, {
                    duplicateOfId: duplicateOfId.trim(),
                    reviewNotes: reviewNotes.trim() || undefined,
                  })
                }
                className="flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
              >
                {actionPending === "duplicate" ? <Loader2 size={14} className="animate-spin" /> : <Copy size={14} />}
                Mark duplicate
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#E8EBE6] bg-white p-6">
            <h2 className="text-[13px] font-bold text-[#17251E]">Review notes (optional, applies to any action above)</h2>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              rows={2}
              className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-xs"
              placeholder="Staff-only notes about this decision"
            />
            <button
              type="button"
              disabled={actionPending === "ignore"}
              onClick={() => void runAction("ignore", `/api/channels/intake/${intake.id}/ignore`, { reviewNotes: reviewNotes.trim() || undefined })}
              className="mt-3 flex items-center gap-2 rounded-lg border border-gray-200 px-4 py-2.5 text-xs font-semibold text-[#9B3B3B] transition hover:bg-red-50 disabled:opacity-50"
            >
              {actionPending === "ignore" ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />}
              Ignore this message
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
