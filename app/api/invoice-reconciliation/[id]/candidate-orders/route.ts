import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { prisma } from "@/lib/prisma";
import { getCandidateOrderLinesForCustomer } from "@/lib/invoice-reconciliation/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * GET returns every outstanding authorized order line for this invoice's
 * resolved customer, with its live authorized/invoiced/remaining
 * position -- feeds the manual-match picker (spec section 7: "inspect
 * matching orders, inspect authorized handover lines").
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  try {
    const invoice = await prisma.sapInvoice.findUnique({ where: { id }, select: { matchedCustomerId: true } });
    if (!invoice) {
      return NextResponse.json({ success: false, message: "SAP invoice not found." }, { status: 404 });
    }
    if (!invoice.matchedCustomerId) {
      return NextResponse.json(
        { success: true, candidateOrderLines: [], message: "This invoice has no resolved SalesFlow customer to match against." },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const candidateOrderLines = await getCandidateOrderLinesForCustomer(invoice.matchedCustomerId);
    return NextResponse.json({ success: true, candidateOrderLines }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Candidate-order lookup failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load candidate orders." }, { status: 500 });
  }
}
