import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { updateApprovalPolicySchema } from "@/lib/approvals/validation";
import { updateApprovalPolicy } from "@/lib/approvals/policies";
import { getApprovalPolicyById } from "@/lib/approvals/policy-queries";

type RouteContext = { params: Promise<{ id: string }> };

/** Milestone 8. GET/PATCH /api/approval-policies/[id] -- same role gate as the collection route. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid approval policy id." }, { status: 400 });
  }

  try {
    const policy = await getApprovalPolicyById(id);
    if (!policy) {
      return NextResponse.json({ success: false, message: "Approval policy not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, policy }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load approval policy:", error);
    return NextResponse.json({ success: false, message: "Unable to load this policy." }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid approval policy id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = updateApprovalPolicySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid policy data.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await updateApprovalPolicy(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to update approval policy:", error);
    return NextResponse.json({ success: false, message: "Unable to update this policy." }, { status: 500 });
  }
}
