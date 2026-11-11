import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { createApprovalPolicySchema } from "@/lib/approvals/validation";
import { createApprovalPolicy } from "@/lib/approvals/policies";
import { listApprovalPolicies } from "@/lib/approvals/policy-queries";

/**
 * Milestone 8. GET/POST /api/approval-policies.
 *
 * Spec section 5: policy configuration is restricted to "authorised
 * management users" -- read access is restricted to the same pair
 * (SALES_MANAGER/ADMINISTRATOR) rather than opened to SALESPERSON, since
 * a policy row surfaces the exact threshold at which a salesperson's own
 * submissions get gated, which is itself sensitive business-rule detail.
 */
export async function GET() {
  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;

  try {
    const policies = await listApprovalPolicies();
    return NextResponse.json({ success: true, policies }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to list approval policies:", error);
    return NextResponse.json({ success: false, message: "Unable to load approval policies." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = createApprovalPolicySchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid policy data.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await createApprovalPolicy(parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, id: result.id }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to create approval policy:", error);
    return NextResponse.json({ success: false, message: "Unable to create this policy." }, { status: 500 });
  }
}
