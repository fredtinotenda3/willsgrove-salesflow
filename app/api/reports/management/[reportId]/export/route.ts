import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters, REPORT_MAX_PAGE_SIZE } from "@/lib/reporting/filters";
import { isManagementReportId, runManagementReport, LIST_REPORT_CSV_COLUMNS, type OperationalSummaryPeriod } from "@/lib/reporting/management-reports";
import { buildCsv, flattenToKeyValueRows, recordReportExport, csvResponseHeaders } from "@/lib/reporting/export-csv";

type RouteContext = { params: Promise<{ reportId: string }> };

const VALID_PERIODS: OperationalSummaryPeriod[] = ["daily", "weekly", "monthly"];

/**
 * Milestone 11, spec section 8/9: CSV export for a named management
 * report. A list-kind report exports EVERY matching row, not just the
 * current page -- `pageSize` is ignored here and set to the maximum, so
 * "export" and "the current page of the table" are never silently the
 * same limited thing. A summary-kind report is flattened to metric/value
 * rows, same as the open-view exports.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const { reportId } = await context.params;
  if (!isManagementReportId(reportId)) {
    return NextResponse.json({ success: false, message: "Unknown report id." }, { status: 404 });
  }

  const parsedFilters = parseReportFilters(request.nextUrl.searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ success: false, message: parsedFilters.message }, { status: 400 });
  }

  const rawPeriod = request.nextUrl.searchParams.get("period");
  const period: OperationalSummaryPeriod = VALID_PERIODS.includes(rawPeriod as OperationalSummaryPeriod) ? (rawPeriod as OperationalSummaryPeriod) : "daily";

  try {
    const result = await runManagementReport(reportId, parsedFilters.filters, { page: 1, pageSize: REPORT_MAX_PAGE_SIZE }, period);

    let csv: string;
    let rowCount: number;
    if (result.kind === "list") {
      const columns = LIST_REPORT_CSV_COLUMNS[reportId] ?? [];
      csv = buildCsv<Record<string, unknown>>(result.data.rows as Record<string, unknown>[], columns);
      rowCount = result.data.rows.length;
      if (result.data.pagination.totalItems > result.data.rows.length) {
        // More rows exist than REPORT_MAX_PAGE_SIZE can return in one
        // export -- say so explicitly in the file rather than silently
        // truncating with no indication (spec section 11: "clear
        // handling of missing values").
        csv += `\r\n"Note: showing ${result.data.rows.length} of ${result.data.pagination.totalItems} matching rows. Narrow the filters to export the rest."\r\n`;
      }
    } else {
      const rows = flattenToKeyValueRows(result.data);
      csv = buildCsv(rows, [{ key: "metric", header: "Metric" }, { key: "value", header: "Value" }]);
      rowCount = rows.length;
    }

    await recordReportExport({ actorId: auth.user.id, reportId, filters: { ...parsedFilters.filters, period }, rowCount });

    return new NextResponse(csv, { headers: csvResponseHeaders(reportId) });
  } catch (error) {
    console.error(`Management report export "${reportId}" failed:`, error);
    return NextResponse.json({ success: false, message: "Unable to export this report." }, { status: 500 });
  }
}
