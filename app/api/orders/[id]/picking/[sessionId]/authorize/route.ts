import { NextRequest } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { authorizePickingSession } from "@/lib/picking/authorize-picking";
import { queuePickingUpdateMessage } from "@/lib/communications/send";

type RouteContext = { params: Promise<{ id: string; sessionId: string }> };

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

  const { id: orderId, sessionId } = await context.params;
  if (!isValidId(sessionId) || !isValidId(orderId)) {
    return Response.json({ success: false, message: "Invalid session id." }, { status: 400 });
  }

  try {
    const result = await authorizePickingSession(sessionId, user.id);
    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }

    // Milestone 10. See app/api/quotations/[id]/issue/route.ts's identical
    // comment -- a notification failure never affects this response. The
    // order id comes from this route's own URL segment, not from
    // authorizePickingSession's return value, so lib/picking/authorize-
    // picking.ts (Milestone 3A, already shipped) stays untouched.
    try {
      await queuePickingUpdateMessage(orderId, user.id);
    } catch (notifyError) {
      console.error(`Failed to queue picking-update message for order ${orderId}:`, notifyError);
    }

    return Response.json({ success: true, session: result.session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Authorizing a picking session failed:", error);
    return Response.json({ success: false, message: "Unable to authorize this picking session." }, { status: 500 });
  }
}
