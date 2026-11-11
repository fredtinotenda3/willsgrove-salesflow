import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getCreditNoteDetail } from "@/lib/returns-credits/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6B (Returns & Credit Notes).
 * GET returns one credit note's full detail, for the reconciliation
 * queue's detail/match panel.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  try {
    const creditNote = await getCreditNoteDetail(id);
    if (!creditNote) {
      return NextResponse.json({ success: false, message: "Credit note not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, creditNote }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Credit note detail lookup failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this credit note." }, { status: 500 });
  }
}
