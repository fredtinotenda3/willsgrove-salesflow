import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { updateQuotationLineSchema } from "@/lib/quotations/validation";
import { updateQuotationLine, removeQuotationLine } from "@/lib/quotations/edit";

type RouteContext = { params: Promise<{ id: string; lineId: string }> };

/**
 * Milestone 7. PATCH replaces one DRAFT quotation line's full content;
 * DELETE removes it. Both hard-blocked by lib/quotations/edit.ts's own
 * DRAFT-only guard, re-checked on every call (not cached from a prior
 * request), so a quotation issued between page-load and submit is
 * rejected with 409, not silently accepted.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id, lineId } = await context.params;
  if (!isValidId(id) || !isValidId(lineId)) {
    return NextResponse.json({ success: false, message: "Invalid quotation or line id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = updateQuotationLineSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid quotation line data.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await updateQuotationLine(id, lineId, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation line update failed:", error);
    return NextResponse.json({ success: false, message: "Unable to update this line." }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id, lineId } = await context.params;
  if (!isValidId(id) || !isValidId(lineId)) {
    return NextResponse.json({ success: false, message: "Invalid quotation or line id." }, { status: 400 });
  }

  try {
    const result = await removeQuotationLine(id, lineId, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation line removal failed:", error);
    return NextResponse.json({ success: false, message: "Unable to remove this line." }, { status: 500 });
  }
}
