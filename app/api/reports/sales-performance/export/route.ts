import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getSalesPerformanceReport } from "@/lib/reporting/sales-performance";
import { buildCsv, flattenToKeyValueRows, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Milestone 12. CSV export for the sales-performance report.
 * Management-only, same access as the view (lib/reporting/access.ts).
 *
 * Several headline tables (attribution, per-currency revenue-by-
 * salesperson, lost-sales-by-salesperson, pipeline-by-salesperson) each
 * get real columns, same "the headline table gets real columns,
 * everything else flattened key/value" split
 * app/api/reports/financial-exposure/export/route.ts already
 * established. The full new/repeat customer NAME lists are deliberately
 * left out of this export (only their counts are) -- they are already
 * fully visible in the report's own JSON/UI, and this export's purpose
 * is the salesperson-performance breakdown, not a whole-business
 * customer list.
 */
export async function GET(request: NextRequest) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const report = await getSalesPerformanceReport(parsed.filters);
    const salespersonNameById = new Map(report.salespeople.map((s) => [s.id, s.name]));
    const nameFor = (id: string | null) => (id === null ? "Unassigned" : salespersonNameById.get(id) ?? id);

    const attributionCsv = buildCsv(report.attribution.byBucket, [
      { key: "bucket", header: "Attribution bucket" },
      { key: "label", header: "Label" },
      { key: "count", header: "Order count" },
    ]);

    const revenueRows = report.revenue.byCurrency.flatMap((currencyRow) =>
      currencyRow.bySalesperson.map((row) => ({
        currency: currencyRow.currency,
        salespersonId: row.salespersonId ?? "",
        salespersonName: nameFor(row.salespersonId),
        orderCount: row.orderCount,
        lineValueTotal: row.lineValueTotal,
        excludedLineCount: row.excludedLineCount,
      }))
    );
    const revenueCsv = buildCsv(revenueRows, [
      { key: "currency", header: "Currency" },
      { key: "salespersonId", header: "Salesperson ID" },
      { key: "salespersonName", header: "Salesperson" },
      { key: "orderCount", header: "Order count" },
      { key: "lineValueTotal", header: `${report.revenue.metricLabel} total` },
      { key: "excludedLineCount", header: "Lines excluded (no line value)" },
    ]);

    const lostSalesRows = report.lostSales.bySalesperson.map((row) => ({
      salespersonId: row.salespersonId ?? "",
      salespersonName: row.salespersonName,
      confirmedCount: row.confirmedCount,
      confirmedQuantity: row.confirmedQuantity,
    }));
    const lostSalesCsv = buildCsv(lostSalesRows, [
      { key: "salespersonId", header: "Salesperson ID" },
      { key: "salespersonName", header: "Salesperson" },
      { key: "confirmedCount", header: "Confirmed lost sales" },
      { key: "confirmedQuantity", header: "Confirmed lost quantity" },
    ]);

    const pipelineCsv = buildCsv(report.pipelineBySalesperson, [
      { key: "salespersonId", header: "Salesperson ID" },
      { key: "salespersonName", header: "Salesperson" },
      { key: "quotationsIssued", header: "Quotations issued" },
      { key: "quotationAcceptanceRatePercent", header: "Quotation acceptance rate %" },
      { key: "acceptedQuotationsInCohort", header: "Accepted quotations (cohort)" },
      { key: "quotationToOrderConversionRatePercent", header: "Quotation-to-order conversion rate %" },
      { key: "ordersReceived", header: "Orders received" },
      { key: "ordersConfirmed", header: "Orders confirmed" },
      { key: "orderApprovalRatePercent", header: "Order approval rate %" },
    ]);

    const summaryRows = [
      { metric: "dateFrom", value: report.dateFrom },
      { metric: "dateTo", value: report.dateTo },
      { metric: "attribution.totalOrders", value: String(report.attribution.totalOrders) },
      ...flattenToKeyValueRows(report.revenue.headerTotalsByCurrency, "revenue.headerTotalsByCurrency"),
      { metric: "customerActivity.newCustomerCount", value: String(report.customerActivity.newCustomerCount) },
      { metric: "customerActivity.repeatCustomerCount", value: String(report.customerActivity.repeatCustomerCount) },
      { metric: "customerActivity.unattributedInvoiceCount", value: String(report.customerActivity.unattributedInvoiceCount) },
      { metric: "customerActivity.unattributedInvoiceValue", value: report.customerActivity.unattributedInvoiceValue },
      { metric: "customerActivity.invoicesWithNoUsableDateCount", value: String(report.customerActivity.invoicesWithNoUsableDateCount) },
      { metric: "lostSales.totalConfirmedCount", value: String(report.lostSales.totalConfirmedCount) },
      { metric: "lostSales.totalConfirmedQuantity", value: report.lostSales.totalConfirmedQuantity },
      ...flattenToKeyValueRows(report.lostSales.estimatedValueByCurrency, "lostSales.estimatedValueByCurrency"),
    ];
    const summaryCsv = buildCsv(summaryRows, [{ key: "metric", header: "Metric" }, { key: "value", header: "Value" }]);

    const csv = [attributionCsv, revenueCsv, lostSalesCsv, pipelineCsv, summaryCsv].join("\r\n");

    await recordReportExport({
      actorId: auth.user.id,
      reportId: "sales-performance",
      filters: { ...parsed.filters, dateFrom: report.dateFrom, dateTo: report.dateTo },
      rowCount: report.attribution.byBucket.length + revenueRows.length + lostSalesRows.length + report.pipelineBySalesperson.length + summaryRows.length,
    });

    return new NextResponse(csv, { headers: csvResponseHeaders("sales-performance") });
  } catch (error) {
    console.error("Sales performance export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the sales performance report." }, { status: 500 });
  }
}
