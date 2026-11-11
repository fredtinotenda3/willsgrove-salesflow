import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listIntegrationOperations } from "@/lib/integrations/sap/queries";

const VALID_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "UNCERTAIN"] as const;

/** Milestone 9 (SAP Business One Integration). GET /api/integrations/sap/operations?status=. */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse(["ADMINISTRATOR", "SALES_MANAGER"]);
  if (!auth.ok) return auth.response;

  const statusParam = request.nextUrl.searchParams.get("status");
  const status = statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam) ? (statusParam as (typeof VALID_STATUSES)[number]) : undefined;
  if (statusParam && !status) {
    return NextResponse.json({ success: false, message: "Invalid status filter." }, { status: 400 });
  }

  const operations = await listIntegrationOperations({ status });
  return NextResponse.json({ success: true, operations }, { headers: { "Cache-Control": "no-store" } });
}
