import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { updateDecisionRecommendationStatusSchema } from "@/lib/reporting/decision-intelligence-validation";
import { updateDecisionRecommendationStatus } from "@/lib/reporting/decision-intelligence-queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 15 (Decision Intelligence). POST /api/reports/decision-
 * intelligence/recommendations/[id]/status -- the one mutation this
 * milestone's API exposes (spec section 5's lifecycle transitions).
 * Same CSRF -> role-gated auth -> isValidId -> readJsonObject -> zod
 * safeParse -> service-layer call template every existing mutation
 * route in this project follows (app/api/approvals/[id]/approve/
 * route.ts). Management-only -- same tier as every other decision-
 * intelligence endpoint; there is no SALESPERSON-level mutation here.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid recommendation id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = updateDecisionRecommendationStatusSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid request body.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await updateDecisionRecommendationStatus(id, parsed.data.status, user.id, parsed.data.note ?? null);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Decision intelligence status update failed:", error);
    return NextResponse.json({ success: false, message: "Unable to update this recommendation's status." }, { status: 500 });
  }
}
