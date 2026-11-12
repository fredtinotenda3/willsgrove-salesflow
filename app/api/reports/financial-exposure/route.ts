import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getFinancialExposureReport } from "@/lib/reporting/financial-exposure";

/**
 * Milestone 11, spec section 6. Open to any authenticated role, matching
 * the existing /api/invoice-claims/dashboard precedent this view
 * composes. See lib/reporting/management-reports.ts's
 * "invoice-claims-exposure" report for the SAME underlying data served
 * as a restricted, period-less-dependent formal report instead.
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
    return NextResponse.json({ success: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Financial exposure report failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the financial exposure report." }, { status: 500 });
  }
}
