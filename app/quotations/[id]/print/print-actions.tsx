"use client";

import { Printer, ArrowLeft } from "lucide-react";

/**
 * Milestone 7 (Quotations Management). The print page's one client
 * island, same split as app/orders/[id]/assembly-form/print-button.tsx:
 * window.print() has no server-side equivalent, so it's isolated here
 * rather than making the whole page a Client Component. `print:hidden`
 * hides this bar from the printed/PDF output.
 */
export default function QuotationPrintActions({ quotationId }: { quotationId: string }) {
  return (
    <div className="print:hidden mb-6 flex items-center justify-between">
      <a
        href={`/quotations/${quotationId}`}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
      >
        <ArrowLeft size={15} />
        Back to Quotation
      </a>
      <button
        type="button"
        onClick={() => window.print()}
        className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2.5 text-xs font-semibold text-white transition hover:brightness-110"
      >
        <Printer size={15} />
        Print
      </button>
    </div>
  );
}
