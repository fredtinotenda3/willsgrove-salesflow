import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getOrderFulfilmentStatus, listDispatchRecordsForOrder } from "@/lib/fulfilment/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/orders/[id]/fulfilment
 *
 * Milestone 10 (Communication Channels & Fulfilment). The /fulfilment
 * dispatch screen's one combined read: per-line outstanding-to-dispatch
 * quantities, plus every DispatchRecord already created for this order.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  const status = await getOrderFulfilmentStatus(id);
  if (!status) {
    return NextResponse.json({ success: false, message: "Order not found." }, { status: 404 });
  }

  const dispatches = await listDispatchRecordsForOrder(id);

  return NextResponse.json({ success: true, fulfilment: status, dispatches }, { headers: { "Cache-Control": "no-store" } });
}
