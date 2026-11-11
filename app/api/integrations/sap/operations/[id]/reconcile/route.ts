import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { reconcileUncertainOperation } from "@/lib/integrations/sap/order-outbox";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 9 (SAP Business One Integration). POST /api/integrations/
 * sap/operations/[id]/reconcile -- a read-only "look this up in SAP
 * again" attempt for an UNCERTAIN row (spec section 7.2). ADMINISTRATOR-
 * only: resolving an ambiguous SAP-side outcome is a higher-stakes
 * action than an ordinary retry of a definite failure.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid operation id." }, { status: 400 });
  }

  try {
    const result = await reconcileUncertainOperation(id);
    return NextResponse.json({ success: true, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("SAP uncertain-operation reconciliation failed unexpectedly:", error);
    const message = error instanceof Error ? error.message : "Unable to reconcile this submission.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
