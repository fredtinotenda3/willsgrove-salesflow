import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { resolveUncertainOperation } from "@/lib/integrations/sap/order-outbox";
import { resolveUncertainOperationSchema } from "@/lib/integrations/sap/validation";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 9 (SAP Business One Integration). POST /api/integrations/
 * sap/operations/[id]/resolve -- an ADMINISTRATOR's own authorised
 * decision on an UNCERTAIN row that reconciliation alone could not
 * settle (spec section 7.2: "requires an authorised human decision,
 * never an automatic resubmission"). ADMINISTRATOR-only, same reasoning
 * as the reconcile route.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid operation id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = resolveUncertainOperationSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid request body.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    await resolveUncertainOperation(id, user.id, parsed.data);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("SAP uncertain-operation resolution failed unexpectedly:", error);
    const message = error instanceof Error ? error.message : "Unable to resolve this submission.";
    return NextResponse.json({ success: false, message }, { status: 400 });
  }
}
