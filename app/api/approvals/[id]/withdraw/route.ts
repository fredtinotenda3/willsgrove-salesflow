import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { withdrawApprovalRequestSchema } from "@/lib/approvals/validation";
import { withdrawApprovalRequest } from "@/lib/approvals/requests";

type RouteContext = { params: Promise<{ id: string }> };

/** Milestone 8. POST /api/approvals/[id]/withdraw -- requester-only (enforced in lib/approvals/requests.ts), no role gate here: a SALESPERSON can withdraw their own request. */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid approval request id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = withdrawApprovalRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid request body." }, { status: 400 });
  }

  try {
    const result = await withdrawApprovalRequest(id, user.id, parsed.data.decisionReason);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Approval withdrawal failed:", error);
    return NextResponse.json({ success: false, message: "Unable to withdraw this request." }, { status: 500 });
  }
}
