import { NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { getDecisionRecommendationDetail } from "@/lib/reporting/decision-intelligence-queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 15 (Decision Intelligence). GET a single recommendation's
 * full detail, including its complete status-change history (spec
 * sections 4 and 6). Management-only. Does not re-evaluate/sync the
 * rule catalogue -- GET /api/reports/decision-intelligence or its
 * /recommendations list endpoint already does that; this endpoint
 * serves the persisted row exactly as those calls last left it.
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid recommendation id." }, { status: 400 });
  }

  try {
    const detail = await getDecisionRecommendationDetail(id);
    if (!detail) {
      return NextResponse.json({ success: false, message: "Recommendation not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, recommendation: detail }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Decision intelligence recommendation detail failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this recommendation." }, { status: 500 });
  }
}
