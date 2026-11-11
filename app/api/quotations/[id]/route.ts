import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { updateQuotationHeaderSchema } from "@/lib/quotations/validation";
import { updateQuotationHeader } from "@/lib/quotations/edit";
import { getQuotationById } from "@/lib/quotations/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 7.
 *
 * GET   /api/quotations/[id] -- full detail: header, lines, revision
 * links, response/cancel/convert facts, and the event-history timeline
 * (spec section 7's "detail page displaying the full history of a
 * quotation") in one payload.
 *
 * PATCH /api/quotations/[id] -- edit the DRAFT header. Rejected with 409
 * by lib/quotations/edit.ts's own guard the instant status leaves DRAFT
 * -- never re-checked here, so there is exactly one place in the codebase
 * that decides whether a quotation is still editable.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid quotation id." }, { status: 400 });
  }

  try {
    const quotation = await getQuotationById(id);
    if (!quotation) {
      return NextResponse.json({ success: false, message: "Quotation not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, quotation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation detail failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this quotation." }, { status: 500 });
  }
}

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

  const parsed = updateQuotationHeaderSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid quotation header data.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await updateQuotationHeader(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation header update failed:", error);
    return NextResponse.json({ success: false, message: "Unable to update this quotation." }, { status: 500 });
  }
}
