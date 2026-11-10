import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { setInvoiceReconciliationNote } from "@/lib/invoice-reconciliation/manual-actions";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * POST records (or clears) an invoice-level reconciliation explanation
 * (spec section 7). Restricted to SALES_MANAGER/ADMINISTRATOR -- same
 * gate as every other manual reconciliation decision in this module,
 * since a note is part of resolving an exception, not a read action.
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
  if (note !== null && typeof note !== "string") {
    return NextResponse.json({ success: false, message: "note must be a string or null." }, { status: 400 });
  }

  try {
    const result = await setInvoiceReconciliationNote(id, user.id, note);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Setting invoice reconciliation note failed:", error);
    return NextResponse.json({ success: false, message: "Unable to save this note." }, { status: 500 });
  }
}
