import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getOrBuildReviewSession } from "@/lib/review/build-review-session";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 2B. GET /api/po-intake/[id]/review -- opens (materializing
 * the first time, idempotently) the review workspace for one PO intake
 * document: computed customer/product matches, duplicate warnings, and
 * one row per extracted line for the human to accept, override, or
 * exclude. Read-only -- see .../review/confirm for the action that
 * actually turns this into an order.
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return Response.json({ success: false, message: "Invalid document id." }, { status: 400 });
  }

  try {
    const result = await getOrBuildReviewSession(id);
    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }
    return Response.json({ success: true, session: result.session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Review session build failed:", error);
    return Response.json({ success: false, message: "Unable to load the review workspace for this document." }, { status: 500 });
  }
}
