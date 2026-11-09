import { isValidId } from "@/lib/http";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { getPoIntakeDocumentDetail } from "@/lib/po-intake-queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/po-intake/[id] -- one document's intake/extraction detail,
 * read-only. The review/edit workflow (changing lines, matching
 * products) is Milestone 2B.
 */
export async function GET(_request: Request, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return Response.json({ success: false, message: "Invalid document id." }, { status: 400 });
  }

  try {
    const document = await getPoIntakeDocumentDetail(id);
    if (!document) {
      return Response.json({ success: false, message: "Document not found." }, { status: 404 });
    }
    return Response.json({ success: true, document }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("PO intake detail failed:", error);
    return Response.json({ success: false, message: "Unable to load this document." }, { status: 500 });
  }
}
