import { NextRequest } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { startPickingSession } from "@/lib/picking/start-picking";
import { getLatestPickingSessionForOrder } from "@/lib/picking/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 * GET returns the most recent picking session for this order (any
 * status), or null if picking has never been started. POST starts a new
 * one -- any authenticated user may do this (no dedicated picking role;
 * see lib/picking/start-picking.ts's module comment).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return Response.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  try {
    const session = await getLatestPickingSessionForOrder(id);
    return Response.json({ success: true, session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Picking session lookup failed:", error);
    return Response.json({ success: false, message: "Unable to load this order's picking session." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return Response.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  try {
    const result = await startPickingSession(id, user.id);
    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }
    return Response.json({ success: true, session: result.session }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Starting a picking session failed:", error);
    return Response.json({ success: false, message: "Unable to start picking for this order." }, { status: 500 });
  }
}
