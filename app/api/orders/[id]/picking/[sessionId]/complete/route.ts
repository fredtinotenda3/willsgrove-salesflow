import { NextRequest } from "next/server";
import { isValidId, MAX_JSON_BODY_CHARS } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { completePickingSession } from "@/lib/picking/complete-picking";
import { completePickingRequestSchema } from "@/lib/picking/validation";

type RouteContext = { params: Promise<{ sessionId: string }> };

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 * POST marks a picking session COMPLETED once every line fully accounts
 * for its requested quantity. Any authenticated user may complete a
 * session -- per the user's confirmed design, only the SEPARATE
 * authorize step (below) is role-restricted.
 *
 * Final Operational Enhancements (spec Part 2.1): the request body is now
 * optional and, when present, may carry a `lineEdits` array of
 * not-yet-individually-saved line edits to save atomically together with
 * completion (see lib/picking/complete-picking.ts's own comment). A
 * request with NO body (or an empty one) behaves exactly as before this
 * change -- only already-persisted line values are checked -- so every
 * pre-existing caller of this route keeps working unchanged.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return Response.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { sessionId } = await context.params;
  if (!isValidId(sessionId)) {
    return Response.json({ success: false, message: "Invalid session id." }, { status: 400 });
  }

  // Body is optional (backward compatible with every pre-existing caller
  // that sends none) -- read the raw text once (a Request body can only
  // be consumed once) and only attempt to parse/validate it as JSON when
  // something was actually sent.
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return Response.json({ success: false, message: "Unable to read the request body." }, { status: 400 });
  }
  if (rawBody.length > MAX_JSON_BODY_CHARS) {
    return Response.json({ success: false, message: "Request body is too large." }, { status: 400 });
  }

  let lineEdits: { orderLineId: string; foundQuantity: string; unavailableQuantity: string; notes?: string }[] = [];
  if (rawBody.trim().length > 0) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawBody);
    } catch {
      return Response.json({ success: false, message: "Request body must be valid JSON." }, { status: 400 });
    }
    if (parsedJson === null || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
      return Response.json({ success: false, message: "Request body must be a JSON object." }, { status: 400 });
    }
    const parsed = completePickingRequestSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return Response.json({ success: false, message: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    }
    lineEdits = parsed.data.lineEdits ?? [];
  }

  try {
    const result = await completePickingSession(sessionId, user.id, lineEdits);
    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }
    return Response.json({ success: true, session: result.session }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Completing a picking session failed:", error);
    return Response.json({ success: false, message: "Unable to complete this picking session." }, { status: 500 });
  }
}
