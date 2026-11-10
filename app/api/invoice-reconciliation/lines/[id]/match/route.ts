import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { manuallyMatchInvoiceLine } from "@/lib/invoice-reconciliation/manual-actions";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * POST manually links one invoice line to a specific order + order line
 * (spec section 7: "resolve ambiguous matches manually"). Restricted to
 * SALES_MANAGER/ADMINISTRATOR -- this overrides the automatic matcher's
 * own conservative "do not silently guess" safety net, same gate as
 * Milestone 4's confirm-lost-sale action.
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
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const { orderId, orderLineId, note } = body.body;
  if (typeof orderId !== "string" || !isValidId(orderId)) {
    return NextResponse.json({ success: false, message: "A valid orderId is required." }, { status: 400 });
  }
  if (typeof orderLineId !== "string" || !isValidId(orderLineId)) {
    return NextResponse.json({ success: false, message: "A valid orderLineId is required." }, { status: 400 });
  }
  if (typeof note !== "string" || note.trim() === "") {
    return NextResponse.json({ success: false, message: "An explanation is required for a manual match." }, { status: 400 });
  }

  try {
    const result = await manuallyMatchInvoiceLine(id, orderId, orderLineId, user.id, note);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Manual invoice-line match failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this manual match." }, { status: 500 });
  }
}
