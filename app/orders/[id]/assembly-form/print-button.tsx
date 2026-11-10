"use client";

import { Printer, ArrowLeft } from "lucide-react";

/**
 * Milestone 3 completion (Warehouse Assembly Form & Partial Availability).
 *
 * The one piece of interactivity this otherwise fully static, server-
 * rendered printable page needs: window.print() has no server-side
 * equivalent, so this one button is a Client Component, same "one small
 * client island on an async Server Component page" split this project
 * already uses for PickingPanel/HandoverPanel. `print:hidden` (Tailwind's
 * built-in print variant) hides this whole bar from the printed/PDF
 * output -- the assembler should never see on-screen chrome on the paper
 * they're writing on.
 *
 * Deliberately does nothing else: no fetch, no mutation, no picking-
 * session side effect of any kind. Printing this form must never start
 * or complete picking, authorize anything, or create a PickingSession --
 * see the page's own module comment.
 */
export default function AssemblyFormActions({ orderId }: { orderId: string }) {
  return (
    <div className="print:hidden mb-6 flex items-center justify-between">
      <a
        href={`/orders/${orderId}`}
        className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-xs font-semibold text-gray-600 transition hover:bg-gray-50"
      >
        <ArrowLeft size={15} />
        Back to Order
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
