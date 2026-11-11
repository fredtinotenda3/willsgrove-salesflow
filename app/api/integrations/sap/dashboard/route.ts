import { NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getSapDashboardSummary } from "@/lib/integrations/sap/queries";

/** Milestone 9 (SAP Business One Integration). GET /api/integrations/sap/dashboard. */
export async function GET() {
  const auth = await requireUserOrResponse(["ADMINISTRATOR", "SALES_MANAGER"]);
  if (!auth.ok) return auth.response;

  const summary = await getSapDashboardSummary();
  return NextResponse.json({ success: true, summary }, { headers: { "Cache-Control": "no-store" } });
}
