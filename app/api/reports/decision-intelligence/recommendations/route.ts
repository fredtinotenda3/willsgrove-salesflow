import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters, parsePagination } from "@/lib/reporting/filters";
import { listDecisionRecommendations } from "@/lib/reporting/decision-intelligence-queries";

/**
 * Milestone 15 (Decision Intelligence). GET the full, filterable,
 * paginated recommendation list (spec section 9). Accepts every shared
 * filter (date range, decisionCategory, priority, recommendationStatus,
 * customerId, productId, salespersonId, currency) plus page/pageSize.
 * Management-only, same as the overview.
 */
export async function GET(request: NextRequest) {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const parsedFilters = parseReportFilters(request.nextUrl.searchParams);
  if (!parsedFilters.ok) {
    return NextResponse.json({ success: false, message: parsedFilters.message }, { status: 400 });
  }
  const parsedPagination = parsePagination(request.nextUrl.searchParams);
  if (!parsedPagination.ok) {
    return NextResponse.json({ success: false, message: parsedPagination.message }, { status: 400 });
  }

  try {
    const result = await listDecisionRecommendations(parsedFilters.filters, parsedPagination.pagination, { id: auth.user.id, role: auth.user.role });
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Decision intelligence recommendation list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load recommendations." }, { status: 500 });
  }
}
