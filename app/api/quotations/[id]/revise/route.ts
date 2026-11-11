import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { reviseQuotationSchema } from "@/lib/quotations/validation";
import { reviseQuotation } from "@/lib/quotations/revise";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 7 (spec section 6). POST /api/quotations/[id]/revise --
 * creates a brand-new DRAFT revision copied from this quotation and
 * supersedes it. Returns the NEW quotation's id so the UI can navigate
 * straight to it.
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

  const parsed = reviseQuotationSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid revision request.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await reviseQuotation(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json(
      { success: true, id: result.id, quotationNumber: result.quotationNumber, revisionNumber: result.revisionNumber },
      { status: 201 }
    );
  } catch (error) {
    console.error("Quotation revision failed:", error);
    return NextResponse.json({ success: false, message: "Unable to create a revision of this quotation." }, { status: 500 });
  }
}
