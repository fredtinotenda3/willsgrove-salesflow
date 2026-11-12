import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getSalesPerformanceReport } from "@/lib/reporting/sales-performance";

/**
 * Milestone 12 (Sales Performance Intelligence). Management-only (see
 * lib/reporting/access.ts and this milestone's spec-revision decision),
 * unlike every M11 operational view, which stays open to any
 * authenticated role -- same two-tier split app/api/reports/management/
 * [reportId]/route.ts already uses.
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
    return NextResponse.json({ success: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Sales performance report failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the sales performance report." }, { status: 500 });
  }
}
