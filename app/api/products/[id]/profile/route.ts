import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getProductProfile } from "@/lib/reporting/product-insights-queries";

/**
 * Milestone 14 (Product Intelligence). Product 360 profile -- open to
 * ALL three roles (SALESPERSON, SALES_MANAGER, ADMINISTRATOR), unlike the
 * management overview (app/api/reports/product-intelligence/route.ts,
 * gated by lib/reporting/access.ts's requireManagementReportAccess).
 * Enforced here, server-side, on every request; a hidden nav link for
 * SALESPERSON elsewhere in the UI is never the actual security control.
 * Exact same access-control shape as app/api/customers/[id]/profile/route.ts
 * (Milestone 13).
 */
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid product id." }, { status: 400 });
  }

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const profile = await getProductProfile(id, parsed.filters);
    if (!profile) {
      return NextResponse.json({ success: false, message: "Product not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, profile }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Product profile load failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the product profile." }, { status: 500 });
  }
}
