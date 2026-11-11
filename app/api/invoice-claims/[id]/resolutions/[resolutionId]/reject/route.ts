import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { rejectClaimResolutionSchema } from "@/lib/invoice-claims/validation";
import { rejectClaimResolution } from "@/lib/invoice-claims/claim-resolution";

type RouteContext = { params: Promise<{ id: string; resolutionId: string }> };

/**
 * Milestone 6A. POST rejects a previously-recorded resolution
 * recommendation (a manager explicitly declining it, with a required
 * reason -- mirrors Milestone 5's reopenInvoiceLineMatch's required-
 * reason pattern). Restricted to SALES_MANAGER/ADMINISTRATOR. Does not by
 * itself change the claim's own status -- someone still records a new
 * resolution or explicitly changes the claim's status afterward.
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

  const parsed = rejectClaimResolutionSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "A rejection reason is required.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await rejectClaimResolution(id, resolutionId, parsed.data.rejectionReason, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice claim resolution rejection failed:", error);
    return NextResponse.json({ success: false, message: "Unable to reject this resolution." }, { status: 500 });
  }
}
