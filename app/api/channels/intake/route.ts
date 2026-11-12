import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listMessageIntakes } from "@/lib/channels/queries";

/**
 * GET /api/channels/intake?status=RECEIVED
 *
 * Milestone 10 (Communication Channels & Fulfilment). The inbox queue --
 * any authenticated role (same "no dedicated role" posture as picking's
 * own recording routes; see User's own schema comment). Defaults to
 * RECEIVED (the actual queue needing attention) when no status filter is
 * given; pass status=ALL to see everything.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const intakes = await listMessageIntakes(request.nextUrl.searchParams.get("status"));

  return NextResponse.json({ success: true, intakes }, { headers: { "Cache-Control": "no-store" } });
}
