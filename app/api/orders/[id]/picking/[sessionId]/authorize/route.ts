import { NextRequest } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { authorizePickingSession } from "@/lib/picking/authorize-picking";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 * POST marks a COMPLETED picking session AUTHORIZED, which moves the
 * order to OrderStatus.READY_TO_INVOICE. Restricted to SALES_MANAGER and
 * ADMINISTRATOR -- the user's confirmed design ("same roles, two steps":
 * no new warehouse role, but authorization is a separate, role-gated
 * action from completing picking).
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { sessionId } = await context.params;
  if (!isValidId(sessionId)) {
    return Response.json({ success: false, message: "Invalid session id." }, { status: 400 });
  }

  try {
    const result = await authorizePickingSession(sessionId, user.id);
    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }
    return Response.json({ success: true, session: result.session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Authorizing a picking session failed:", error);
    return Response.json({ success: false, message: "Unable to authorize this picking session." }, { status: 500 });
  }
}
