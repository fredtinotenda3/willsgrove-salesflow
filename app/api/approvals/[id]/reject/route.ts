import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { rejectApprovalRequestSchema } from "@/lib/approvals/validation";
import { rejectApprovalRequest } from "@/lib/approvals/requests";

type RouteContext = { params: Promise<{ id: string }> };

/** Milestone 8. POST /api/approvals/[id]/reject -- a reason is mandatory. Same coarse/fine role split as the approve route. */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
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

  const parsed = rejectApprovalRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "A rejection reason is required.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await rejectApprovalRequest(id, user.id, user.role as "SALES_MANAGER" | "ADMINISTRATOR", parsed.data.decisionReason);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Approval decision failed:", error);
    return NextResponse.json({ success: false, message: "Unable to reject this request." }, { status: 500 });
  }
}
