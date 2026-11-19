import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { updatePriceListEntryPrice } from "@/lib/price-list-queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Follow-up fix: "the ability to change or update prices" without
 * having to re-run the whole xlsx/CSV import for one correction. No role
 * gate, same convention as the bulk price-list import route and
 * customer-master import's read side -- any authenticated user; every
 * change is still fully audited (lib/price-list-queries.ts's
 * updatePriceListEntryPrice).
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid price-list entry id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const unitPrice = body.body.unitPrice;
  if (typeof unitPrice !== "string") {
    return NextResponse.json({ success: false, message: "unitPrice (string) is required." }, { status: 400 });
  }

  try {
    const result = await updatePriceListEntryPrice(id, unitPrice, auth.user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, unitPrice: result.unitPrice });
  } catch (error) {
    console.error("Price-list entry update failed:", error);
    return NextResponse.json({ success: false, message: "Unable to update this price." }, { status: 500 });
  }
}
