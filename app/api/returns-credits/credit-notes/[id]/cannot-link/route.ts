import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { cannotLinkCreditNoteSchema } from "@/lib/returns-credits/validation";
import { markCreditNoteCannotLink } from "@/lib/returns-credits/credit-notes";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6B (Returns & Credit Notes).
 * POST records that a credit note cannot be linked to any claim in
 * SalesFlow. Restricted to SALES_MANAGER/ADMINISTRATOR, same gate as
 * every other manual credit-note reconciliation decision.
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

  const parsed = cannotLinkCreditNoteSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "An explanation is required.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await markCreditNoteCannotLink(id, parsed.data.note, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Marking credit note as unlinkable failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this." }, { status: 500 });
  }
}
