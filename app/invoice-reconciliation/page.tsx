import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listSapInvoices } from "@/lib/invoice-reconciliation/queries";
import { INVOICE_RECONCILIATION_STATUS_LABELS, INVOICE_RECONCILIATION_STATUS_STYLES } from "@/lib/invoice-reconciliation/display";
import { initialsFor, avatarColorFor } from "@/lib/order-display";
import Sidebar from "../components/sidebar";
import { Receipt, ChevronRight, ChevronLeft, Upload, BarChart3, Ban } from "lucide-react";

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 *
 * The /invoice-reconciliation reconciliation queue (spec section 10.B):
 * SAP invoice number, customer, invoice date, SalesFlow order reference
 * if matched, invoice amount/currency where available, matching status,
 * outstanding discrepancies. Same "deliberately simple Server Component
 * list, plain query-string pagination" choice as /lost-sales and
 * /fulfilment.
 */
export const instant = false;

const PAGE_SIZE = 25;

const STATUS_FILTERS = ["UNMATCHED", "PARTIALLY_MATCHED", "RECONCILIATION_REQUIRED", "MATCHED", "CANCELLED_REVERSED"];

type RouteParams = { searchParams: Promise<{ page?: string; status?: string }> };

export default async function InvoiceReconciliationPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolved = await searchParams;
  const requestedPage = Number(resolved.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const reconciliationStatus = resolved.status && STATUS_FILTERS.includes(resolved.status) ? resolved.status : undefined;

  const { invoices, pagination } = await listSapInvoices({ page, pageSize: PAGE_SIZE, reconciliationStatus });

  const statusQuery = (targetStatus: string | undefined) => (targetStatus ? `&status=${targetStatus}` : "");

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Invoice Reconciliation</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">SAP Invoice Reconciliation</h2>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/invoice-reconciliation/reports"
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50"
            >
              <BarChart3 size={14} />
              Reports
            </Link>
            <Link
              href="/invoice-reconciliation/import"
              className="flex items-center gap-2 rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#122E23]"
            >
              <Upload size={14} />
              Import SAP invoices
            </Link>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <section>
            <h1 className="text-2xl font-bold tracking-tight text-[#17251E]">Reconciliation Queue</h1>
            <p className="mt-1 text-sm text-gray-500">
              Which authorized quantities were actually invoiced in SAP, which remain outstanding, and which
              invoices still need a human decision. SAP Business One remains the authoritative source for
              invoice numbers, prices, VAT and totals -- this is a reconciliation view, not a replacement for it.
            </p>
          </section>

          <section className="flex flex-wrap items-center gap-2">
            <Link
              href="/invoice-reconciliation"
              className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                !reconciliationStatus ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"
              }`}
            >
              All
            </Link>
            {STATUS_FILTERS.map((value) => (
              <Link
                key={value}
                href={`/invoice-reconciliation?page=1${statusQuery(value)}`}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${
                  reconciliationStatus === value ? "bg-[#173D2E] text-white" : "bg-white text-gray-500 border border-gray-200"
                }`}
              >
                {INVOICE_RECONCILIATION_STATUS_LABELS[value] ?? value}
              </Link>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
            {invoices.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <Receipt size={28} className="mx-auto text-gray-300" />
                <p className="mt-3 text-sm font-semibold text-gray-600">Nothing here</p>
                <p className="mt-1 text-xs text-gray-400">
                  No SAP invoices match this filter. Import an SAP invoice export to get started.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-y border-gray-100 bg-gray-50/70">
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">SAP invoice</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Invoice date</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">SalesFlow order</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Total</th>
                      <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Lines</th>
                      <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                      <th className="px-6 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((invoice) => (
                      <tr key={invoice.id} className="border-b border-gray-50">
                        <td className="whitespace-nowrap px-6 py-4">
                          <p className="text-xs font-semibold text-[#173D2E]">{invoice.sapDocNum}</p>
                          {invoice.sapDocEntry && <p className="text-[10px] text-gray-400">DocEntry {invoice.sapDocEntry}</p>}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div
                              className={`flex h-7 w-7 items-center justify-center rounded-lg text-[10px] font-bold ${avatarColorFor(invoice.matchedCustomerName ?? invoice.customerName ?? "?")}`}
                            >
                              {initialsFor(invoice.matchedCustomerName ?? invoice.customerName ?? "?")}
                            </div>
                            <div>
                              <span className="text-xs font-medium text-gray-700">{invoice.matchedCustomerName ?? invoice.customerName ?? "Unknown"}</span>
                              {!invoice.matchedCustomerId && invoice.customerSapCode && (
                                <p className="text-[10px] text-amber-600">Unresolved: {invoice.customerSapCode}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                          {invoice.invoiceDate ? new Date(invoice.invoiceDate).toLocaleDateString() : "-"}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-xs text-gray-600">
                          {invoice.matchedOrderReference ? (
                            <Link href={`/orders/${invoice.matchedOrderId}`} className="font-semibold text-[#173D2E] hover:underline">
                              {invoice.matchedOrderReference}
                            </Link>
                          ) : (
                            <span className="text-gray-400">
                              {invoice.lineCount > invoice.unresolvedLineCount ? "Spans multiple orders" : "-"}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">
                          {invoice.total ? `${invoice.currencyCode ?? ""} ${invoice.total}` : "-"}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-xs text-gray-600">
                          {invoice.lineCount - invoice.unresolvedLineCount}/{invoice.lineCount}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                              INVOICE_RECONCILIATION_STATUS_STYLES[invoice.reconciliationStatus] ?? "bg-gray-100 text-gray-500"
                            }`}
                          >
                            {invoice.isCancelledOrReversed && <Ban size={10} />}
                            {INVOICE_RECONCILIATION_STATUS_LABELS[invoice.reconciliationStatus] ?? invoice.reconciliationStatus}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right">
                          <Link
                            href={`/invoice-reconciliation/${invoice.id}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]"
                          >
                            Open
                            <ChevronRight size={13} />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {pagination.totalPages > 1 && (
            <nav className="flex items-center justify-between">
              <Link
                href={`/invoice-reconciliation?page=${Math.max(1, page - 1)}${statusQuery(reconciliationStatus)}`}
                aria-disabled={page <= 1}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  page <= 1 ? "pointer-events-none opacity-40" : ""
                }`}
              >
                <ChevronLeft size={14} />
                Previous
              </Link>
              <p className="text-xs text-gray-400">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <Link
                href={`/invoice-reconciliation?page=${Math.min(pagination.totalPages, page + 1)}${statusQuery(reconciliationStatus)}`}
                aria-disabled={page >= pagination.totalPages}
                className={`flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 ${
                  page >= pagination.totalPages ? "pointer-events-none opacity-40" : ""
                }`}
              >
                Next
                <ChevronRight size={14} />
              </Link>
            </nav>
          )}

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
