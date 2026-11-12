import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { linkMessageIntakeToOrder, linkMessageIntakeToQuotation } from "@/lib/channels/intake-review";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/channels/intake/[id]/link
 * Body: { targetType: "ORDER" | "QUOTATION"; targetId: string; reviewNotes?: string }
 *
 * Milestone 10 (Communication Channels & Fulfilment). Ties a follow-up
 * message (e.g. "where is my delivery") to an ALREADY-EXISTING order or
 * quotation -- never creates a new PO. See MessageIntakeStatus's own
 * schema comment.
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
  if (!body || (body.targetType !== "ORDER" && body.targetType !== "QUOTATION") || typeof body.targetId !== "string" || !isValidId(body.targetId)) {
    return NextResponse.json({ success: false, message: "targetType ('ORDER' or 'QUOTATION') and a valid targetId are required." }, { status: 400 });
  }
  const reviewNotes = typeof body.reviewNotes === "string" ? body.reviewNotes : undefined;

  try {
    const result =
      body.targetType === "ORDER"
        ? await linkMessageIntakeToOrder(id, user.id, body.targetId, reviewNotes)
        : await linkMessageIntakeToQuotation(id, user.id, body.targetId, reviewNotes);

    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Linking a message intake failed:", error);
    return NextResponse.json({ success: false, message: "Unable to link this message." }, { status: 500 });
  }
}
