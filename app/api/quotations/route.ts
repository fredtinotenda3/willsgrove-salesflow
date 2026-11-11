import { NextRequest, NextResponse } from "next/server";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { createQuotationSchema } from "@/lib/quotations/validation";
import { createQuotation } from "@/lib/quotations/create";
import { parseQuotationListQuery, listQuotations } from "@/lib/quotations/queries";

/**
 * Milestone 7 (Quotations Management).
 *
 * GET  /api/quotations -- list with filters + pagination (spec section
 * 10: "search by quotation number, customer, salesperson, status, date
 * range, currency"). All parsing/validation of query params lives in
 * lib/quotations/queries.ts's parseQuotationListQuery, so this handler
 * does nothing but hand it the request's own searchParams and report a
 * 400 on its own validation message -- same split invoice-claims' own
 * list route does not use (that one parses inline) but returns-credits'
 * import routes do, since quotations has enough filters to earn its own
 * dedicated parser.
 *
 * POST /api/quotations -- create a quotation. Open to any authenticated
 * user, no role gate -- same "no dedicated role for a purely
 * price-proposing document" decision already recorded in
 * docs/milestones/PROGRESS.md's Milestone 7 section (confirmed via
 * app/api/orders/route.ts's own POST having no role array either).
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const parsed = parseQuotationListQuery(url.searchParams);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  try {
    const result = await listQuotations(parsed.query);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load quotations." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = createQuotationSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid quotation data.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await createQuotation(parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true, id: result.id, quotationNumber: result.quotationNumber }, { status: 201 });
  } catch (error) {
    console.error("Quotation creation failed:", error);
    return NextResponse.json({ success: false, message: "Unable to create this quotation." }, { status: 500 });
  }
}
