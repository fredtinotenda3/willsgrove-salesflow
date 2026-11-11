import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { approveClaimResolutionSchema } from "@/lib/invoice-claims/validation";
import { approveClaimResolution } from "@/lib/invoice-claims/claim-resolution";

type RouteContext = { params: Promise<{ id: string; resolutionId: string }> };

/**
 * Milestone 6A. POST approves a previously-recorded resolution
 * recommendation. Restricted to SALES_MANAGER/ADMINISTRATOR -- the
 * confirmed authorization split's approval side (mirrors Milestone 4's
 * confirm-lost-sale gate, Milestone 5's manual-match gate). The claim's
 * resulting status is never chosen here -- it is the structural mapping
 * resolutionDecisionToClaimStatus() produces from the resolution's own
 * decision, so this route cannot "approve into" an arbitrary status.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id, resolutionId } = await context.params;
  if (!isValidId(id) || !isValidId(resolutionId)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = approveClaimResolutionSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid approval data.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await approveClaimResolution(id, resolutionId, parsed.data.approvedCreditAmount, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, claimStatus: result.claimStatus }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice claim resolution approval failed:", error);
    return NextResponse.json({ success: false, message: "Unable to approve this resolution." }, { status: 500 });
  }
}
