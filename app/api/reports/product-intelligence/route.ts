import { NextRequest, NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { parseReportFilters, parsePagination, REPORT_DEFAULT_PAGE_SIZE } from "@/lib/reporting/filters";
import { getProductIntelligenceOverview } from "@/lib/reporting/product-insights-queries";

/**
 * Milestone 14 (Product Intelligence). Management overview --
 * SALES_MANAGER/ADMINISTRATOR only, same lib/reporting/access.ts gate
 * every other M11/M12/M13 management report already uses. Enforced
 * server-side; a hidden nav link for SALESPERSON is never the actual
 * control.
 *
 * getProductIntelligenceOverview() returns all TEN spec section 4.B
 * dimensions in one call, each under its own named key, never merged
 * into one row set (spec: "do not combine these independent dimensions
 * into one composite score"). Only the largest dimension --
 * revenueQuantityFrequencyCustomers.rows, one row per product with any
 * qualifying-invoice activity in the selected period, items 1-4 --  is
 * paginated for the screen, in memory over that already-computed set,
 * the SAME pattern app/api/reports/customer-intelligence/route.ts
 * already establishes for its own (much smaller, one-row-per-customer)
 * result set. The other nine dimensions are each already bounded to
 * "products with a recorded incident/flag in the period" -- inherently
 * far smaller than the full product catalogue -- and are returned
 * whole. The CSV export (./export/route.ts) never applies this slice,
 * per spec section 15.
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
    const report = await getProductIntelligenceOverview(parsedFilters.filters);

    const { page, pageSize } = parsedPagination.pagination;
    const totalItems = report.revenueQuantityFrequencyCustomers.rows.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const start = (page - 1) * pageSize;
    const pagedRows = report.revenueQuantityFrequencyCustomers.rows.slice(start, start + pageSize);

    return NextResponse.json(
      {
        success: true,
        report: { ...report, revenueQuantityFrequencyCustomers: { ...report.revenueQuantityFrequencyCustomers, rows: pagedRows } },
        pagination: { page, pageSize: pageSize || REPORT_DEFAULT_PAGE_SIZE, totalItems, totalPages },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Product intelligence overview failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the product intelligence overview." }, { status: 500 });
  }
}
