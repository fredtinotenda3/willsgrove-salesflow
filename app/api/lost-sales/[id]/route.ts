import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getUnfulfilledDemandDetail } from "@/lib/lost-sales/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 4 (Lost-Sales Management).
 * GET returns one UnfulfilledDemand record with its full decision/
 * lost-sale history -- spec section 6: "the salesperson should be able
 * to open a record and see its full history."
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  try {
    const demand = await getUnfulfilledDemandDetail(id);
    if (!demand) {
      return NextResponse.json({ success: false, message: "Unfulfilled demand record not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, demand }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Lost-sales detail failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this record." }, { status: 500 });
  }
}
