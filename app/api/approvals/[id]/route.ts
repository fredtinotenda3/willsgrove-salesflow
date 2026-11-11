import { NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getApprovalRequestById } from "@/lib/approvals/queries";

type RouteContext = { params: Promise<{ id: string }> };

/** Milestone 8. GET /api/approvals/[id] -- detail: submitted values, current business-record values, and the full event timeline (spec section 8). */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid approval request id." }, { status: 400 });
  }

  try {
    const request = await getApprovalRequestById(id);
    if (!request) {
      return NextResponse.json({ success: false, message: "Approval request not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, request }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Approval detail failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this approval request." }, { status: 500 });
  }
}
