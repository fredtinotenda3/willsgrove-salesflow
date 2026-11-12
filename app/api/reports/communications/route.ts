import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { parseReportFilters } from "@/lib/reporting/filters";
import { getCommunicationsMonitoringReport } from "@/lib/reporting/communications-monitoring";

/** Milestone 11, spec section 7. Open to any authenticated role. */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const parsed = parseReportFilters(request.nextUrl.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const report = await getCommunicationsMonitoringReport(parsed.filters);
    return NextResponse.json({ success: true, report }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Communications monitoring report failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load the communications monitoring report." }, { status: 500 });
  }
}
