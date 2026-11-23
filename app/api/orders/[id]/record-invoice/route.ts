import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getInvoiceRecordingEligibility } from "@/lib/invoice-recording/queries";
import { recordNativeInvoiceSchema } from "@/lib/invoice-recording/validation";
import { recordNativeInvoice } from "@/lib/invoice-recording/record-native-invoice";

/**
 * Real-world fix (native invoice recording) -- see lib/invoice-recording/
 * validation.ts's own comment for the full design.
 *
 * GET  /api/orders/[id]/record-invoice -- what's left to invoice on this
 * order right now (dispatched lines not yet fully invoiced), for the
 * order detail page's "Record Invoice" panel to render.
 * POST /api/orders/[id]/record-invoice -- record the invoice. Any
 * authenticated user, same role-agnostic precedent this project already
 * follows for recording a delivery outcome (lib/invoice-delivery/
 * record-outcome.ts's own comment) and for filing an invoice claim.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  try {
    const eligibility = await getInvoiceRecordingEligibility(id);
    if (!eligibility) {
      return NextResponse.json({ success: false, message: "Order not found." }, { status: 404 });
    }
    return NextResponse.json({ success: true, eligibility }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice-recording eligibility lookup failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load invoicing status for this order." }, { status: 500 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid order id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = recordNativeInvoiceSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid invoice data.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await recordNativeInvoice(id, user.id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true, id: result.id, sapDocNum: result.sapDocNum }, { status: 201 });
  } catch (error) {
    console.error("Native invoice recording failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this invoice." }, { status: 500 });
  }
}
