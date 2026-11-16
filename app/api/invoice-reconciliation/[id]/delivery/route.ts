import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { recordInvoiceDeliveryOutcomeSchema } from "@/lib/invoice-delivery/validation";
import { recordInvoiceDeliveryOutcome } from "@/lib/invoice-delivery/record-outcome";
import { getInvoiceDeliveryRecord } from "@/lib/invoice-delivery/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Final Operational Enhancements (spec Part 5).
 *
 * GET /api/invoice-reconciliation/[id]/delivery -- the recorded delivery
 * outcome for this SAP invoice (id here is the SapInvoice id, same [id]
 * param every other nested route under /api/invoice-reconciliation/[id]/
 * already uses), or null if none has been recorded yet.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid invoice id." }, { status: 400 });
  }

  try {
    const delivery = await getInvoiceDeliveryRecord(id);
    return NextResponse.json({ success: true, delivery }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Loading invoice delivery record failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load this invoice's delivery outcome." }, { status: 500 });
  }
}

/**
 * POST /api/invoice-reconciliation/[id]/delivery -- records the delivery
 * outcome ("No Claim" or "With Claim", optionally creating one-or-more
 * linked InvoiceClaim records in the same transaction). Any authenticated
 * user may record it -- same role-agnostic precedent as recording a
 * dispatch's delivery (lib/fulfilment/delivery.ts) and filing an invoice
 * claim (lib/invoice-claims/create-claim.ts) -- this is an operational
 * record of what happened, not an approval decision.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid invoice id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = recordInvoiceDeliveryOutcomeSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid delivery outcome request.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await recordInvoiceDeliveryOutcome(id, user.id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true, id: result.id, claimIds: result.claimIds }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Recording invoice delivery outcome failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this delivery outcome." }, { status: 500 });
  }
}
