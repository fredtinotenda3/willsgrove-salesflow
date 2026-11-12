import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getFulfilmentIntelligenceReport } from "@/lib/reporting/fulfilment-intelligence";
import { buildCsv, flattenToKeyValueRows, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/** Milestone 11, spec section 8: CSV export for the fulfilment-intelligence view. */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const report = await getFulfilmentIntelligenceReport(parsed.filters);
    const rows = [
      ...flattenToKeyValueRows(report.quantities, "quantities"),
      ...flattenToKeyValueRows(report.rates, "rates"),
      ...flattenToKeyValueRows(report.picking, "picking"),
      ...flattenToKeyValueRows(report.dispatchDelivery, "dispatchDelivery"),
      ...flattenToKeyValueRows(report.orders, "orders"),
    ];
    const csv = buildCsv(rows, [{ key: "metric", header: "Metric" }, { key: "value", header: "Value" }]);

    await recordReportExport({ actorId: auth.user.id, reportId: "fulfilment", filters: { ...parsed.filters, dateFrom: report.dateFrom, dateTo: report.dateTo }, rowCount: rows.length });

    return new NextResponse(csv, { headers: csvResponseHeaders("fulfilment") });
  } catch (error) {
    console.error("Fulfilment export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the fulfilment report." }, { status: 500 });
  }
}
