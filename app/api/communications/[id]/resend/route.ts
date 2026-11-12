import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { resendOutboundMessage } from "@/lib/communications/send";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/communications/[id]/resend
 *
 * Milestone 10 (Communication Channels & Fulfilment). Re-attempts a
 * FAILED OutboundMessage's send, using its exact, already-rendered
 * bodyText -- see lib/communications/send.ts's resendOutboundMessage for
 * why. Restricted to SALES_MANAGER/ADMINISTRATOR -- a deliberately more
 * sensitive action than the ordinary operational actions elsewhere in
 * this milestone (picking, dispatch, delivery all have no dedicated
 * role), since resending is a correction a human has specifically
 * decided is worth retrying, not a routine step of the normal flow.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid message id." }, { status: 400 });
  }

  try {
    const result = await resendOutboundMessage(id, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error(`Resending outbound message ${id} failed:`, error);
    return NextResponse.json({ success: false, message: "Unable to resend this message." }, { status: 500 });
  }
}
