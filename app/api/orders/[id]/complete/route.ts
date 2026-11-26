import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { completeOrder } from "@/lib/order-completion";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/orders/[id]/complete -- "Mark as Done".
 *
 * Final step of the order workflow: once every dispatch is delivered and
 * everything picked has been invoiced and dispatched, records the delivery
 * outcome for the order's invoices (see lib/order-completion.ts). Any
 * authenticated user, the same role-agnostic precedent as recording a
 * dispatch's delivery. No request body: everything is derived from what was
 * already recorded.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  try {
    const result = await completeOrder(id, auth.user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, invoiceCount: result.invoiceCount, withClaimCount: result.withClaimCount, claimCount: result.claimCount });
  } catch (error) {
    console.error("Completing an order failed:", error);
    return NextResponse.json({ success: false, message: "Unable to complete this order." }, { status: 500 });
  }
}
