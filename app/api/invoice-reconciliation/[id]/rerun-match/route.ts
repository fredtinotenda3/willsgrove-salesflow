import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { rerunAutoMatchForInvoice } from "@/lib/invoice-reconciliation/manual-actions";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * POST re-runs the conservative automatic matcher over this invoice's
 * currently-UNMATCHED lines only -- useful after a reopened line frees
 * up order-line capacity. Restricted to SALES_MANAGER/ADMINISTRATOR, same
 * gate as the other reconciliation-workspace actions.
 */
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
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  try {
    const result = await rerunAutoMatchForInvoice(id, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Re-running automatic matching failed:", error);
    return NextResponse.json({ success: false, message: "Unable to re-run automatic matching for this invoice." }, { status: 500 });
  }
}
