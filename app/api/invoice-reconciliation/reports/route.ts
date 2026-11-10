import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getInvoiceReconciliationReports } from "@/lib/invoice-reconciliation/queries";

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * GET returns the reconciliation reports (spec section 10.D): fully
 * invoiced, partially invoiced, awaiting-invoicing and over-invoiced
 * order lines, plus unmatched SAP invoices and reconciliation
 * exceptions. Any authenticated user may view it.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const includeDemo = request.nextUrl.searchParams.get("includeDemo") === "true";
    const reports = await getInvoiceReconciliationReports({ includeDemo });
    return NextResponse.json({ success: true, reports }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice reconciliation reports failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load reconciliation reports." }, { status: 500 });
  }
}
