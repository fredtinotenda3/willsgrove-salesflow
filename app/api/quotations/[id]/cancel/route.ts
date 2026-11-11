import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { cancelQuotationSchema } from "@/lib/quotations/validation";
import { cancelQuotation } from "@/lib/quotations/cancel";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 7. POST /api/quotations/[id]/cancel. Blocked with 409 by
 * lib/quotations/cancel.ts when the quotation has already been converted
 * into a CustomerOrder (spec section 8) -- not re-checked here.
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

  const parsed = cancelQuotationSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "A cancellation reason is required.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await cancelQuotation(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation cancellation failed:", error);
    return NextResponse.json({ success: false, message: "Unable to cancel this quotation." }, { status: 500 });
  }
}
