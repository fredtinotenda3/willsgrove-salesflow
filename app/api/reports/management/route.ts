import { NextResponse } from "next/server";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { MANAGEMENT_REPORT_CATALOGUE } from "@/lib/reporting/management-reports";

/**
 * Milestone 11, spec section 9. GET lists the 9 named management
 * reports (catalogue metadata only -- id/name/description/kind -- not
 * their data; see GET /api/reports/management/[reportId] for that).
 * Restricted to SALES_MANAGER/ADMINISTRATOR: even the EXISTENCE of the
 * management-report catalogue is gated the same as the reports
 * themselves, so a SALESPERSON's UI never has to special-case "the list
 * came back but every item 403s."
 */
export async function GET() {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  return NextResponse.json({ success: true, reports: MANAGEMENT_REPORT_CATALOGUE }, { headers: { "Cache-Control": "no-store" } });
}
