import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import { getQuotationById, getQuotationRevisionHistory } from "@/lib/quotations/queries";
import { isEligibleForExpiry } from "@/lib/quotations/validation";
import { QUOTATION_STATUS_LABELS, QUOTATION_STATUS_STYLES, QUOTATION_EVENT_LABELS } from "@/lib/quotations/display";
import { formatOrderAmount as formatAmount } from "@/lib/order-display";
import Sidebar from "../../components/sidebar";
import { ArrowLeft, Printer, History } from "lucide-react";
import QuotationActionsPanel from "./quotation-actions-panel";

/**
 * Milestone 7. One quotation's full detail: header, lines (catalogued
 * and unlisted alike), stored totals, the response/follow-up/
 * cancellation/conversion facts that apply, the revision chain, and the
 * event-history timeline (spec section 7's "detail page displaying the
 * full history"). Server Component for the read side, mirroring
 * app/invoice-claims/[id]/page.tsx's split: QuotationActionsPanel is the
 * one client-rendered island for every mutating action.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

function lineLabel(line: { isUnlistedItem: boolean; sapItemCodeSnapshot: string | null; sapItemDescriptionSnapshot: string | null; unlistedItemDescription: string | null }): { primary: string; secondary: string | null } {
  if (line.isUnlistedItem) {
    return { primary: line.unlistedItemDescription ?? "Unlisted item", secondary: "Unlisted / requested item -- not an SAP product" };
  }
  return { primary: line.sapItemCodeSnapshot ?? "Unknown SAP code", secondary: line.sapItemDescriptionSnapshot };
}

export default async function QuotationDetailPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const quotation = await getQuotationById(id);
  if (!quotation) {
    notFound();
  }

  const revisions = await getQuotationRevisionHistory(id);
  const today = new Date().toISOString().slice(0, 10);
  const validUntilStr = quotation.validUntil.toISOString().slice(0, 10);
  const eligibleForExpiry = isEligibleForExpiry(quotation.status, validUntilStr, today);

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Sales Management / Quotations / {quotation.quotationNumber}</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">
              {quotation.quotationNumber}
              {quotation.revisionNumber > 1 && <span className="ml-2 text-sm font-normal text-gray-400">revision {quotation.revisionNumber}</span>}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/quotations/${quotation.id}/print`} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
              <Printer size={14} />
              Print
            </Link>
            <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-semibold ${QUOTATION_STATUS_STYLES[quotation.status] ?? "bg-gray-100 text-gray-500"}`}>
              {QUOTATION_STATUS_LABELS[quotation.status] ?? quotation.status}
            </span>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/quotations" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to quotations
          </Link>

          {quotation.supersededAt && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              This revision was superseded on {new Date(quotation.supersededAt).toLocaleString()}
              {quotation.supersededBy && <> by {quotation.supersededBy.name}</>}.
              {quotation.nextRevision && (
                <>
                  {" "}
                  <Link href={`/quotations/${quotation.nextRevision.id}`} className="font-semibold underline">
                    View the current revision (rev {quotation.nextRevision.revisionNumber}) &rarr;
                  </Link>
                </>
              )}
            </div>
          )}

          {eligibleForExpiry && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
              This quotation&rsquo;s validity date ({new Date(quotation.validUntil).toLocaleDateString()}) has passed and it has not yet been marked expired.
            </div>
          )}

          <section className="grid grid-cols-1 gap-4 rounded-xl border border-[#E8EBE6] bg-white p-5 sm:grid-cols-4">
            <Field label="Customer" value={quotation.customer.name} link={`/customers/${quotation.customer.id}`} />
            {quotation.customerContact && <Field label="Contact" value={quotation.customerContact.name} />}
            <Field label="Prepared by" value={quotation.preparedBy.name} />
            <Field label="Salesperson" value={quotation.salesperson.name} />
            <Field label="Quotation date" value={new Date(quotation.quotationDate).toLocaleDateString()} />
            <Field label="Valid until" value={new Date(quotation.validUntil).toLocaleDateString()} />
            <Field label="Currency" value={quotation.currency} />
            {quotation.customerReference && <Field label="Customer's own reference" value={quotation.customerReference} />}
            {quotation.convertedOrder && <Field label="Converted order" value={quotation.convertedOrder.reference} link={`/orders/${quotation.convertedOrder.id}`} />}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-bold text-[#17251E]">Lines</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-y border-gray-100 bg-gray-50/70">
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">#</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Item</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Qty</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Unit</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Unit price</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Discount %</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">VAT %</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {quotation.lines.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-6 py-10 text-center text-xs text-gray-400">
                        No lines yet.
                      </td>
                    </tr>
                  )}
                  {quotation.lines.map((line) => {
                    const { primary, secondary } = lineLabel(line);
                    return (
                      <tr key={line.id} className="border-b border-gray-50">
                        <td className="px-6 py-4 text-xs text-gray-500">{line.lineNumber}</td>
                        <td className="px-6 py-4 text-xs text-gray-700">
                          <p className="font-medium">{primary}</p>
                          {secondary && <p className="text-[10px] text-gray-400">{secondary}</p>}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{line.quantity.toString()}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">{line.unitOfMeasure ?? "-"}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{formatAmount(line.unitPrice.toString(), quotation.currency)}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{line.discountPercent ? `${line.discountPercent.toString()}%` : "-"}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{line.vatRatePercentSnapshot ? `${line.vatRatePercentSnapshot.toString()}%` : "-"}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs font-semibold text-gray-700">{formatAmount(line.lineTotal.toString(), quotation.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
                {quotation.lines.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-gray-100 bg-gray-50/50">
                      <td colSpan={7} className="px-6 py-3 text-right text-xs font-semibold text-gray-500">Subtotal</td>
                      <td className="px-6 py-3 text-right text-xs font-semibold text-gray-700">{formatAmount(quotation.subtotal.toString(), quotation.currency)}</td>
                    </tr>
                    <tr>
                      <td colSpan={7} className="px-6 py-1 text-right text-xs text-gray-500">Discount</td>
                      <td className="px-6 py-1 text-right text-xs text-gray-700">-{formatAmount(quotation.discountTotal.toString(), quotation.currency)}</td>
                    </tr>
                    <tr>
                      <td colSpan={7} className="px-6 py-1 text-right text-xs text-gray-500">VAT</td>
                      <td className="px-6 py-1 text-right text-xs text-gray-700">{formatAmount(quotation.vatTotal.toString(), quotation.currency)}</td>
                    </tr>
                    <tr className="border-t border-gray-100">
                      <td colSpan={7} className="px-6 py-3 text-right text-xs font-bold text-gray-700">Total</td>
                      <td className="px-6 py-3 text-right text-xs font-bold text-[#173D2E]">{formatAmount(quotation.total.toString(), quotation.currency)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </section>

          {(quotation.internalNotes || quotation.customerNotes) && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              {quotation.customerNotes && (
                <>
                  <h2 className="text-sm font-bold text-[#17251E]">Customer-facing notes</h2>
                  <p className="mt-2 whitespace-pre-wrap text-xs text-gray-600">{quotation.customerNotes}</p>
                </>
              )}
              {quotation.internalNotes && (
                <>
                  <h3 className="mt-4 text-xs font-bold text-gray-500">Internal notes (staff only)</h3>
                  <p className="mt-1 whitespace-pre-wrap text-xs text-gray-600">{quotation.internalNotes}</p>
                </>
              )}
            </section>
          )}

          {quotation.respondedAt && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h2 className="text-sm font-bold text-[#17251E]">Customer response</h2>
              <p className="mt-2 text-xs text-gray-600">
                {quotation.status === "ACCEPTED" ? "Accepted" : "Rejected"} on {new Date(quotation.respondedAt).toLocaleString()}
                {quotation.respondedBy && <> by {quotation.respondedBy.name}</>}.
              </p>
              {quotation.rejectionReason && <p className="mt-1 text-xs text-gray-600">Rejection reason: {quotation.rejectionReason}</p>}
              {quotation.responseNotes && <p className="mt-1 text-xs text-gray-600">Notes: {quotation.responseNotes}</p>}
              {quotation.customerResponseReference && <p className="mt-1 text-xs text-gray-600">Customer&rsquo;s reference: {quotation.customerResponseReference}</p>}
            </section>
          )}

          {quotation.cancelledAt && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <h2 className="text-sm font-bold text-[#17251E]">Cancellation</h2>
              <p className="mt-2 text-xs text-gray-600">
                Cancelled on {new Date(quotation.cancelledAt).toLocaleString()}
                {quotation.cancelledBy && <> by {quotation.cancelledBy.name}</>}.
              </p>
              {quotation.cancellationReason && <p className="mt-1 text-xs text-gray-600">Reason: {quotation.cancellationReason}</p>}
            </section>
          )}

          {revisions && revisions.length > 1 && (
            <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
              <div className="mb-2 flex items-center gap-2">
                <History size={14} className="text-gray-400" />
                <h2 className="text-sm font-bold text-[#17251E]">Revision history</h2>
              </div>
              <ul className="space-y-1.5">
                {revisions.map((rev) => (
                  <li key={rev.id} className="flex items-center justify-between text-xs">
                    <Link href={`/quotations/${rev.id}`} className={`font-semibold hover:underline ${rev.id === quotation.id ? "text-[#173D2E]" : "text-gray-600"}`}>
                      Revision {rev.revisionNumber}{rev.id === quotation.id ? " (viewing)" : ""}
                    </Link>
                    <span className="flex items-center gap-2 text-[10px] text-gray-400">
                      {QUOTATION_STATUS_LABELS[rev.status] ?? rev.status}
                      {rev.supersededAt === null && <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">current</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Event history</h2>
            {quotation.events.length === 0 ? (
              <p className="mt-2 text-xs text-gray-400">No events recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {quotation.events.map((event) => (
                  <li key={event.id} className="flex items-start justify-between gap-4 border-b border-gray-50 pb-2 text-xs last:border-0">
                    <div>
                      <p className="font-semibold text-gray-700">{QUOTATION_EVENT_LABELS[event.eventType] ?? event.eventType}</p>
                      {event.notes && <p className="mt-0.5 text-gray-500">{event.notes}</p>}
                    </div>
                    <p className="whitespace-nowrap text-[10px] text-gray-400">
                      {event.actor ? `${event.actor.name} · ` : ""}{new Date(event.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <QuotationActionsPanel
            quotationId={quotation.id}
            status={quotation.status}
            lineCount={quotation.lines.length}
            isSuperseded={quotation.supersededAt !== null}
            hasConvertedOrder={quotation.convertedOrder !== null}
            eligibleForExpiry={eligibleForExpiry}
            currency={quotation.currency}
            nextFollowUpDate={quotation.nextFollowUpDate ? quotation.nextFollowUpDate.toISOString().slice(0, 10) : null}
            followUpNotes={quotation.followUpNotes}
            lines={quotation.lines.map((line) => ({
              id: line.id,
              lineNumber: line.lineNumber,
              isUnlistedItem: line.isUnlistedItem,
              sapItemCodeSnapshot: line.sapItemCodeSnapshot,
              unlistedItemDescription: line.unlistedItemDescription,
              quantity: line.quantity.toString(),
              unitOfMeasure: line.unitOfMeasure,
              unitPrice: line.unitPrice.toString(),
              discountPercent: line.discountPercent ? line.discountPercent.toString() : null,
              notes: line.notes,
            }))}
          />

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
