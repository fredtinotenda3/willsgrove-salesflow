import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { INVOICE_RESET_ROLES, resetNativeInvoiceSchema } from "@/lib/invoice-recording/validation";
import { resetNativeInvoice } from "@/lib/invoice-recording/reset-native-invoice";

/**
 * POST /api/orders/[id]/record-invoice/[invoiceId]/reset
 *
 * Voids an invoice recorded in SalesFlow so its quantity can be invoiced
 * again. SALES_MANAGER / ADMINISTRATOR only (enforced here, not just by
 * hiding the button), CSRF-checked, reason required, audited. The service
 * refuses when a claim, credit note or delivery outcome depends on the
 * invoice.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; invoiceId: string }> }) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse([...INVOICE_RESET_ROLES]);
  if (!auth.ok) return auth.response;

  const { id, invoiceId } = await params;
  if (!isValidId(id) || !isValidId(invoiceId)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }
  const parsed = resetNativeInvoiceSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "A reason is required to reset an invoice.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await resetNativeInvoice(id, invoiceId, auth.user.id, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true, sapDocNum: result.sapDocNum });
  } catch (error) {
    console.error("Native invoice reset failed:", error);
    return NextResponse.json({ success: false, message: "Unable to reset this invoice." }, { status: 500 });
  }
}
