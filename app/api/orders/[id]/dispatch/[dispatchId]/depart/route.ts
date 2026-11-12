import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { departDispatchSchema } from "@/lib/fulfilment/validation";
import { departDispatchRecord } from "@/lib/fulfilment/dispatch";
import { queueDispatchNotificationMessage } from "@/lib/communications/send";

type RouteContext = { params: Promise<{ id: string; dispatchId: string }> };

/**
 * POST /api/orders/[id]/dispatch/[dispatchId]/depart -- PLANNED -> DEPARTED.
 * Milestone 10. Triggers the customer's dispatch notification on success.
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

  const parsed = departDispatchSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid request.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await departDispatchRecord(dispatchId, user.id, parsed.data.vehicleOrCourierReference);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }

    // Milestone 10. See app/api/quotations/[id]/issue/route.ts's identical
    // comment -- a notification failure never affects this response.
    try {
      await queueDispatchNotificationMessage(dispatchId, user.id);
    } catch (notifyError) {
      console.error(`Failed to queue dispatch-notification message for dispatch ${dispatchId}:`, notifyError);
    }

    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Departing a dispatch failed:", error);
    return NextResponse.json({ success: false, message: "Unable to mark this dispatch as departed." }, { status: 500 });
  }
}
