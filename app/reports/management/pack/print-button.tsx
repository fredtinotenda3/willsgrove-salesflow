"use client";

import { Printer } from "lucide-react";

/** Opens the browser print dialog; "Save as PDF" there produces the PDF from the page's print layout. */
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex items-center gap-2 rounded-xl border border-[#E7ECE7] bg-white px-4 py-2 text-sm font-semibold text-[#17251E] transition hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#496A42]"
    >
      <Printer size={15} aria-hidden /> Print / Save as PDF
    </button>
  );
}
