import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters, parsePagination, REPORT_DEFAULT_PAGE_SIZE } from "@/lib/reporting/filters";
import { getCustomerIntelligenceOverview } from "@/lib/reporting/customer-revenue-queries";

/**
 * Milestone 13 (Customer Intelligence). Management overview --
 * SALES_MANAGER/ADMINISTRATOR only, same lib/reporting/access.ts gate
 * every other M11/M12 management report already uses. Enforced
 * server-side; the hidden nav link for SALESPERSON is never the actual
 * control.
 *
 * getCustomerIntelligenceOverview() itself does no per-customer looping
 * and returns the FULL ranked set for the filtered population in one
 * pass (lib/reporting/customer-revenue-queries.ts). Pagination for the
 * screen is applied here, in memory, over that already-computed set --
 * never by re-querying per page. The CSV export (./export/route.ts)
 * deliberately skips this slice and exports every filtered row, per
 * spec section 15.
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

  // Milestone 13 default: OFF unless the caller explicitly asks for it --
  // see getCustomerIntelligenceOverview()'s own doc comment for why
  // (an intelligence report should not hide a customer with real
  // invoice history just because they have gone INACTIVE or quiet).
  const minimumActivityOnly = request.nextUrl.searchParams.get("minimumActivityOnly") === "true";

  try {
    const report = await getCustomerIntelligenceOverview(parsedFilters.filters, minimumActivityOnly);

    const { page, pageSize } = parsedPagination.pagination;
    const totalItems = report.rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const start = (page - 1) * pageSize;
    const pagedRows = report.rows.slice(start, start + pageSize);

    return NextResponse.json(
      {
        success: true,
        report: { ...report, rows: pagedRows },
        pagination: { page, pageSize: pageSize || REPORT_DEFAULT_PAGE_SIZE, totalItems, totalPages },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Customer intelligence overview failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the customer intelligence overview." }, { status: 500 });
  }
}
