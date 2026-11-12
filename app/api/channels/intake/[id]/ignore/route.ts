import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { ignoreMessageIntake } from "@/lib/channels/intake-review";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/channels/intake/[id]/ignore
 * Body: { reviewNotes?: string }
 *
 * Milestone 10 (Communication Channels & Fulfilment). Marks a RECEIVED
 * message as not a commercial transaction (spam, general chat, already
 * handled elsewhere) -- never deletes it; it stays visible in the
 * "ALL" inbox view for audit purposes.
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
  const reviewNotes = typeof body?.reviewNotes === "string" ? body.reviewNotes : undefined;

  try {
    const result = await ignoreMessageIntake(id, user.id, reviewNotes);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Ignoring a message intake failed:", error);
    return NextResponse.json({ success: false, message: "Unable to ignore this message." }, { status: 500 });
  }
}
