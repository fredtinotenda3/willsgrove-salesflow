import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { convertQuotationToOrderSchema } from "@/lib/quotations/validation";
import { convertQuotationToOrder } from "@/lib/quotations/convert-to-order";
import { queueOrderConfirmationMessage } from "@/lib/communications/send";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 7 (spec section 8). POST /api/quotations/[id]/convert-to-order
 * -- converts an ACCEPTED quotation into a real CustomerOrder. Every
 * field is optional (the schema allows a bare `{}` body), but the client
 * must still send a JSON object (even an empty one) -- never omit the
 * request body entirely, since readJsonObject requires parseable JSON.
 * Duplicate-conversion protection (the actual guarantee) lives entirely
 * in lib/quotations/convert-to-order.ts; `alreadyConverted: true` in a
 * 200 response means a second click safely returned the SAME order
 * rather than creating a new one, not that anything failed.
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
    return NextResponse.json({ success: false, message: "Invalid quotation id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = convertQuotationToOrderSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid conversion request.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await convertQuotationToOrder(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }

    // Milestone 10. See the issue route's identical comment. Skipped on a
    // repeat/idempotent conversion (alreadyConverted) -- the confirmation
    // for the real, original conversion was already queued/sent then, and
    // queueOrderConfirmationMessage's own idempotencyKey would no-op a
    // second call anyway, so this is purely to avoid redundant work.
    if (!result.alreadyConverted) {
      try {
        await queueOrderConfirmationMessage(result.orderId, user.id);
      } catch (notifyError) {
        console.error(`Failed to queue order-confirmation message for order ${result.orderId}:`, notifyError);
      }
    }

    return NextResponse.json(
      { success: true, orderId: result.orderId, orderReference: result.orderReference, alreadyConverted: result.alreadyConverted },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Quotation-to-order conversion failed:", error);
    return NextResponse.json({ success: false, message: "Unable to convert this quotation into an order." }, { status: 500 });
  }
}
