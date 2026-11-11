import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { submitOrderToSap } from "@/lib/integrations/sap/order-outbox";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 9 (SAP Business One Integration). POST /api/orders/[id]/
 * sap-submit -- submits one CustomerOrder to SAP as a sales order (spec
 * section 10). Deliberately under /api/orders/, not /api/integrations/
 * sap/, since this acts on a specific order the caller already has
 * permission to see -- lib/integrations/sap/order-eligibility.ts's own
 * checks (quotation-converted, mapped customer/products, no live
 * approval gate) are the real authorization-relevant gate; the role
 * check here is coarse, same pattern as app/api/approvals/[id]/
 * approve/route.ts.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR", "SALES_MANAGER"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  try {
    const result = await submitOrderToSap(id);
    if (!result.ok && result.reason === "NOT_ELIGIBLE") {
      return NextResponse.json({ success: false, message: "This order is not eligible for SAP submission.", blockers: result.blockers }, { status: 409 });
    }
    return NextResponse.json({ success: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("SAP sales-order submission failed unexpectedly:", error);
    return NextResponse.json({ success: false, message: "Unable to submit this order to SAP." }, { status: 500 });
  }
}
