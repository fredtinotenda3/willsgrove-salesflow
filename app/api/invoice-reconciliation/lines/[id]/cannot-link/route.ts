import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { markInvoiceLineCannotLink } from "@/lib/invoice-reconciliation/manual-actions";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * POST records that an invoice line has nothing to do with SalesFlow
 * (spec section 7: "identify invoices that cannot be linked to
 * SalesFlow"). Restricted to SALES_MANAGER/ADMINISTRATOR, same gate as
 * every other manual reconciliation decision.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const note = body.body.note;
  if (typeof note !== "string" || note.trim() === "") {
    return NextResponse.json({ success: false, message: "An explanation is required." }, { status: 400 });
  }

  try {
    const result = await markInvoiceLineCannotLink(id, user.id, note);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Marking invoice line as unlinkable failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this." }, { status: 500 });
  }
}
