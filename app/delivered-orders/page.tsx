import Link from "next/link";
import { redirect } from "next/navigation";
import { DatePicker } from "../components/date-picker";
import { FormSelect } from "../components/form-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
      <main className="min-h-screen md:pl-[260px]">
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
              <div className="space-y-1">
                <Label htmlFor="f-invoice" className="font-medium text-gray-600">Invoice number</Label>
                <Input id="f-invoice" name="invoice" defaultValue={resolved.invoice ?? ""} className="h-9 text-xs md:text-xs" placeholder="SAP doc number" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-po" className="font-medium text-gray-600">PO reference</Label>
                <Input id="f-po" name="po" defaultValue={resolved.po ?? ""} className="h-9 text-xs md:text-xs" placeholder="Order ref or customer PO" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-product" className="font-medium text-gray-600">Product</Label>
                <Input id="f-product" name="product" defaultValue={resolved.product ?? ""} className="h-9 text-xs md:text-xs" placeholder="Item code or description" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-customerId" className="font-medium text-gray-600">Customer</Label>
                <FormSelect id="f-customerId" name="customerId" defaultValue={resolved.customerId ?? ""} options={[{ value: "", label: "All customers" }, ...filterOptions.customers.map((c) => ({ value: c.id, label: c.name }))]} className="h-9 w-full text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-salespersonId" className="font-medium text-gray-600">Salesperson</Label>
                <FormSelect id="f-salespersonId" name="salespersonId" defaultValue={resolved.salespersonId ?? ""} options={[{ value: "", label: "All salespeople" }, ...filterOptions.salespeople.map((s) => ({ value: s.id, label: s.name }))]} className="h-9 w-full text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-driverId" className="font-medium text-gray-600">Driver</Label>
                <FormSelect id="f-driverId" name="driverId" defaultValue={resolved.driverId ?? ""} options={[{ value: "", label: "All drivers" }, ...drivers.map((d: { id: string; name: string }) => ({ value: d.id, label: d.name }))]} className="h-9 w-full text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-vehicleId" className="font-medium text-gray-600">Vehicle</Label>
                <FormSelect id="f-vehicleId" name="vehicleId" defaultValue={resolved.vehicleId ?? ""} options={[{ value: "", label: "All vehicles" }, ...vehicles.map((v: { id: string; registrationNumber: string }) => ({ value: v.id, label: v.registrationNumber }))]} className="h-9 w-full text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-outcome" className="font-medium text-gray-600">Outcome</Label>
                <FormSelect id="f-outcome" name="outcome" defaultValue={resolved.outcome ?? ""} options={[{ value: "", label: "All outcomes" }, { value: "NO_CLAIM", label: "No claim" }, { value: "WITH_CLAIM", label: "With claim" }]} className="h-9 w-full text-xs" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="f-reason" className="font-medium text-gray-600">Rejection reason</Label>
                <FormSelect id="f-reason" name="reason" defaultValue={resolved.reason ?? ""} options={[{ value: "", label: "All reasons" }, ...CLAIM_LINE_REASON_CATEGORIES.map((value) => ({ value, label: CLAIM_LINE_REASON_CATEGORY_LABELS[value] }))]} className="h-9 w-full text-xs" />
              </div>
              <div className="space-y-1">
                <span className="block font-medium text-gray-600">Delivery date from</span>
                <DatePicker name="dateFrom" defaultValue={resolved.dateFrom ?? ""} placeholder="From" aria-label="Delivery date from" />
              </div>
              <div className="space-y-1">
                <span className="block font-medium text-gray-600">Delivery date to</span>
                <DatePicker name="dateTo" defaultValue={resolved.dateTo ?? ""} placeholder="To" aria-label="Delivery date to" />
              </div>
              <div className="flex items-end gap-2">
                <Button type="submit" size="sm" className="bg-[#173D2E] hover:bg-[#122E23]">
                  Apply filters
                </Button>
                <Button asChild variant="outline" size="sm">
                  <Link href={basePath}>Clear</Link>
                </Button>
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
                        <td className="whitespace-nowrap px-5 py-3 font-semibold text-[#173D2E]">
                          {row.sapDocNum}
                          {/* Real-world fix (native invoice recording): this invoice has
                              no SAP import behind it at all -- recorded directly against
                              its order in SalesFlow -- so it's labelled, never shown as
                              indistinguishable from a real SAP-imported one. */}
                          {row.isNativelyRecorded && (
                            <span className="ml-2 rounded-full bg-cyan-50 px-2 py-0.5 text-[9px] font-semibold text-cyan-700" title="Recorded directly in SalesFlow -- not imported from a SAP export.">
                              SalesFlow
                            </span>
                          )}
                        </td>
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
