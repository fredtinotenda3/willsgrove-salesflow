import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { addQuotationLineSchema } from "@/lib/quotations/validation";
import { addQuotationLine } from "@/lib/quotations/edit";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 7. POST /api/quotations/[id]/lines -- add one line to a DRAFT
 * quotation. Listing lines is not its own endpoint -- they are already
 * part of GET /api/quotations/[id]'s payload, same as every other
 * header+lines document in this project (CustomerOrder, InvoiceClaim).
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
    return NextResponse.json({ success: false, message: "Invalid quotation id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = addQuotationLineSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid quotation line data.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await addQuotationLine(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true, lineId: result.lineId }, { status: 201 });
  } catch (error) {
    console.error("Quotation line add failed:", error);
    return NextResponse.json({ success: false, message: "Unable to add this line." }, { status: 500 });
  }
}
