import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getInvoiceReconciliationReports, type ReconciliationReportOrderLine, type SapInvoiceSummary } from "@/lib/invoice-reconciliation/queries";
import { INVOICE_RECONCILIATION_STATUS_LABELS, INVOICE_RECONCILIATION_STATUS_STYLES } from "@/lib/invoice-reconciliation/display";
import Sidebar from "../../components/sidebar";
import { ArrowLeft, CheckCircle2, Clock3, AlertOctagon, HelpCircle, TriangleAlert, type LucideIcon } from "lucide-react";

/**
 * Milestone 5 (SAP Invoice Reconciliation). The reports page (spec
 * section 10.D): fully invoiced orders, partially invoiced orders,
 * orders awaiting invoicing, over-invoiced quantities, unmatched SAP
 * invoices, reconciliation exceptions. Deliberately plain lists, not
 * charts -- same "avoid unnecessary dashboard complexity" choice as the
 * Milestone 4 lost-sales reports.
 */
export const instant = false;

export default async function InvoiceReconciliationReportsPage() {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const reports = await getInvoiceReconciliationReports();

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />

      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Invoice Reconciliation / Reports</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Reconciliation Reports</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <Link href="/invoice-reconciliation" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-[#173D2E]">
            <ArrowLeft size={15} />
            Back to reconciliation queue
          </Link>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <StatTile icon={CheckCircle2} color="emerald" label="Fully invoiced lines" value={reports.fullyInvoicedLines.length} />
            <StatTile icon={Clock3} color="cyan" label="Partially invoiced lines" value={reports.partiallyInvoicedLines.length} />
            <StatTile icon={HelpCircle} color="gray" label="Awaiting invoicing" value={reports.awaitingInvoicingLines.length} />
            <StatTile icon={AlertOctagon} color="red" label="Over-invoiced lines" value={reports.overInvoicedLines.length} />
          </section>

          <ReportTable title="Over-invoiced quantities" rows={reports.overInvoicedLines} />
          <ReportTable title="Partially invoiced orders (by line)" rows={reports.partiallyInvoicedLines} />
          <ReportTable title="Orders awaiting invoicing (by line)" rows={reports.awaitingInvoicingLines} />
          <ReportTable title="Fully invoiced orders (by line)" rows={reports.fullyInvoicedLines} collapsedByDefault />

          <InvoiceExceptionTable title="Unmatched SAP invoices" icon={HelpCircle} invoices={reports.unmatchedInvoices} />
          <InvoiceExceptionTable title="Reconciliation exceptions" icon={TriangleAlert} invoices={reports.reconciliationExceptions} />

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p>Willsgrove SalesFlow © 2026</p>
            <p>Sales Operations Platform · Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}

function StatTile({
  icon: Icon,
  color,
  label,
  value,
}: {
  icon: LucideIcon;
  color: "emerald" | "cyan" | "gray" | "red";
  label: string;
  value: number;
}) {
  const styles: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-600",
    cyan: "bg-cyan-50 text-cyan-600",
    gray: "bg-gray-100 text-gray-500",
    red: "bg-red-50 text-red-600",
  };
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#E8EBE6] bg-white p-4">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${styles[color]}`}>
        <Icon size={18} />
      </div>
      <div>
        <p className="text-lg font-bold text-[#17251E]">{value}</p>
        <p className="text-xs text-gray-400">{label}</p>
      </div>
    </div>
  );
}

function ReportTable({ title, rows, collapsedByDefault }: { title: string; rows: ReconciliationReportOrderLine[]; collapsedByDefault?: boolean }) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
      <div className="border-b border-gray-100 px-6 py-4">
        <h2 className="text-sm font-bold text-[#17251E]">
          {title} <span className="text-gray-400">({rows.length})</span>
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="px-6 py-6 text-xs text-gray-400">None.</p>
      ) : (
        <details open={!collapsedByDefault}>
          <summary className="cursor-pointer px-6 py-2 text-xs text-gray-400">
            {collapsedByDefault ? "Show rows" : "Hide rows"}
          </summary>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-y border-gray-100 bg-gray-50/70">
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Order</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                  <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Product</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Authorized</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Invoiced</th>
                  <th className="px-6 py-3 text-right text-[10px] font-semibold uppercase tracking-wider text-gray-400">Remaining</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.orderLineId} className="border-b border-gray-50">
                    <td className="whitespace-nowrap px-6 py-3">
                      <Link href={`/orders/${row.orderId}`} className="text-xs font-semibold text-[#173D2E] hover:underline">
                        {row.orderReference}
                      </Link>
                    </td>
                    <td className="px-6 py-3 text-xs text-gray-600">{row.customerName}</td>
                    <td className="px-6 py-3 text-xs text-gray-600">
                      {row.productDescription}
                      {row.sapItemCodeSnapshot && <span className="ml-1 text-[10px] text-gray-400">({row.sapItemCodeSnapshot})</span>}
                    </td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-xs text-gray-600">{row.authorizedQuantity}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-xs text-gray-600">{row.invoicedQuantity}</td>
                    <td className="whitespace-nowrap px-6 py-3 text-right text-xs text-gray-600">{row.remainingQuantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}

function InvoiceExceptionTable({
  title,
  icon: Icon,
  invoices,
}: {
  title: string;
  icon: LucideIcon;
  invoices: SapInvoiceSummary[];
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-[#E8EBE6] bg-white">
      <div className="flex items-center gap-2 border-b border-gray-100 px-6 py-4">
        <Icon size={16} />
        <h2 className="text-sm font-bold text-[#17251E]">
          {title} <span className="text-gray-400">({invoices.length})</span>
        </h2>
      </div>
      {invoices.length === 0 ? (
        <p className="px-6 py-6 text-xs text-gray-400">None.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-y border-gray-100 bg-gray-50/70">
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">SAP invoice</th>
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Customer</th>
                <th className="px-6 py-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">Status</th>
                <th className="px-6 py-3" />
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id} className="border-b border-gray-50">
                  <td className="whitespace-nowrap px-6 py-3 text-xs font-semibold text-[#173D2E]">{invoice.sapDocNum}</td>
                  <td className="px-6 py-3 text-xs text-gray-600">{invoice.matchedCustomerName ?? invoice.customerName ?? "Unknown"}</td>
                  <td className="whitespace-nowrap px-6 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${INVOICE_RECONCILIATION_STATUS_STYLES[invoice.reconciliationStatus] ?? "bg-gray-100 text-gray-500"}`}>
                      {INVOICE_RECONCILIATION_STATUS_LABELS[invoice.reconciliationStatus] ?? invoice.reconciliationStatus}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-6 py-3 text-right">
                    <Link href={`/invoice-reconciliation/${invoice.id}`} className="text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
