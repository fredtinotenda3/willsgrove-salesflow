import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getDispatchRecordDetail } from "@/lib/fulfilment/queries";

type RouteContext = { params: Promise<{ id: string; dispatchId: string }> };

/**
 * GET /api/orders/[id]/dispatch/[dispatchId]
 *
 * Milestone 10 (Communication Channels & Fulfilment). Full detail for one
 * dispatch, including its delivery outcome once recorded.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id, dispatchId } = await context.params;
  if (!isValidId(id) || !isValidId(dispatchId)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const detail = await getDispatchRecordDetail(dispatchId);
  if (!detail || detail.orderId !== id) {
    return NextResponse.json({ success: false, message: "Dispatch record not found." }, { status: 404 });
  }

  return NextResponse.json({ success: true, dispatch: detail }, { headers: { "Cache-Control": "no-store" } });
}
