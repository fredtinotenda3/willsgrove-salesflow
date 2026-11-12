import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getOutboundMessageDetail } from "@/lib/communications/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/communications/[id]
 *
 * Milestone 10 (Communication Channels & Fulfilment). Full detail for
 * one OutboundMessage, including its exact rendered bodyText and failure
 * history -- the audit trail spec point 5 asks for.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid message id." }, { status: 400 });
  }

  const detail = await getOutboundMessageDetail(id);
  if (!detail) {
    return NextResponse.json({ success: false, message: "Message not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, message: detail }, { headers: { "Cache-Control": "no-store" } });
}
