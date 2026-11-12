import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { createDispatchSchema } from "@/lib/fulfilment/validation";
import { createDispatchRecord } from "@/lib/fulfilment/dispatch";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/dispatch
 *
 * Milestone 10 (Communication Channels & Fulfilment). Creates a new
 * DispatchRecord (status PLANNED) against an order that is
 * READY_TO_INVOICE, for the requested lines/quantities. Any authenticated
 * role -- see lib/fulfilment/dispatch.ts's own comment for why this has
 * no dedicated role, same as picking itself.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = createDispatchSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid dispatch request.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await createDispatchRecord(id, user.id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, dispatchRecordId: result.dispatchRecordId }, { status: 201 });
  } catch (error) {
    console.error("Creating a dispatch record failed:", error);
    return NextResponse.json({ success: false, message: "Unable to create this dispatch." }, { status: 500 });
  }
}
