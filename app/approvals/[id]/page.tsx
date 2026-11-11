import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import { getApprovalRequestById } from "@/lib/approvals/queries";
import {
  APPROVAL_STATUS_LABELS,
  APPROVAL_STATUS_STYLES,
  APPROVAL_MODULE_LABELS,
  APPROVAL_ACTION_TYPE_LABELS,
  APPROVAL_EVENT_LABELS,
} from "@/lib/approvals/display";
import { eligibleApproverRoles, isLiveStatus } from "@/lib/approvals/validation";
import Sidebar from "../../components/sidebar";
import { ArrowLeft } from "lucide-react";
import ApprovalActionsPanel from "./approval-actions-panel";

/**
 * Milestone 8 (spec section 8's "view detail of a specific approval
 * request... including before/after values"). Server Component for the
 * read side, mirroring app/invoice-claims/[id]/page.tsx's split:
 * ApprovalActionsPanel is the one client-rendered island for every
 * mutating action (approve/reject/withdraw/cancel).
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

const VALUE_LABELS: Record<string, string> = {
  maxDiscountPercent: "Max discount %",
  subtotal: "Subtotal",
  discountTotal: "Discount total",
  vatTotal: "VAT total",
  total: "Total",
  currency: "Currency",
  lineCount: "Line count",
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  return String(value);
}

export default async function ApprovalDetailPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const request = await getApprovalRequestById(id);
  if (!request) {
    notFound();
  }

  const canDecide =
    request.status === "PENDING" &&
    (user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR") &&
    eligibleApproverRoles(request.requiredApproverRole as "SALES_MANAGER" | "ADMINISTRATOR").includes(user.role);
  const canWithdraw = user.id === request.requestedBy.id && isLiveStatus(request.status as "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "WITHDRAWN");
  const canCancel = user.role === "ADMINISTRATOR" && isLiveStatus(request.status as "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED" | "WITHDRAWN");

  const targetHref = request.quotation ? `/quotations/${request.quotation.id}` : request.customerOrder ? `/orders/${request.customerOrder.id}` : null;
  const targetLabel = request.quotation
    ? `${request.quotation.quotationNumber}${request.quotation.revisionNumber > 1 ? ` (rev ${request.quotation.revisionNumber})` : ""}`
    : request.customerOrder
      ? request.customerOrder.reference
      : "-";

  const valueKeys = Object.keys(request.submittedValues);
  const staleKeys = request.currentValues
    ? valueKeys.filter((key) => String(request.submittedValues[key]) !== String(request.currentValues![key]))
    : [];

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Approvals / {APPROVAL_ACTION_TYPE_LABELS[request.actionType] ?? request.actionType}</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">{APPROVAL_ACTION_TYPE_LABELS[request.actionType] ?? request.actionType}</h2>
          </div>
          <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold ${APPROVAL_STATUS_STYLES[request.status] ?? "bg-gray-100 text-gray-500"}`}>
            {APPROVAL_STATUS_LABELS[request.status] ?? request.status}
          </span>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/approvals" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to approvals
          </Link>

          {request.isOverdue && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              This request has been pending longer than its policy&rsquo;s configured service-level window and is flagged overdue.
            </div>
          )}

          <section className="grid grid-cols-1 gap-4 rounded-xl border border-[#E8EBE6] bg-white p-5 sm:grid-cols-4">
            <Field label="Module" value={APPROVAL_MODULE_LABELS[request.module] ?? request.module} />
            <Field label="Target" value={targetLabel} link={targetHref ?? undefined} />
            <Field label="Requested by" value={request.requestedBy.name} />
            <Field label="Required approver role" value={request.requiredApproverRole} />
            <Field label="Submitted" value={new Date(request.submittedAt).toLocaleString()} />
            {request.decidedBy && <Field label={request.status === "REJECTED" ? "Rejected by" : "Decided by"} value={request.decidedBy.name} />}
            {request.decidedAt && <Field label="Decided at" value={new Date(request.decidedAt).toLocaleString()} />}
          </section>

          {request.reason && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h2 className="text-sm font-bold text-[#17251E]">Reason given at submission</h2>
              <p className="mt-2 whitespace-pre-wrap text-xs text-gray-600">{request.reason}</p>
            </section>
          )}

          {request.decisionReason && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h2 className="text-sm font-bold text-[#17251E]">Decision reason</h2>
              <p className="mt-2 whitespace-pre-wrap text-xs text-gray-600">{request.decisionReason}</p>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-bold text-[#17251E]">Submitted values vs. current values</h2>
              <p className="mt-1 text-[11px] text-gray-400">
                The exact figures this request was judged against, next to the target record&rsquo;s values right now. A
                mismatch means the record has changed since submission -- this approval no longer covers it, and the
                system automatically invalidates a live request as soon as this happens.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-y border-gray-100 bg-gray-50/70">
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Field</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Submitted</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Current</th>
                  </tr>
                </thead>
                <tbody>
                  {valueKeys.map((key) => {
                    const changed = staleKeys.includes(key);
                    return (
                      <tr key={key} className="border-b border-gray-50">
                        <td className="px-6 py-3 text-xs text-gray-500">{VALUE_LABELS[key] ?? key}</td>
                        <td className="whitespace-nowrap px-6 py-3 text-right text-xs text-gray-700">{formatValue(request.submittedValues[key])}</td>
                        <td className={`whitespace-nowrap px-6 py-3 text-right text-xs ${changed ? "font-semibold text-amber-700" : "text-gray-700"}`}>
                          {request.currentValues ? formatValue(request.currentValues[key]) : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {staleKeys.length > 0 && request.status === "PENDING" && (
              <p className="border-t border-amber-100 bg-amber-50/60 px-6 py-3 text-[11px] text-amber-800">
                The target record has changed since this request was submitted. It will be re-checked against its
                current values at the moment anyone tries to act on it, and may be automatically invalidated.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Event history</h2>
            {request.events.length === 0 ? (
              <p className="mt-2 text-xs text-gray-400">No events recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {request.events.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-4 border-b border-gray-50 pb-2 text-xs last:border-0">
                    <div>
                      <p className="font-semibold text-gray-700">{APPROVAL_EVENT_LABELS[event.eventType] ?? event.eventType}</p>
                      {event.notes && <p className="mt-0.5 text-gray-500">{event.notes}</p>}
                    </div>
                    <p className="whitespace-nowrap text-[10px] text-gray-400">
                      {event.actorName ? `${event.actorName} · ` : ""}{new Date(event.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ApprovalActionsPanel requestId={request.id} status={request.status} canDecide={canDecide} canWithdraw={canWithdraw} canCancel={canCancel} />

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Field({ label, value, link }: { label: string; value: string; link?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-400">{label}</p>
      {link ? (
        <Link href={link} className="mt-0.5 block text-sm font-semibold text-[#173D2E] hover:underline">
          {value}
        </Link>
      ) : (
        <p className="mt-0.5 text-sm font-semibold text-gray-700">{value}</p>
      )}
    </div>
  );
}
