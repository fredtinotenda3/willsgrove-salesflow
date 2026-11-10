import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getSapInvoiceDetail } from "@/lib/invoice-reconciliation/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * GET returns one SAP invoice's full detail -- header, lines, linked
 * order, and per-matched-line authorized/invoiced/remaining figures
 * (spec section 10.C).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  try {
    const invoice = await getSapInvoiceDetail(id);
    if (!invoice) {
      return NextResponse.json({ success: false, message: "SAP invoice not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, invoice }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice reconciliation detail failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this invoice." }, { status: 500 });
  }
}
