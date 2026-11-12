import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getOperationalDashboard } from "@/lib/reporting/operational-dashboard";

/**
 * Milestone 11 (Operational BI), spec section 3. GET returns the
 * curated operational dashboard -- a right-now snapshot, open to any
 * authenticated role (same precedent every other dashboard route in
 * this app already follows). `includeDemo`/`customerId` are the only
 * filters this view honors (spec section 3 is a "current state"
 * snapshot, not a date-range report); the rest of ReportFilters is
 * accepted but ignored here, same as every per-module dashboard route
 * today ignores query params it doesn't use.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const dashboard = await getOperationalDashboard(auth.user.id, auth.user.role, parsed.filters);
    return NextResponse.json({ success: true, dashboard }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Operational dashboard failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the operational dashboard." }, { status: 500 });
  }
}
