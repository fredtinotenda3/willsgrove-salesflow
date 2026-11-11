import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listApprovalsQuerySchema } from "@/lib/approvals/validation";
import { listApprovalRequests, type ApprovalListFilters } from "@/lib/approvals/queries";

/**
 * Milestone 8 (Validation and Approvals).
 *
 * GET /api/approvals -- list with filters (module, actionType, status,
 * requestedById, decidedById, date range, currency) plus the three
 * convenience tabs the UI's own dashboard page uses: `mine=submitted`,
 * `mine=pendingDecision`. Open to any authenticated user -- reading the
 * list itself carries no authority (deciding a request does, checked at
 * its own route below), same split every other milestone's list route
 * already follows.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const url = new URL(request.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const parsed = listApprovalsQuerySchema.safeParse(params);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid filter parameters.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  const mineParam = url.searchParams.get("mine");
  // Explicitly typed (rather than left to inference) so `kind` keeps its
  // narrowed literal union instead of widening to `string` -- an object
  // literal with no contextual type infers each property's declared
  // (widened) type, not the type narrowed by the `===` checks above.
  const mine: ApprovalListFilters["mine"] =
    mineParam === "submitted" || mineParam === "pendingDecision" ? { viewerId: user.id, kind: mineParam, viewerRole: user.role } : undefined;

  try {
    const rows = await listApprovalRequests({ ...parsed.data, mine });
    return NextResponse.json({ success: true, requests: rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Approval list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load approval requests." }, { status: 500 });
  }
}
