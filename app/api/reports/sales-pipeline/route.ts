import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getSalesPipelineReport } from "@/lib/reporting/sales-pipeline";

/** Milestone 11, spec section 4. Open to any authenticated role (see lib/reporting/access.ts's module comment for the open-vs-restricted split this round settled on). */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const report = await getSalesPipelineReport(parsed.filters);
    return NextResponse.json({ success: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Sales pipeline report failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the sales pipeline report." }, { status: 500 });
  }
}
