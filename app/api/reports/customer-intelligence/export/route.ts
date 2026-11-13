import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getCustomerIntelligenceOverview } from "@/lib/reporting/customer-revenue-queries";
import { buildCsv, flattenToKeyValueRows, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Milestone 13 (Customer Intelligence). CSV export for the management
 * overview -- SALES_MANAGER/ADMINISTRATOR only, same access as the view.
 *
 * Spec section 15: exports ALL filtered customers, never only the
 * current screen page -- the view route (../route.ts) paginates in
 * memory for the screen; this route deliberately does not.
 *
 * Revenue is ranked PER CURRENCY, so each customer can appear once per
 * currency it transacted in -- flattened into its own table (one row per
 * customer x currency) rather than squashed into the main customers
 * table, so a USD figure is never shown in the same row/column as a ZWG
 * one. The main customers table carries the currency-independent figures
 * (frequency, recency, open claims) once per customer.
 */
export async function GET(request: NextRequest) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const parsedFilters = parseReportFilters(request.nextUrl.searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ success: false, message: parsedFilters.message }, { status: 400 });
  }

  const minimumActivityOnly = request.nextUrl.searchParams.get("minimumActivityOnly") === "true";

  try {
    const report = await getCustomerIntelligenceOverview(parsedFilters.filters, minimumActivityOnly);

    const customersCsv = buildCsv(
      report.rows.map((row) => ({
        customerId: row.customerId,
        customerName: row.customerName,
        purchaseFrequencyInPeriod: row.purchaseFrequencyInPeriod,
        purchaseFrequencyRank: row.purchaseFrequencyRank,
        daysSinceLastQualifyingInvoice: row.daysSinceLastQualifyingInvoice ?? "",
        daysSinceLastQualifyingInvoiceRank: row.daysSinceLastQualifyingInvoiceRank ?? "",
        openClaimsCountAsOfReportingDate: row.openClaimsCountAsOfReportingDate,
      })),
      [
        { key: "customerId", header: "Customer ID" },
        { key: "customerName", header: "Customer" },
        { key: "purchaseFrequencyInPeriod", header: "Purchase frequency (period)" },
        { key: "purchaseFrequencyRank", header: "Frequency rank" },
        { key: "daysSinceLastQualifyingInvoice", header: "Days since last qualifying invoice" },
        { key: "daysSinceLastQualifyingInvoiceRank", header: "Recency rank" },
        { key: "openClaimsCountAsOfReportingDate", header: `Open claims (as of ${report.asOfDate}, calculated)` },
      ]
    );

    const revenueRows = report.rows.flatMap((row) =>
      row.revenueByCurrency.map((rev) => ({
        customerId: row.customerId,
        customerName: row.customerName,
        currency: rev.currency,
        lineValueTotal: rev.lineValueTotal,
        rank: rev.rank,
      }))
    );
    const revenueCsv = buildCsv(revenueRows, [
      { key: "customerId", header: "Customer ID" },
      { key: "customerName", header: "Customer" },
      { key: "currency", header: "Currency" },
      { key: "lineValueTotal", header: `${report.metricLabel} total (period)` },
      { key: "rank", header: "Rank within this currency" },
    ]);

    const summaryRows = [
      { metric: "periodFrom", value: report.periodFrom },
      { metric: "periodTo", value: report.periodTo },
      { metric: "asOfDate", value: report.asOfDate },
      { metric: "asOfDateSource", value: report.asOfDateSource },
      { metric: "minimumActivityOnly", value: String(report.minimumActivityOnly) },
      { metric: "customerCount", value: String(report.rows.length) },
      ...flattenToKeyValueRows(report.dataQuality, "dataQuality"),
    ];
    const summaryCsv = buildCsv(summaryRows, [{ key: "metric", header: "Metric" }, { key: "value", header: "Value" }]);

    const csv = [summaryCsv, customersCsv, revenueCsv].join("\r\n");

    await recordReportExport({
      actorId: auth.user.id,
      reportId: "customer-intelligence",
      filters: { ...parsedFilters.filters, minimumActivityOnly },
      rowCount: summaryRows.length + report.rows.length + revenueRows.length,
    });

    return new NextResponse(csv, { headers: csvResponseHeaders("customer-intelligence") });
  } catch (error) {
    console.error("Customer intelligence export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the customer intelligence overview." }, { status: 500 });
  }
}
