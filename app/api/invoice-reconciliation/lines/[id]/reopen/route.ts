import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { reopenInvoiceLineMatch } from "@/lib/invoice-reconciliation/manual-actions";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 * POST reopens a resolved invoice line back to UNMATCHED -- the undo
 * step before recording a corrected decision. Restricted to
 * SALES_MANAGER/ADMINISTRATOR, same gate as the decision it reverses.
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

  const reason = body.body.reason;
  if (typeof reason !== "string" || reason.trim() === "") {
    return NextResponse.json({ success: false, message: "A reason is required to reopen a resolved line." }, { status: 400 });
  }

  try {
    const result = await reopenInvoiceLineMatch(id, user.id, reason);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Reopening invoice line match failed:", error);
    return NextResponse.json({ success: false, message: "Unable to reopen this line." }, { status: 500 });
  }
}
