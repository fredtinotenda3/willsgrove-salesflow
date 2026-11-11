import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { changeClaimStatusSchema } from "@/lib/invoice-claims/validation";
import { changeClaimStatus } from "@/lib/invoice-claims/claim-lifecycle";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6A. POST changes a claim's status along the validated
 * transition graph (lib/invoice-claims/validation.ts). Deliberately open
 * to ANY authenticated user at the route layer -- unlike every other
 * approval-weight action in this project, which gates the whole route by
 * role, this route inline-checks the role only for the SPECIFIC
 * transition requested (changeClaimStatus's `requiresApproval` result),
 * since a plain investigation-workflow move (e.g. OPEN ->
 * UNDER_INVESTIGATION) is open to anyone, while the SAME route's
 * approval-weight transitions (-> APPROVED/RESOLVED/REJECTED/CLOSED) are
 * not. See docs/milestones/PROGRESS.md's Milestone 6A section for why
 * this is a deliberate, confirmed variation on the project's usual
 * route-level role gate, not an inconsistency.
 */
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
    return NextResponse.json({ success: false, message: "Invalid claim id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = changeClaimStatusSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid status change request.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await changeClaimStatus(id, parsed.data.toStatus, parsed.data.reason, user.id, user.role);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, requiresApproval: result.requiresApproval }, { status: result.status });
    }
    return NextResponse.json({ success: true, status: result.status }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice claim status change failed:", error);
    return NextResponse.json({ success: false, message: "Unable to change this claim's status." }, { status: 500 });
  }
}
