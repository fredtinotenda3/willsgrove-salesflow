import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { changeDispatchAssignmentSchema } from "@/lib/fulfilment/validation";
import { changeDispatchAssignment } from "@/lib/fulfilment/dispatch";

type RouteContext = { params: Promise<{ id: string; dispatchId: string }> };

/**
 * PATCH /api/orders/[id]/dispatch/[dispatchId]/assignment -- change the
 * driver, assistant and/or vehicle of a PLANNED or DEPARTED dispatch. Any
 * authenticated user, matching the rest of the dispatch routes (there is no
 * dedicated warehouse role -- see lib/fulfilment/dispatch.ts). The change,
 * with its before/after values and reason, is written to the order's
 * fulfilment history.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id, dispatchId } = await context.params;
  if (!isValidId(id) || !isValidId(dispatchId)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = changeDispatchAssignmentSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid request.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await changeDispatchAssignment(id, dispatchId, user.id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Changing a dispatch assignment failed:", error);
    return NextResponse.json({ success: false, message: "Unable to change this dispatch's assignment." }, { status: 500 });
  }
}
