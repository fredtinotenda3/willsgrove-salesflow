import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters, parsePagination } from "@/lib/reporting/filters";
import { isManagementReportId, runManagementReport, type OperationalSummaryPeriod } from "@/lib/reporting/management-reports";

type RouteContext = { params: Promise<{ reportId: string }> };

const VALID_PERIODS: OperationalSummaryPeriod[] = ["daily", "weekly", "monthly"];

/**
 * Milestone 11, spec section 9. GET runs one named management report
 * and returns its data. Restricted to SALES_MANAGER/ADMINISTRATOR (see
 * lib/reporting/access.ts). `period` (daily/weekly/monthly) only applies
 * to the operational-summary report; every other report ignores it.
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
  const parsedPagination = parsePagination(request.nextUrl.searchParams);
  if (!parsedPagination.ok) {
    return NextResponse.json({ success: false, message: parsedPagination.message }, { status: 400 });
  }

  const rawPeriod = request.nextUrl.searchParams.get("period");
  const period: OperationalSummaryPeriod = VALID_PERIODS.includes(rawPeriod as OperationalSummaryPeriod) ? (rawPeriod as OperationalSummaryPeriod) : "daily";

  try {
    const result = await runManagementReport(reportId, parsedFilters.filters, parsedPagination.pagination, period);
    return NextResponse.json({ success: true, reportId, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(`Management report "${reportId}" failed:`, error);
    return NextResponse.json({ success: false, message: "Unable to load this report." }, { status: 500 });
  }
}
