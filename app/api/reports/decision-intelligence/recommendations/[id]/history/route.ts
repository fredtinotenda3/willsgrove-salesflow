import { NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { getDecisionRecommendationHistory } from "@/lib/reporting/decision-intelligence-queries";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 15 (Decision Intelligence). GET a single recommendation's
 * full status-change history on its own (spec section 9 names this as
 * its own endpoint, distinct from the combined detail view, which also
 * embeds the same history under `.history`). Management-only.
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid recommendation id." }, { status: 400 });
  }

  try {
    const exists = await prisma.decisionRecommendation.findUnique({ where: { id }, select: { id: true } });
    if (!exists) {
      return NextResponse.json({ success: false, message: "Recommendation not found." }, { status: 404 });
    }
    const history = await getDecisionRecommendationHistory(id);
    return NextResponse.json({ success: true, history }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Decision intelligence history failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this recommendation's history." }, { status: 500 });
  }
}
