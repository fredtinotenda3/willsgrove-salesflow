import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listSapInvoices, parseSapInvoiceListQuery } from "@/lib/invoice-reconciliation/queries";

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * GET lists SAP invoices -- the reconciliation queue (spec section
 * 10.B). Any authenticated user may view it, same convention as the
 * lost-sales and picking list endpoints.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  try {
    const parsed = parseSapInvoiceListQuery(request.nextUrl.searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
    }

    const result = await listSapInvoices(parsed.query);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice reconciliation list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load SAP invoices." }, { status: 500 });
  }
}
