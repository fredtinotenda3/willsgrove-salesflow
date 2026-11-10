import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { isValidId } from "@/lib/http";
import { getSapInvoiceDetail } from "@/lib/invoice-reconciliation/queries";
import {
  INVOICE_RECONCILIATION_STATUS_LABELS,
  INVOICE_RECONCILIATION_STATUS_STYLES,
  INVOICE_LINE_MATCH_STATUS_LABELS,
  INVOICE_LINE_MATCH_STATUS_STYLES,
  ORDER_LINE_INVOICE_STATUS_LABELS,
  ORDER_LINE_INVOICE_STATUS_STYLES,
} from "@/lib/invoice-reconciliation/display";
import Sidebar from "../../components/sidebar";
import { ArrowLeft, Ban } from "lucide-react";
import ReconciliationPanel from "./reconciliation-panel";
import ReconciliationNoteForm from "./reconciliation-note-form";

/**
 * Milestone 5 (SAP Invoice Reconciliation). One SAP invoice's full detail
 * (spec section 10.C): header + lines, linked SalesFlow order + authorized
 * handover, and per-matched-line SAP item code / description / authorized
 * quantity / actual invoiced quantity / remaining quantity / difference.
 * ReconciliationPanel is the one client-rendered island (manual match /
 * cannot-link / reopen / rerun-match / note actions), same split as
 * app/lost-sales/[id]/page.tsx's DecisionPanel.
 */
export const instant = false;

type RouteParams = { params: Promise<{ id: string }> };

export default async function InvoiceDetailPage({ params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const { id } = await params;
  if (!isValidId(id)) {
    notFound();
  }

  const invoice = await getSapInvoiceDetail(id);
  if (!invoice) {
    notFound();
  }

  const canReconcile = user.role === "SALES_MANAGER" || user.role === "ADMINISTRATOR";

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Invoice Reconciliation / {invoice.sapDocNum}</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">SAP Invoice {invoice.sapDocNum}</h2>
          </div>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-semibold ${
              INVOICE_RECONCILIATION_STATUS_STYLES[invoice.reconciliationStatus] ?? "bg-gray-100 text-gray-500"
            }`}
          >
            {invoice.isCancelledOrReversed && <Ban size={12} />}
            {INVOICE_RECONCILIATION_STATUS_LABELS[invoice.reconciliationStatus] ?? invoice.reconciliationStatus}
          </span>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/invoice-reconciliation" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to reconciliation queue
          </Link>

          <section className="grid grid-cols-1 gap-4 rounded-xl border border-[#E8EBE6] bg-white p-5 sm:grid-cols-4">
            <Field label="Customer" value={invoice.matchedCustomerName ?? invoice.customerName ?? "Unknown"} sub={invoice.customerSapCode} />
            <Field label="Invoice date" value={invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : "-"} />
            <Field label="SalesFlow order" value={invoice.matchedOrderReference ?? "Not fully resolved"} link={invoice.matchedOrderId ? `/orders/${invoice.matchedOrderId}` : undefined} />
            <Field label="Total" value={invoice.total ? `${invoice.currencyCode ?? ""} ${invoice.total}` : "-"} />
            <Field label="SAP order reference" value={invoice.sapOrderReference ?? "-"} />
            <Field label="Document status (raw)" value={invoice.documentStatusRaw ?? "-"} />
            <Field label="Import batch" value={invoice.importBatchFileName} />
            <Field label="Imported" value={new Date(invoice.createdAt).toLocaleString()} />
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            <div className="border-b border-gray-100 px-6 py-4">
              <h2 className="text-sm font-bold text-[#17251E]">Invoice Lines</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-y border-gray-100 bg-gray-50/70">
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">SAP item</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Invoiced qty</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Authorized</th>
                    <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Remaining</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Order line status</th>
                    <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Match status</th>
                    <th className="px-6 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines.map((line) => (
                    <tr key={line.id} className="border-b border-gray-50">
                      <td className="px-6 py-4 text-xs text-gray-600">
                        <p className="font-mono font-medium text-gray-700">{line.sapItemCode ?? "-"}</p>
                        {line.sapItemDescription && <p className="text-[10px] text-gray-400">{line.sapItemDescription}</p>}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{line.quantityInvoiced}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{line.authorizedQuantity ?? "-"}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">{line.remainingQuantity ?? "-"}</td>
                      <td className="whitespace-nowrap px-6 py-4">
                        {line.orderLineStatus && (
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ORDER_LINE_INVOICE_STATUS_STYLES[line.orderLineStatus]}`}>
                            {ORDER_LINE_INVOICE_STATUS_LABELS[line.orderLineStatus]}
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${INVOICE_LINE_MATCH_STATUS_STYLES[line.matchStatus] ?? "bg-gray-100 text-gray-500"}`}>
                          {INVOICE_LINE_MATCH_STATUS_LABELS[line.matchStatus] ?? line.matchStatus}
                        </span>
                        {line.matchedOrderReference && (
                          <p className="mt-1 text-[10px] text-gray-400">
                            <Link href={`/orders/${line.matchedOrderId}`} className="hover:underline">
                              {line.matchedOrderReference}
                            </Link>
                          </p>
                        )}
                        {line.matchNote && <p className="mt-1 text-[10px] text-gray-400">{line.matchNote}</p>}
                        {line.matchedByName && line.matchedAt && (
                          <p className="text-[10px] text-gray-300">
                            {line.matchedByName} · {new Date(line.matchedAt).toLocaleString()}
                          </p>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right">
                        {canReconcile && (
                          <ReconciliationPanel
                            invoiceId={invoice.id}
                            lineId={line.id}
                            matchStatus={line.matchStatus}
                            matchedCustomerId={invoice.matchedCustomerId}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-xl border border-[#E8EBE6] bg-white p-5">
            <h2 className="text-sm font-bold text-[#17251E]">Reconciliation Notes</h2>
            {canReconcile ? (
              <ReconciliationNoteForm invoiceId={invoice.id} initialNote={invoice.reconciliationNotes} />
            ) : (
              <p className="mt-2 text-xs text-gray-500">{invoice.reconciliationNotes ?? "No notes recorded."}</p>
            )}
          </section>

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function Field({ label, value, sub, link }: { label: string; value: string; sub?: string | null; link?: string }) {
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
      {sub && <p className="text-[10px] text-gray-400">{sub}</p>}
    </div>
  );
}
