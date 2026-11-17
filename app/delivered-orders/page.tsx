import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { listDeliveredOrders, type DeliveredOrdersFilters } from "@/lib/delivered-orders/queries";
import { getReportFilterOptions } from "@/lib/reporting/filter-options";
import { listPersonnel } from "@/lib/personnel";
import { listVehicles } from "@/lib/vehicles";
import { CLAIM_LINE_REASON_CATEGORIES, CLAIM_LINE_REASON_CATEGORY_LABELS } from "@/lib/invoice-claims/validation";
import Sidebar from "../components/sidebar";
import { PageHeader, SectionCard, Pagination, EmptyState } from "../reports/_components/ui";
import { PackageCheck, ChevronRight } from "lucide-react";

/**
 * Management Analytics spec, Part 6: a dedicated, permanent Delivered
 * Orders history, clearly separated from the active "Ready for Invoice"
 * queue at /invoice-reconciliation. Same "deliberately simple Server
 * Component, plain query-string filters" convention as every other list
 * page in this codebase.
 */
export const instant = false;

const PAGE_SIZE = 25;

type RouteParams = {
  searchParams: Promise<{
    page?: string;
    customerId?: string;
    invoice?: string;
    po?: string;
    product?: string;
    salespersonId?: string;
    driverId?: string;
    vehicleId?: string;
    dateFrom?: string;
    dateTo?: string;
    outcome?: string;
    reason?: string;
  }>;
};

export default async function DeliveredOrdersPage({ searchParams }: RouteParams) {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const resolved = await searchParams;
  const requestedPage = Number(resolved.page);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const filters: DeliveredOrdersFilters = {
    customerId: resolved.customerId || undefined,
    invoiceSearch: resolved.invoice || undefined,
    poReference: resolved.po || undefined,
    productSearch: resolved.product || undefined,
    salespersonId: resolved.salespersonId || undefined,
    driverId: resolved.driverId || undefined,
    vehicleId: resolved.vehicleId || undefined,
    dateFrom: resolved.dateFrom || null,
    dateTo: resolved.dateTo || null,
    outcome: resolved.outcome === "NO_CLAIM" || resolved.outcome === "WITH_CLAIM" ? resolved.outcome : undefined,
    rejectionReasonCategory: resolved.reason || undefined,
    includeDemo: false,
  };

  const [result, filterOptions, drivers, vehicles] = await Promise.all([
    listDeliveredOrders(filters, { page, pageSize: PAGE_SIZE }),
    getReportFilterOptions(),
    listPersonnel({ role: "DRIVER", status: "ACTIVE" }),
    listVehicles({ status: "ACTIVE" }),
  ]);

  const basePath = "/delivered-orders";
  const persistedFilters = {
    customerId: resolved.customerId,
    invoice: resolved.invoice,
    po: resolved.po,
    product: resolved.product,
    salespersonId: resolved.salespersonId,
    driverId: resolved.driverId,
    vehicleId: resolved.vehicleId,
    dateFrom: resolved.dateFrom,
    dateTo: resolved.dateTo,
    outcome: resolved.outcome,
    reason: resolved.reason,
  };

  return (
    <div className="min-h-screen bg-[#F7F8F6]">
      <Sidebar />
      <main className="min-h-screen pl-[260px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center border-b border-[#E8EBE6] bg-white px-8">
          <div>
            <p className="text-xs text-gray-400">Workspace / Operations / Delivered Orders</p>
            <h2 className="mt-1 text-lg font-bold text-[#17251E]">Delivered Orders</h2>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <PageHeader
            breadcrumb="Operations / Delivered Orders"
            title="Delivered Orders"
            description="Every invoice whose delivery outcome has been recorded, with the complete PO-to-delivery history behind it. Once an outcome is recorded, an order moves here permanently and disappears from the active Ready-for-Invoice queue."
            actions={
              <Link href="/invoice-reconciliation" className="text-sm font-semibold text-[#718078] hover:text-[#17251E]">
                &larr; Back to Reconciliation Queue
              </Link>
            }
          />

          <SectionCard title="Filters" description="Narrow the history below -- every filter combines with the others">
            <form method="GET" action={basePath} className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Invoice number</span>
                <input name="invoice" defaultValue={resolved.invoice ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" placeholder="SAP doc number" />
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">PO reference</span>
                <input name="po" defaultValue={resolved.po ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" placeholder="Order ref or customer PO" />
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Product</span>
                <input name="product" defaultValue={resolved.product ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" placeholder="Item code or description" />
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Customer</span>
                <select name="customerId" defaultValue={resolved.customerId ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5">
                  <option value="">All customers</option>
                  {filterOptions.customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Salesperson</span>
                <select name="salespersonId" defaultValue={resolved.salespersonId ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5">
                  <option value="">All salespeople</option>
                  {filterOptions.salespeople.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Driver</span>
                <select name="driverId" defaultValue={resolved.driverId ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5">
                  <option value="">All drivers</option>
                  {drivers.map((d: { id: string; name: string }) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Vehicle</span>
                <select name="vehicleId" defaultValue={resolved.vehicleId ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5">
                  <option value="">All vehicles</option>
                  {vehicles.map((v: { id: string; registrationNumber: string }) => (
                    <option key={v.id} value={v.id}>{v.registrationNumber}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Outcome</span>
                <select name="outcome" defaultValue={resolved.outcome ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5">
                  <option value="">All outcomes</option>
                  <option value="NO_CLAIM">No claim</option>
                  <option value="WITH_CLAIM">With claim</option>
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Rejection reason</span>
                <select name="reason" defaultValue={resolved.reason ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5">
                  <option value="">All reasons</option>
                  {CLAIM_LINE_REASON_CATEGORIES.map((value) => (
                    <option key={value} value={value}>{CLAIM_LINE_REASON_CATEGORY_LABELS[value]}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Delivery date from</span>
                <input type="date" name="dateFrom" defaultValue={resolved.dateFrom ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" />
              </label>
              <label className="space-y-1">
                <span className="font-medium text-gray-600">Delivery date to</span>
                <input type="date" name="dateTo" defaultValue={resolved.dateTo ?? ""} className="w-full rounded-lg border border-gray-200 px-2 py-1.5" />
              </label>
              <div className="flex items-end gap-2">
                <button type="submit" className="rounded-lg bg-[#173D2E] px-4 py-2 text-xs font-semibold text-white hover:bg-[#122E23]">
                  Apply filters
                </button>
                <Link href={basePath} className="rounded-lg border border-gray-200 px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-50">
                  Clear
                </Link>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Delivery history" description={`${result.pagination.totalItems} delivered invoice(s) match these filters`}>
            {result.rows.length === 0 ? (
              <EmptyState message="No delivered invoices match this filter." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-[#F7F8F6] text-[11px] uppercase tracking-wide text-[#849087]">
                    <tr>
                      <th className="px-5 py-3 font-semibold">Invoice</th>
                      <th className="px-5 py-3 font-semibold">Customer</th>
                      <th className="px-5 py-3 font-semibold">PO reference</th>
                      <th className="px-5 py-3 font-semibold">Salesperson</th>
                      <th className="px-5 py-3 font-semibold">Driver / Vehicle</th>
                      <th className="px-5 py-3 font-semibold">Delivered</th>
                      <th className="px-5 py-3 font-semibold">Outcome</th>
                      <th className="px-5 py-3 text-right font-semibold">Total</th>
                      <th className="px-5 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1ED]">
                    {result.rows.map((row) => (
                      <tr key={row.invoiceDeliveryRecordId} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-5 py-3 font-semibold text-[#173D2E]">{row.sapDocNum}</td>
                        <td className="px-5 py-3 text-[#17251E]">{row.customerName ?? "Unknown"}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-[#17251E]">
                          {row.orderId ? (
                            <Link href={`/orders/${row.orderId}`} className="font-semibold text-[#173D2E] hover:underline">
                              {row.orderReference}
                            </Link>
                          ) : (
                            row.customerPoReference ?? "-"
                          )}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-[#17251E]">{row.salespersonName ?? "-"}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-[#17251E]">
                          {row.driverNames.length > 0 ? row.driverNames.join(", ") : "-"}
                          {row.vehicleRegistrations.length > 0 && <span className="text-gray-400"> · {row.vehicleRegistrations.join(", ")}</span>}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-[#17251E]">{new Date(row.recordedAt).toLocaleString()}</td>
                        <td className="whitespace-nowrap px-5 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                              row.hasClaim ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"
                            }`}
                          >
                            {row.hasClaim ? "With claim" : "No claim"}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-[#17251E]">
                          {row.totalInvoiced ? `${row.currencyCode ?? ""} ${row.totalInvoiced}` : "-"}
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          <Link href={`/delivered-orders/${row.sapInvoiceId}`} className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-500 hover:text-[#173D2E]">
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
            <Pagination
              basePath={basePath}
              searchParams={persistedFilters as Record<string, string | undefined>}
              page={result.pagination.page}
              totalPages={result.pagination.totalPages}
              totalItems={result.pagination.totalItems}
              pageSize={result.pagination.pageSize}
            />
          </SectionCard>

          <footer className="flex items-center justify-between pb-2 text-[10px] text-gray-400">
            <p className="flex items-center gap-1.5"><PackageCheck size={12} /> Willsgrove SalesFlow &copy; 2026</p>
            <p>Sales Operations Platform &middot; Harare</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
