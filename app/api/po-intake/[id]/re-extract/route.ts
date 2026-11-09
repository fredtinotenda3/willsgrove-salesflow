import { NextRequest } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { reExtractPoDocument } from "@/lib/po-intake";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/po-intake/[id]/re-extract -- re-runs extraction against the
 * document's ORIGINAL stored bytes (e.g. after a provider failure).
 * Append-only: creates a new ExtractionRun row rather than overwriting
 * the previous attempt, so the original output stays preserved.
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

  const body: unknown = await request.json().catch(() => ({}));
  const mockFixtureKey =
    body !== null && typeof body === "object" && typeof (body as Record<string, unknown>).mockFixtureKey === "string"
      ? ((body as Record<string, unknown>).mockFixtureKey as string)
      : undefined;

  try {
    const result = await reExtractPoDocument(id, user.id, { mockFixtureKey });
    if (!result.ok) {
      return Response.json({ success: false, message: result.message }, { status: result.status });
    }
    return Response.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("PO re-extraction failed:", error);
    return Response.json({ success: false, message: "Unable to re-run extraction for this document." }, { status: 500 });
  }
}
