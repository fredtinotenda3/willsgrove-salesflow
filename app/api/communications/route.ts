import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listOutboundMessages } from "@/lib/communications/queries";

/**
 * GET /api/communications?status=FAILED&channel=EMAIL&page=1&pageSize=25
 *
 * Milestone 10 (Communication Channels & Fulfilment). The outbound
 * communications log -- any authenticated role can view it (read-only);
 * only SALES_MANAGER/ADMINISTRATOR can resend (see .../[id]/resend).
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const params = request.nextUrl.searchParams;
  const page = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get("pageSize") ?? "25", 10) || 25));

  const result = await listOutboundMessages({
    page,
    pageSize,
    status: params.get("status"),
    channel: params.get("channel"),
    customerId: params.get("customerId"),
  });

  return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
}
