import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getQuotationById } from "@/lib/quotations/queries";
import { isValidId } from "@/lib/http";
import { formatOrderDate, formatOrderAmount as formatAmount } from "@/lib/order-display";
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_TAGLINE } from "@/lib/company-info";
import QuotationPrintActions from "./print-actions";

/**
 * Milestone 7 (Quotations Management). /quotations/[id]/print -- spec
 * section 9: "a printable quotation document." No PDF library is
 * installed in this project (confirmed before building this page), so
 * this mirrors app/orders/[id]/assembly-form/page.tsx's own pattern
 * exactly: a zero-write, print-ready HTML page with A4 print CSS that
 * the browser's own "Print to PDF" turns into a PDF when one is needed,
 * rather than generating a PDF server-side.
 *
 * Deliberately performs ZERO writes -- getQuotationById is the same
 * already-tested read the detail page itself uses. Printing a quotation
 * must never change its status, record anything, or create an event.
 *
 * Available for any status (unlike the assembly form, which hard-404s
 * for dead orders) -- a DRAFT still benefits from an internal print
 * preview before issuing, and a cancelled/expired/superseded quotation
 * may legitimately need to be reprinted for a paper trail. Instead of
 * hiding those, a banner makes the status impossible to miss on the
 * printed page itself, so an old or dead version is never mistaken for
 * a current, valid quotation (spec section 6's "do not allow an old
 * version to be mistaken for the currently issued quotation" -- applied
 * here to the printed artifact, not just the on-screen list/detail).
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

function lineLabel(line: { isUnlistedItem: boolean; sapItemCodeSnapshot: string | null; sapItemDescriptionSnapshot: string | null; unlistedItemDescription: string | null }) {
  if (line.isUnlistedItem) {
    return { primary: line.unlistedItemDescription ?? "Unlisted item", secondary: "Unlisted / requested item -- not a catalogued SAP product" };
  }
  return { primary: line.sapItemDescriptionSnapshot ?? "—", secondary: line.sapItemCodeSnapshot ?? "—" };
}

export default async function QuotationPrintPage({ params }: RouteParams) {
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

  const isSuperseded = quotation.supersededAt !== null;
  const isCurrent = quotation.status === "ISSUED" || quotation.status === "ACCEPTED";
  const showStatusBanner = !isCurrent || isSuperseded;

  const bannerText = isSuperseded
    ? `This is revision ${quotation.revisionNumber} of ${quotation.quotationNumber} -- it has been superseded by a later revision and is kept for record purposes only.`
    : quotation.status === "DRAFT"
      ? "DRAFT -- not yet issued to the customer. For internal review only."
      : quotation.status === "CANCELLED"
        ? "CANCELLED -- this quotation is no longer valid."
        : quotation.status === "REJECTED"
          ? "REJECTED by the customer -- this quotation is no longer valid."
          : quotation.status === "EXPIRED"
            ? "EXPIRED -- the validity period has passed. This quotation is no longer valid."
            : null;

  return (
    <div className="min-h-screen bg-[#F7F8F6] print:bg-white">
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          html, body { background: #fff !important; }
        }
      `}</style>

      <main className="mx-auto max-w-[900px] p-8 print:p-0">
        <QuotationPrintActions quotationId={quotation.id} />

        <article className="rounded-xl border border-[#E8EBE6] bg-white p-10 print:rounded-none print:border-0 print:p-0">
          {/* Company identification */}
          <header className="flex items-start justify-between border-b-2 border-[#173D2E] pb-4">
            <div>
              <h1 className="text-lg font-bold tracking-tight text-[#17251E]">{COMPANY_NAME}</h1>
              <p className="mt-0.5 text-xs text-gray-500">{COMPANY_ADDRESS}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">{COMPANY_TAGLINE}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold uppercase tracking-wide text-[#17251E]">Quotation</p>
              <p className="mt-1 text-xs font-semibold text-gray-700">{quotation.quotationNumber}</p>
              {quotation.revisionNumber > 1 && <p className="mt-0.5 text-[10px] text-gray-400">Revision {quotation.revisionNumber}</p>}
            </div>
          </header>

          {showStatusBanner && bannerText && (
            <section className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800 print:border-2">
              {bannerText}
            </section>
          )}

          {/* Quotation identification */}
          <section className="mt-6 grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-2">
              <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                <span className="font-semibold text-gray-500">Customer</span>
                <span className="font-medium text-gray-800">{quotation.customer?.name ?? "Unknown customer"}</span>
              </div>
              {quotation.customerContact && (
                <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                  <span className="font-semibold text-gray-500">Attention</span>
                  <span className="font-medium text-gray-800">{quotation.customerContact.name}</span>
                </div>
              )}
              <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                <span className="font-semibold text-gray-500">Customer Reference</span>
                <span className="font-medium text-gray-800">{quotation.customerReference ?? "—"}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                <span className="font-semibold text-gray-500">Quotation Date</span>
                <span className="font-medium text-gray-800">{formatOrderDate(quotation.quotationDate.toISOString())}</span>
              </div>
              <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                <span className="font-semibold text-gray-500">Valid Until</span>
                <span className="font-medium text-gray-800">{formatOrderDate(quotation.validUntil.toISOString())}</span>
              </div>
              <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                <span className="font-semibold text-gray-500">Salesperson</span>
                <span className="font-medium text-gray-800">{quotation.salesperson?.name ?? "—"}</span>
              </div>
            </div>
          </section>

          {/* Lines */}
          <section className="mt-6">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-600">#</th>
                  <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-600">Description</th>
                  <th className="border border-gray-300 px-2 py-2 text-right font-semibold text-gray-600">Qty</th>
                  <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-600">Unit</th>
                  <th className="border border-gray-300 px-2 py-2 text-right font-semibold text-gray-600">Unit Price</th>
                  <th className="border border-gray-300 px-2 py-2 text-right font-semibold text-gray-600">Disc %</th>
                  <th className="border border-gray-300 px-2 py-2 text-right font-semibold text-gray-600">VAT %</th>
                  <th className="border border-gray-300 px-2 py-2 text-right font-semibold text-gray-600">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {quotation.lines.length === 0 && (
                  <tr>
                    <td colSpan={8} className="border border-gray-300 px-2 py-6 text-center text-gray-400">
                      No lines.
                    </td>
                  </tr>
                )}
                {quotation.lines.map((line) => {
                  const { primary, secondary } = lineLabel(line);
                  return (
                    <tr key={line.id}>
                      <td className="border border-gray-300 px-2 py-3 text-gray-500">{line.lineNumber}</td>
                      <td className="border border-gray-300 px-2 py-3 text-gray-700">
                        <p className="font-medium">{primary}</p>
                        <p className="text-[10px] text-gray-400">{secondary}</p>
                        {line.notes && <p className="mt-0.5 text-[10px] text-gray-400">{line.notes}</p>}
                      </td>
                      <td className="border border-gray-300 px-2 py-3 text-right text-gray-700">{line.quantity.toString()}</td>
                      <td className="border border-gray-300 px-2 py-3 text-center text-gray-500">{line.unitOfMeasure ?? "—"}</td>
                      <td className="border border-gray-300 px-2 py-3 text-right text-gray-700">{formatAmount(line.unitPrice.toString(), quotation.currency)}</td>
                      <td className="border border-gray-300 px-2 py-3 text-right text-gray-500">{line.discountPercent ? `${line.discountPercent.toString()}%` : "—"}</td>
                      <td className="border border-gray-300 px-2 py-3 text-right text-gray-500">{line.vatRatePercentSnapshot ? `${line.vatRatePercentSnapshot.toString()}%` : "—"}</td>
                      <td className="border border-gray-300 px-2 py-3 text-right font-medium text-gray-800">{formatAmount(line.lineTotal.toString(), quotation.currency)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Totals */}
            <div className="mt-3 flex justify-end">
              <div className="w-64 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Subtotal</span>
                  <span className="font-medium text-gray-700">{formatAmount(quotation.subtotal.toString(), quotation.currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Discount</span>
                  <span className="font-medium text-gray-700">
                    {Number(quotation.discountTotal) > 0 ? `-${formatAmount(quotation.discountTotal.toString(), quotation.currency)}` : formatAmount(quotation.discountTotal.toString(), quotation.currency)}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">VAT</span>
                  <span className="font-medium text-gray-700">{formatAmount(quotation.vatTotal.toString(), quotation.currency)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-300 pt-1 text-sm font-bold text-[#17251E]">
                  <span>Total</span>
                  <span>{formatAmount(quotation.total.toString(), quotation.currency)}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Customer-facing notes and terms */}
          {quotation.customerNotes && (
            <section className="mt-6">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Notes &amp; Terms</p>
              <p className="mt-2 whitespace-pre-wrap text-xs text-gray-700">{quotation.customerNotes}</p>
            </section>
          )}

          <section className="mt-6 text-[10px] text-gray-400">
            <p>This quotation is valid until {formatOrderDate(quotation.validUntil.toISOString())}. Prices are quoted in {quotation.currency} and are subject to availability at the time of order.</p>
          </section>

          {/* Acceptance sign-off */}
          <section className="mt-8 grid grid-cols-3 gap-6 text-xs">
            <div>
              <p className="font-semibold uppercase tracking-wider text-gray-500">Accepted By (Name)</p>
              <div className="mt-6 border-b border-gray-400" />
            </div>
            <div>
              <p className="font-semibold uppercase tracking-wider text-gray-500">Date</p>
              <div className="mt-6 border-b border-gray-400" />
            </div>
            <div>
              <p className="font-semibold uppercase tracking-wider text-gray-500">Signature</p>
              <div className="mt-6 border-b border-gray-400" />
            </div>
          </section>

          <footer className="mt-10 border-t border-gray-100 pt-3 text-[10px] text-gray-400">
            Prepared by {quotation.preparedBy?.name ?? "—"} on behalf of {COMPANY_NAME}. Please return a signed copy to confirm acceptance of this quotation.
          </footer>
        </article>
      </main>
    </div>
  );
}
