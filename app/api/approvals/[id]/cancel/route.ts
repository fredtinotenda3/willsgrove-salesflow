import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { cancelApprovalRequestSchema } from "@/lib/approvals/validation";
import { cancelApprovalRequest } from "@/lib/approvals/requests";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 8. POST /api/approvals/[id]/cancel -- ADMINISTRATOR-only.
 * Distinct from withdraw (the requester taking their own request back)
 * and from the system's own INVALIDATED cancellation (quotation values
 * changed) -- this is an administrator affirmatively cancelling a live
 * request for some other reason, with a mandatory, audited reason.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid approval request id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = cancelApprovalRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "A cancellation reason is required.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await cancelApprovalRequest(id, user.id, parsed.data.cancellationReason);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Approval cancellation failed:", error);
    return NextResponse.json({ success: false, message: "Unable to cancel this request." }, { status: 500 });
  }
}
