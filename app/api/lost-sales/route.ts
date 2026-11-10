import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listUnfulfilledDemands, parseUnfulfilledDemandListQuery } from "@/lib/lost-sales/queries";

/**
 * Milestone 4 (Lost-Sales Management).
 * GET lists unfulfilled-demand records -- spec section 6's required list
 * view. Any authenticated user may view it (no dedicated role, same
 * convention as /api/orders and the picking queue).
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const parsed = parseUnfulfilledDemandListQuery(request.nextUrl.searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
    }

    const result = await listUnfulfilledDemands(parsed.query);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Lost-sales list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load unfulfilled demand records." }, { status: 500 });
  }
}
