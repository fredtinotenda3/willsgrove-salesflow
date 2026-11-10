import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getLostSalesReportSummary } from "@/lib/lost-sales/queries";

/**
 * Milestone 4 (Lost-Sales Management).
 * GET returns the spec section 7 reporting summary -- distinct,
 * clearly-labeled figures (never one blended "lost sales" number).
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const includeDemo = request.nextUrl.searchParams.get("includeDemo") === "true";
    const summary = await getLostSalesReportSummary({ includeDemo });
    return NextResponse.json({ success: true, summary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Lost-sales report failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the lost-sales report." }, { status: 500 });
  }
}
