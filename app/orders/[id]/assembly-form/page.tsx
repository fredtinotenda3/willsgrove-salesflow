import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getOrderById } from "@/lib/order-queries";
import { isValidId } from "@/lib/http";
import { formatOrderDate } from "@/lib/order-display";
import { resolveAssemblyFormLine } from "@/lib/assembly-form/resolve-line";
import { COMPANY_NAME, COMPANY_ADDRESS, COMPANY_TAGLINE } from "@/lib/company-info";
import AssemblyFormActions from "./print-button";

/**
 * Milestone 3 completion (Warehouse Assembly Form & Partial Availability).
 *
 * STEP 3 of the required business workflow: a clean, printer-friendly,
 * physical instruction-and-recording document the salesperson prints
 * from the Customer PO detail page and hands to warehouse assemblers
 * (who never log into SalesFlow at all -- see the spec's section 2).
 * Deliberately distinct from the SAP Invoice Handover in every way that
 * matters: no Handover Reference, no pricing, no SAP-grid framing, and a
 * title that says plainly what it is and isn't.
 *
 * Deliberately performs ZERO writes of any kind -- no PickingSession is
 * read or created, no OrderStatusHistory/AuditEvent row is written, no
 * order field is touched. This is a direct, structural guarantee (not
 * just a convention) that printing this form can never start or
 * complete picking, authorize anything, change a quantity, or create a
 * duplicate order/session, which the spec requires explicitly. The one
 * read it performs (getOrderById) is the same already-tested, read-only
 * query app/orders/[id]/page.tsx itself uses.
 *
 * Found/Unavailable are rendered as blank boxes for the assembler to
 * fill in by hand -- never pre-filled from any existing PickingLine data
 * (this page doesn't even query PickingSession), exactly per the spec's
 * "quantities found and unavailable must be left blank on the printed
 * form."
 *
 * Available whenever the order exists and has at least one line, same
 * "any authenticated user, no dedicated role" convention picking itself
 * already follows -- printing has no side effect to gate, so there's
 * nothing to restrict by role. Hidden only for CANCELLED/REJECTED orders
 * (nothing to assemble for a dead order), consistent with
 * app/fulfilment/[id]/page.tsx's own NOT_PICKABLE_STATUSES notion, though
 * this route also hard-404s on those rather than merely hiding the
 * button, so a stale/old link can't be used to print a dead order's
 * form either.
 *
 * Reads the session and a live order record directly (not prerendered),
 * same reason as every other order-scoped page in this project.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

const NOT_ASSEMBLABLE_STATUSES = new Set(["CANCELLED", "REJECTED"]);

export default async function AssemblyFormPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const order = await getOrderById(id);
  if (!order) {
    notFound();
  }
  if (NOT_ASSEMBLABLE_STATUSES.has(order.status) || order.lines.length === 0) {
    notFound();
  }

  const customerName = order.customer?.name ?? "Unknown customer";
  const lines = order.lines.map((line) => resolveAssemblyFormLine(line));

  return (
    <div className="min-h-screen bg-[#F7F8F6] print:bg-white">
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          html, body { background: #fff !important; }
        }
      `}</style>

      <main className="mx-auto max-w-[900px] p-8 print:p-0">
        <AssemblyFormActions orderId={order.id} />

        <article className="rounded-xl border border-[#E8EBE6] bg-white p-10 print:rounded-none print:border-0 print:p-0">
          {/* Company identification */}
          <header className="flex items-start justify-between border-b-2 border-[#173D2E] pb-4">
            <div>
              <h1 className="text-lg font-bold tracking-tight text-[#17251E]">{COMPANY_NAME}</h1>
              <p className="mt-0.5 text-xs text-gray-500">{COMPANY_ADDRESS}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">{COMPANY_TAGLINE}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-bold uppercase tracking-wide text-[#17251E]">Warehouse Assembly Form</p>
              <p className="mt-1 text-[10px] text-gray-400">Not an invoice or SAP handover document</p>
            </div>
          </header>

          {/* Order identification */}
          <section className="mt-6 grid grid-cols-2 gap-4 text-xs">
            <div className="space-y-2">
              <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                <span className="font-semibold text-gray-500">Customer</span>
                <span className="font-medium text-gray-800">{customerName}</span>
              </div>
              <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                <span className="font-semibold text-gray-500">Customer PO Number</span>
                <span className="font-medium text-gray-800">{order.customerPoReference ?? "—"}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                <span className="font-semibold text-gray-500">SalesFlow Order Reference</span>
                <span className="font-medium text-gray-800">{order.reference}</span>
              </div>
              <div className="flex justify-between border-b border-dotted border-gray-300 pb-1">
                <span className="font-semibold text-gray-500">Order Date</span>
                <span className="font-medium text-gray-800">{formatOrderDate(order.orderDate)}</span>
              </div>
            </div>
          </section>

          {/* Product table -- Found/Unavailable intentionally left blank */}
          <section className="mt-6">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-600">#</th>
                  <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-600">
                    SAP Item Code
                  </th>
                  <th className="border border-gray-300 px-2 py-2 text-left font-semibold text-gray-600">
                    Official Product Description
                  </th>
                  <th className="border border-gray-300 px-2 py-2 text-right font-semibold text-gray-600">
                    Requested Qty
                  </th>
                  <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-600">Unit</th>
                  <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-600">
                    Qty Found
                  </th>
                  <th className="border border-gray-300 px-2 py-2 text-center font-semibold text-gray-600">
                    Qty Unavailable
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.lineNumber}>
                    <td className="border border-gray-300 px-2 py-3 text-gray-500">{line.lineNumber}</td>
                    <td className="border border-gray-300 px-2 py-3 text-gray-700">{line.sapItemCode ?? "—"}</td>
                    <td className="border border-gray-300 px-2 py-3 text-gray-700">{line.description}</td>
                    <td className="border border-gray-300 px-2 py-3 text-right font-medium text-gray-700">
                      {line.requestedQuantity}
                    </td>
                    <td className="border border-gray-300 px-2 py-3 text-center text-gray-500">
                      {line.requestedUnitCode}
                    </td>
                    {/* Deliberately empty cells -- filled in by hand by the assembler. */}
                    <td className="border border-gray-300 px-2 py-3" />
                    <td className="border border-gray-300 px-2 py-3" />
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Remarks */}
          <section className="mt-6">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Remarks</p>
            <div className="mt-2 h-20 rounded border border-gray-300" />
          </section>

          {/* Assembler sign-off */}
          <section className="mt-8 grid grid-cols-3 gap-6 text-xs">
            <div>
              <p className="font-semibold uppercase tracking-wider text-gray-500">Assembler Name</p>
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
            Return this completed form to the salesperson. Found and unavailable quantities will be recorded in
            SalesFlow&apos;s Fulfilment section exactly as written here.
          </footer>
        </article>
      </main>
    </div>
  );
}
