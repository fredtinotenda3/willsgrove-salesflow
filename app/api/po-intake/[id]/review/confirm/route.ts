import { NextRequest } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { confirmReviewSchema } from "@/lib/review/confirm-review-validation";
import { confirmReviewSession } from "@/lib/review/confirm-review";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 2B. POST /api/po-intake/[id]/review/confirm -- the one
 * action that turns a reviewed PO intake document into a real
 * CustomerOrder. Requires every materialized ExtractedOrderLine for the
 * document's latest successful extraction to have an explicit
 * accept/exclude decision (see lib/review/confirm-review.ts), and
 * requires acknowledgeDuplicate: true when the server's own duplicate
 * check (recomputed fresh here, never trusted from an earlier GET) finds
 * a likely duplicate.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return Response.json({ success: false, message: "Invalid document id." }, { status: 400 });
  }

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return Response.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = confirmReviewSchema.safeParse(body.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return Response.json({ success: false, message: "Validation failed.", fieldErrors }, { status: 400 });
    }

    const result = await confirmReviewSession(id, user.id, parsed.data);
    if (!result.ok) {
      return Response.json(
        { success: false, message: result.message, fieldErrors: result.fieldErrors, duplicateWarnings: result.duplicateWarnings },
        { status: result.status }
      );
    }

    return Response.json(
      {
        success: true,
        orderId: result.orderId,
        orderReference: result.orderReference,
        acceptedLineCount: result.acceptedLineCount,
        excludedLineCount: result.excludedLineCount,
        // Milestone 2C: multi-store splitting. Always at least one entry
        // (orderId/orderReference above are simply its id/reference for
        // the overwhelmingly common single-store case); more than one
        // only when the request's line decisions split the document
        // across several stores.
        orders: result.orders,
      },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Review confirm failed:", error);
    return Response.json({ success: false, message: "Unable to confirm this document into an order." }, { status: 500 });
  }
}
