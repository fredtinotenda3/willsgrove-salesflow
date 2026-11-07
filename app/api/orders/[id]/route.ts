import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getOrderById } from "@/lib/order-queries";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const { id } = await context.params;
    if (!isValidId(id)) {
      return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
    }

    const order = await getOrderById(id);
    if (!order) {
      return NextResponse.json({ success: false, message: "Order not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true, order }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Order load failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the order." }, { status: 500 });
  }
}
