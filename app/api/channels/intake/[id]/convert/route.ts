import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { convertMessageIntakeToPoIntake } from "@/lib/channels/intake-review";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/channels/intake/[id]/convert
 * Body: { attachmentId?: string; reviewNotes?: string }
 *
 * Milestone 10 (Communication Channels & Fulfilment). Converts a RECEIVED
 * MessageIntake into a real PO intake via the existing, unmodified
 * lib/po-intake.ts pipeline -- see lib/channels/intake-review.ts's own
 * header comment for the full design. Any authenticated role (same "no
 * dedicated role" posture as picking's own recording routes) -- this is
 * an operational action, not a sign-off.
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
    return NextResponse.json({ success: false, message: "Invalid message id." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const attachmentId = typeof body?.attachmentId === "string" ? body.attachmentId : undefined;
  const reviewNotes = typeof body?.reviewNotes === "string" ? body.reviewNotes : undefined;

  try {
    const result = await convertMessageIntakeToPoIntake(id, user.id, { attachmentId, reviewNotes });
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, resultingOrderDocumentId: result.resultingOrderDocumentId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Converting a message intake failed:", error);
    return NextResponse.json({ success: false, message: "Unable to convert this message." }, { status: 500 });
  }
}
