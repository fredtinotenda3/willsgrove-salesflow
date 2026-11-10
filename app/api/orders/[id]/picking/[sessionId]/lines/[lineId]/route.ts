import { NextRequest } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { recordPickedLineSchema } from "@/lib/picking/validation";
import { recordPickedLine } from "@/lib/picking/record-picked-line";

type RouteContext = { params: Promise<{ id: string; sessionId: string; lineId: string }> };

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 * PATCH records (or re-records) one order line's found/unavailable split
 * within an IN_PROGRESS picking session. `lineId` here is the OrderLine's
 * id, not the PickingLine's -- the natural key the picking UI already
 * has on hand (it's iterating the order's own lines), matching how
 * lib/picking/record-picked-line.ts looks the PickingLine up by
 * (pickingSessionId, orderLineId).
 *
 * `[id]` (the order id) is part of the path for consistency with every
 * other nested order route, but is not itself re-validated against the
 * session beyond existing as a syntactically valid id -- the session id
 * is what actually scopes the mutation.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { sessionId, lineId } = await context.params;
  if (!isValidId(sessionId) || !isValidId(lineId)) {
    return Response.json({ success: false, message: "Invalid session or line id." }, { status: 400 });
  }

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return Response.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = recordPickedLineSchema.safeParse(body.body);
    if (!parsed.success) {
      return Response.json(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request body." },
        { status: 400 }
      );
    }

    const result = await recordPickedLine(
      sessionId,
      lineId,
      parsed.data.foundQuantity,
      parsed.data.unavailableQuantity,
      parsed.data.notes,
      user.id
    );
    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }

    return Response.json({ success: true, line: result.line }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Recording a picked line failed:", error);
    return Response.json({ success: false, message: "Unable to record this line." }, { status: 500 });
  }
}
