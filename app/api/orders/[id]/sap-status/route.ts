import { NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getOrderIntegrationStatus } from "@/lib/integrations/sap/queries";

type RouteContext = { params: Promise<{ id: string }> };

/** Milestone 9 (SAP Business One Integration). GET /api/orders/[id]/sap-status. Any authenticated role may view it -- only submit/retry/reconcile are role-gated. */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  const status = await getOrderIntegrationStatus(id);
  return NextResponse.json({ success: true, status }, { headers: { "Cache-Control": "no-store" } });
}
