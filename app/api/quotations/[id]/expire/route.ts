import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { expireQuotation } from "@/lib/quotations/expiry";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 7 (spec section 5). POST /api/quotations/[id]/expire -- the
 * manual UI counterpart to scripts/expire-quotations.ts's scheduled
 * sweep; both call the exact same lib/quotations/expiry.ts function, so
 * a quotation expired by a human from the detail page and one expired by
 * the scheduled sweep are indistinguishable afterwards. Rejected with
 * 400 by expireQuotation itself if validUntil has not actually passed --
 * this is never a way to force-expire an otherwise-valid quotation.
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

  try {
    const result = await expireQuotation(id, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation expiry failed:", error);
    return NextResponse.json({ success: false, message: "Unable to expire this quotation." }, { status: 500 });
  }
}
