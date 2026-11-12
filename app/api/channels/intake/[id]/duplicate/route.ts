import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { markMessageIntakeDuplicate } from "@/lib/channels/intake-review";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/channels/intake/[id]/duplicate
 * Body: { duplicateOfId: string; reviewNotes?: string }
 *
 * Milestone 10 (Communication Channels & Fulfilment). Marks a RECEIVED
 * message as a re-delivery of an earlier MessageIntake -- spec point 1's
 * "avoid duplicate intake" for the cases a provider's own
 * externalMessageId (the DB-level, automatic guard) doesn't catch, e.g.
 * a customer re-sending the same PO as a fresh message.
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

  const body = await request.json().catch(() => null);
  if (!body || typeof body.duplicateOfId !== "string" || !isValidId(body.duplicateOfId)) {
    return NextResponse.json({ success: false, message: "duplicateOfId is required." }, { status: 400 });
  }
  const reviewNotes = typeof body.reviewNotes === "string" ? body.reviewNotes : undefined;

  try {
    const result = await markMessageIntakeDuplicate(id, user.id, body.duplicateOfId, reviewNotes);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Marking a message intake as duplicate failed:", error);
    return NextResponse.json({ success: false, message: "Unable to mark this message as a duplicate." }, { status: 500 });
  }
}
