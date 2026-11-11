import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getInvoiceClaimsDashboard } from "@/lib/invoice-claims/dashboard";

/**
 * Milestone 6A. GET returns the claims dashboard/reporting aggregates
 * (spec section 8): counts by status/category/priority/customer/
 * department, products with recurring quality problems, financial
 * exposure by currency, average resolution time, and repeat complaints.
 * Any authenticated user may view it.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const includeDemo = request.nextUrl.searchParams.get("includeDemo") === "true";
    const dashboard = await getInvoiceClaimsDashboard({ includeDemo });
    return NextResponse.json({ success: true, dashboard }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice claims dashboard failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the claims dashboard." }, { status: 500 });
  }
}
