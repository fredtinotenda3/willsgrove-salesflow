import { NextRequest } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { completePickingSession } from "@/lib/picking/complete-picking";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 * POST marks a picking session COMPLETED once every line fully accounts
 * for its requested quantity. Any authenticated user may complete a
 * session -- per the user's confirmed design, only the SEPARATE
 * authorize step (below) is role-restricted.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { sessionId } = await context.params;
  if (!isValidId(sessionId)) {
    return Response.json({ success: false, message: "Invalid session id." }, { status: 400 });
  }

  try {
    const result = await completePickingSession(sessionId, user.id);
    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }
    return Response.json({ success: true, session: result.session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Completing a picking session failed:", error);
    return Response.json({ success: false, message: "Unable to complete this picking session." }, { status: 500 });
  }
}
