import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getSalesPipelineReport } from "@/lib/reporting/sales-pipeline";
import { buildCsv, flattenToKeyValueRows, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/**
 * Milestone 11, spec section 8: CSV export for the sales-pipeline view.
 * Same access as the view it exports (open to any authenticated role --
 * spec section 8's "ensure exported results respect... user
 * permissions" is satisfied by an export never being reachable to
 * someone who couldn't see the view in the first place). Two sections
 * in one file: the funnel's named figures as metric/value rows, then
 * the bottleneck transitions as their own rows.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const report = await getSalesPipelineReport(parsed.filters);
    const funnelRows = flattenToKeyValueRows(report.funnel);
    const bottleneckRows = report.bottlenecks.map((b) => ({ metric: `bottleneck.${b.transition}.averageDays`, value: b.averageDays === null ? "" : String(b.averageDays) }));
    const bottleneckSampleRows = report.bottlenecks.map((b) => ({ metric: `bottleneck.${b.transition}.sampleSize`, value: String(b.sampleSize) }));
    const csv = buildCsv([...funnelRows, ...bottleneckRows, ...bottleneckSampleRows], [{ key: "metric", header: "Metric" }, { key: "value", header: "Value" }]);

    await recordReportExport({ actorId: auth.user.id, reportId: "sales-pipeline", filters: { ...parsed.filters, dateFrom: report.dateFrom, dateTo: report.dateTo }, rowCount: funnelRows.length + bottleneckRows.length });

    return new NextResponse(csv, { headers: csvResponseHeaders("sales-pipeline") });
  } catch (error) {
    console.error("Sales pipeline export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the sales pipeline report." }, { status: 500 });
  }
}
