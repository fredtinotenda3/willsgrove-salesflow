import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getFinancialExposureReport } from "@/lib/reporting/financial-exposure";
import { buildCsv, flattenToKeyValueRows, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Milestone 11, spec section 8: CSV export for the financial-exposure
 * view. exposureByCurrency gets its own proper columns (it's the
 * headline financial table); everything else is flattened key/value --
 * the same split lib/reporting/export-csv.ts's own comment explains.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const report = await getFinancialExposureReport(parsed.filters);

    const exposureCsv = buildCsv(report.claims.exposureByCurrency, [
      { key: "currencyCode", header: "Currency" },
      { key: "claimCount", header: "Claim count" },
      { key: "potentialCreditExposure", header: "Potential credit exposure" },
      { key: "approvedCreditExposure", header: "Approved credit exposure" },
      { key: "actualSapCreditedAmount", header: "Actual SAP-credited amount" },
    ]);

    const otherRows = [
      ...flattenToKeyValueRows(report.claims.statusCounts, "claims.statusCounts"),
      ...flattenToKeyValueRows(report.claims.categoryCounts, "claims.categoryCounts"),
      ...flattenToKeyValueRows(report.claims.priorityCounts, "claims.priorityCounts"),
      ...flattenToKeyValueRows(report.claims.averageResolutionDays, "claims.averageResolutionDays"),
      ...flattenToKeyValueRows(report.reconciliation, "reconciliation"),
      ...flattenToKeyValueRows(report.returnsAndCreditNotes, "returnsAndCreditNotes"),
    ];
    const otherCsv = buildCsv(otherRows, [{ key: "metric", header: "Metric" }, { key: "value", header: "Value" }]);

    // One file: the exposure table, a blank separator line, then the
    // flattened figures -- a single export per spec section 8, not two
    // downloads for one report.
    const csv = exposureCsv + "\r\n" + otherCsv;

    await recordReportExport({
      actorId: auth.user.id,
      reportId: "financial-exposure",
      filters: { ...parsed.filters, dateFrom: report.dateFrom, dateTo: report.dateTo },
      rowCount: report.claims.exposureByCurrency.length + otherRows.length,
    });

    return new NextResponse(csv, { headers: csvResponseHeaders("financial-exposure") });
  } catch (error) {
    console.error("Financial exposure export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the financial exposure report." }, { status: 500 });
  }
}
