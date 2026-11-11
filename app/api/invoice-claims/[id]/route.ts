import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getClaimDetail } from "@/lib/invoice-claims/queries";
import { computeClaimFinancialSummary } from "@/lib/invoice-claims/financial";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6A. GET returns one claim's full detail -- header, every
 * disputed invoice line (with its own live-aggregate "already claimed
 * elsewhere" context folded in by the UI from the invoice-reconciliation
 * detail endpoint, not duplicated here), full resolution history
 * (including rejected recommendations), attachments, and the computed
 * financial exposure summary (spec section 7).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid claim id." }, { status: 400 });
  }

  try {
    const claim = await getClaimDetail(id);
    if (!claim) {
      return NextResponse.json({ success: false, message: "Claim not found." }, { status: 404 });
    }
    const financialSummary = await computeClaimFinancialSummary(id);
    return NextResponse.json({ success: true, claim, financialSummary }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice claim detail failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this claim." }, { status: 500 });
  }
}
