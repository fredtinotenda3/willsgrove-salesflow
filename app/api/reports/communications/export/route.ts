import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getCommunicationsMonitoringReport } from "@/lib/reporting/communications-monitoring";
import { buildCsv, flattenToKeyValueRows, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

/** Milestone 11, spec section 8: CSV export for the communications-monitoring view. */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const report = await getCommunicationsMonitoringReport(parsed.filters);
    const byChannelCsv = buildCsv(report.intake.byChannel, [{ key: "channel", header: "Channel" }, { key: "count", header: "Requests received" }]);
    const otherRows = [
      ...flattenToKeyValueRows(report.channelMode, "channelMode"),
      ...flattenToKeyValueRows({ ...report.intake, byChannel: undefined }, "intake"),
      ...flattenToKeyValueRows(report.outbound, "outbound"),
      ...flattenToKeyValueRows(report.exceptions, "exceptions"),
    ];
    const otherCsv = buildCsv(otherRows, [{ key: "metric", header: "Metric" }, { key: "value", header: "Value" }]);
    const csv = byChannelCsv + "\r\n" + otherCsv;

    await recordReportExport({ actorId: auth.user.id, reportId: "communications", filters: { ...parsed.filters, dateFrom: report.dateFrom, dateTo: report.dateTo }, rowCount: report.intake.byChannel.length + otherRows.length });

    return new NextResponse(csv, { headers: csvResponseHeaders("communications") });
  } catch (error) {
    console.error("Communications export failed:", error);
    return NextResponse.json({ success: false, message: "Unable to export the communications report." }, { status: 500 });
  }
}
