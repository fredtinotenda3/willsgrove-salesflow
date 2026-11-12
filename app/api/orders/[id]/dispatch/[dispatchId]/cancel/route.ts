import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { cancelDispatchSchema } from "@/lib/fulfilment/validation";
import { cancelDispatchRecord } from "@/lib/fulfilment/dispatch";

type RouteContext = { params: Promise<{ id: string; dispatchId: string }> };

/**
 * POST /api/orders/[id]/dispatch/[dispatchId]/cancel -- PLANNED -> CANCELLED.
 * Milestone 10. Only a dispatch that has not yet departed can be
 * cancelled -- see lib/fulfilment/dispatch.ts's own message for why.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { dispatchId } = await context.params;
  if (!isValidId(dispatchId)) {
    return NextResponse.json({ success: false, message: "Invalid dispatch id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = cancelDispatchSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid request.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await cancelDispatchRecord(dispatchId, user.id, parsed.data.reason);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Cancelling a dispatch failed:", error);
    return NextResponse.json({ success: false, message: "Unable to cancel this dispatch." }, { status: 500 });
  }
}
