import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { listClaimsForInvoice } from "@/lib/returns-credits/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6B (Returns & Credit Notes).
 * GET returns every claim raised against this credit note's resolved
 * base invoice, for the manual-match picker -- mirrors app/api/invoice-
 * reconciliation/[id]/candidate-orders/route.ts's own role.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  try {
    const creditNote = await prisma.creditNote.findUnique({ where: { id }, select: { sapInvoiceId: true } });
    if (!creditNote) {
      return NextResponse.json({ success: false, message: "Credit note not found." }, { status: 404 });
    }
    if (!creditNote.sapInvoiceId) {
      return NextResponse.json(
        { success: true, candidateClaims: [], message: "This credit note has no resolved base invoice to match against." },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const candidateClaims = await listClaimsForInvoice(creditNote.sapInvoiceId);
    return NextResponse.json({ success: true, candidateClaims }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Candidate-claim lookup failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load candidate claims." }, { status: 500 });
  }
}
