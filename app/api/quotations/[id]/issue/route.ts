import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { issueQuotation } from "@/lib/quotations/issue";
import { queueQuotationIssuedMessage } from "@/lib/communications/send";

type RouteContext = { params: Promise<{ id: string }> };

/** Milestone 7. POST /api/quotations/[id]/issue -- DRAFT -> ISSUED. No request body. */
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

  try {
    const result = await issueQuotation(id, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, approvalRequestId: result.approvalRequestId }, { status: result.status });
    }

    // Milestone 10. Queuing/sending the customer notification never affects
    // this response -- a channel/provider failure here is recorded on its
    // own OutboundMessage row (visible, resendable from Communications),
    // never surfaced as a failure of the issue action itself.
    try {
      await queueQuotationIssuedMessage(id, user.id);
    } catch (notifyError) {
      console.error(`Failed to queue quotation-issued message for quotation ${id}:`, notifyError);
    }

    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Quotation issue failed:", error);
    return NextResponse.json({ success: false, message: "Unable to issue this quotation." }, { status: 500 });
  }
}
