import { NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getQuotationDashboardCounts } from "@/lib/quotations/queries";

/**
 * Milestone 7. GET /api/quotations/dashboard -- spec section 10's
 * dashboard figures (total/draft/issued-awaiting-response/accepted/
 * rejected/expired/value-by-status/due-for-follow-up). Demo rows and
 * superseded revisions are excluded by getQuotationDashboardCounts
 * itself, not here.
 */
export async function GET() {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const counts = await getQuotationDashboardCounts();
    return NextResponse.json({ success: true, counts }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation dashboard counts failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load quotation dashboard figures." }, { status: 500 });
  }
}
