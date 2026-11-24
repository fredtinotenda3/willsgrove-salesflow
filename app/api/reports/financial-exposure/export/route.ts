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

    // Final Operational Enhancements (spec Part 7): Source A (lost-sales
    // claim exposure) is already in exposureCsv above (it IS
    // report.claims.exposureByCurrency) -- only Source B (supply
    // shortage) is new here, kept in its own clearly-labeled block so it
    // is never mistaken for a column that sums with Source A's.
    const sourceBCsv = buildCsv(
      [{ metric: "Estimated supply lost sales value", value: report.lostSalesBySource.sourceB.estimatedValue },
       { metric: "Lost-sale records priced", value: String(report.lostSalesBySource.sourceB.recordsWithEstimate) },
       { metric: "Lost-sale records without a price (excluded)", value: String(report.lostSalesBySource.sourceB.recordsWithoutEstimate) }],
      [{ key: "metric", header: "Unfulfilled demand (insufficient supply at fulfilment)" }, { key: "value", header: "Value" }]
    );

    // Real Business Data Onboarding round, Phase 7 (Claims analytics):
    // Source C (confirmed loss from returned goods) -- its own
    // clearly-labeled, per-currency block, same reasoning as Source B's
    // above: never a column that could be summed with Source A's or
    // Source B's by a careless spreadsheet formula. See
    // getFinancialExposureReport's own note for why Source C is never
    // added to Source A even though they can share the same claim.
    const sourceCCsv = buildCsv(
      report.lostSalesBySource.sourceC.byCurrency,
      [{ key: "currencyCode", header: "Confirmed loss from returned goods -- Currency" }, { key: "recordCount", header: "Record count" }, { key: "estimatedValue", header: "Confirmed loss value" }]
    );
    const sourceCTotalsCsv = buildCsv(
      [{ metric: "Confirmed-loss returns, total", value: String(report.lostSalesBySource.sourceC.totalLossRecords) },
       { metric: "Confirmed-loss returns priced", value: String(report.lostSalesBySource.sourceC.recordsWithEstimate) },
       { metric: "Confirmed-loss returns without a price (excluded)", value: String(report.lostSalesBySource.sourceC.recordsWithoutEstimate) }],
      [{ key: "metric", header: "Confirmed loss from returned goods totals" }, { key: "value", header: "Value" }]
    );

    const otherRows = [
      ...flattenToKeyValueRows(report.claims.statusCounts, "claims.statusCounts"),
      ...flattenToKeyValueRows(report.claims.categoryCounts, "claims.categoryCounts"),
      ...flattenToKeyValueRows(report.claims.priorityCounts, "claims.priorityCounts"),
      ...flattenToKeyValueRows(report.claims.averageResolutionDays, "claims.averageResolutionDays"),
      ...flattenToKeyValueRows(report.reconciliation, "reconciliation"),
      ...flattenToKeyValueRows(report.returnsAndCreditNotes, "returnsAndCreditNotes"),
    ];
    const otherCsv = buildCsv(otherRows, [{ key: "metric", header: "Metric" }, { key: "value", header: "Value" }]);

    // One file: the exposure table (Source A), a blank separator, Source
    // B's totals, a blank separator, Source C's per-currency table and
    // totals, a blank separator, then everything else flattened -- a
    // single export per spec section 8, not multiple downloads for one
    // report.
    const csv = exposureCsv + "\r\n" + sourceBCsv + "\r\n" + sourceCCsv + "\r\n" + sourceCTotalsCsv + "\r\n" + otherCsv;

    await recordReportExport({
      actorId: auth.user.id,
      reportId: "financial-exposure",
      filters: { ...parsed.filters, dateFrom: report.dateFrom, dateTo: report.dateTo },
      rowCount: report.claims.exposureByCurrency.length + 3 + report.lostSalesBySource.sourceC.byCurrency.length + 3 + otherRows.length,
    });

    return new NextResponse(csv, { headers: csvResponseHeaders("financial-exposure") });
  } catch (error) {
    console.error("Financial exposure export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the financial exposure report." }, { status: 500 });
  }
}
