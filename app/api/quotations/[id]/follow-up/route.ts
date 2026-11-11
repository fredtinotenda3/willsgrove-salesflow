import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { updateQuotationFollowUpSchema } from "@/lib/quotations/validation";
import { updateQuotationFollowUp } from "@/lib/quotations/edit";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 7 (spec section 7's follow-up tracking). Deliberately a
 * separate endpoint from PATCH /api/quotations/[id] -- see
 * lib/quotations/validation.ts's updateQuotationFollowUpSchema comment
 * and lib/quotations/edit.ts's updateQuotationFollowUp comment for why:
 * follow-up scheduling must remain usable on an ISSUED quotation awaiting
 * a response, which the header-edit endpoint's DRAFT-only guard would
 * otherwise block.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid quotation id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = updateQuotationFollowUpSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid follow-up data.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await updateQuotationFollowUp(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation follow-up update failed:", error);
    return NextResponse.json({ success: false, message: "Unable to update this quotation's follow-up schedule." }, { status: 500 });
  }
}
