import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { manuallyMatchCreditNoteSchema } from "@/lib/returns-credits/validation";
import { manuallyMatchCreditNote } from "@/lib/returns-credits/credit-notes";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6B (Returns & Credit Notes).
 * POST manually links an UNMATCHED/CANNOT_LINK credit note to a specific
 * claim -- the resolution path for a credit note the automatic matcher
 * left UNMATCHED. Restricted to SALES_MANAGER/ADMINISTRATOR, same
 * approval-weight gate as every other credit-note-recording action, and
 * the same override-the-conservative-automatic-matcher gate Milestone
 * 5's own manual-match route uses.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["SALES_MANAGER", "ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = manuallyMatchCreditNoteSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid match data.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await manuallyMatchCreditNote(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Manual credit-note match failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this manual match." }, { status: 500 });
  }
}
