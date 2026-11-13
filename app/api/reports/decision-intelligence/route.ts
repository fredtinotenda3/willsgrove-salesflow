import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getDecisionIntelligenceOverview } from "@/lib/reporting/decision-intelligence-queries";

/**
 * Milestone 15 (Decision Intelligence). GET the executive decision
 * summary and priority attention queue (spec sections 3.1/3.2).
 * Management-only (lib/reporting/access.ts), same tier as every other
 * M12-M14 management report. Evaluates and syncs the full rule
 * catalogue on every call -- see lib/reporting/decision-intelligence-
 * queries.ts's own module comment for why there is no separate
 * "regenerate" action to call first.
 */
export async function GET(request: NextRequest) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const overview = await getDecisionIntelligenceOverview(parsed.filters, { id: auth.user.id, role: auth.user.role });
    return NextResponse.json({ success: true, overview }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Decision intelligence overview failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the decision intelligence overview." }, { status: 500 });
  }
}
