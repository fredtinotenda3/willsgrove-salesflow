import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getQuotationRevisionHistory } from "@/lib/quotations/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 7 (spec section 6). GET /api/quotations/[id]/revisions --
 * every revision of this quotation's lineage, oldest first, however the
 * given id relates to the lineage (root or any later revision).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid quotation id." }, { status: 400 });
  }

  try {
    const revisions = await getQuotationRevisionHistory(id);
    if (!revisions) {
      return NextResponse.json({ success: false, message: "Quotation not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, revisions }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation revision history failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this quotation's revision history." }, { status: 500 });
  }
}
