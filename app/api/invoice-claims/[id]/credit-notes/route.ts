import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { recordCreditNoteManualSchema } from "@/lib/returns-credits/validation";
import { recordCreditNoteManually } from "@/lib/returns-credits/credit-notes";
import { listCreditNotesForClaim } from "@/lib/returns-credits/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6B (Returns & Credit Notes).
 * GET lists every credit note recorded/matched against this claim --
 * open to any authenticated user, same as reading the claim itself. POST
 * records that SAP has actually issued a credit note against this claim
 * (manual single-record entry path -- the CSV import pipeline is
 * app/api/returns-credits/import/{preview,confirm}). Confirmed design
 * decision: restricted to SALES_MANAGER/ADMINISTRATOR -- this asserts a
 * completed financial fact, the same approval-weight tier as approving a
 * ClaimResolution (6A's .../resolutions/[resolutionId]/approve).
 *
 * The claim id always comes from the URL, never from the request body --
 * any claimId the caller sent in the JSON body is overwritten with the
 * path parameter before validation, so this route can never be used to
 * record a credit note against a DIFFERENT claim than the one its own
 * URL names.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid claim id." }, { status: 400 });
  }

  try {
    const creditNotes = await listCreditNotesForClaim(id);
    return NextResponse.json({ success: true, creditNotes }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Listing credit notes for claim failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load credit notes for this claim." }, { status: 500 });
  }
}

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
    return NextResponse.json({ success: false, message: "Invalid claim id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = recordCreditNoteManualSchema.safeParse({ ...body.body, claimId: id });
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid credit note data.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await recordCreditNoteManually(parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true, id: result.id }, { status: 201 });
  } catch (error) {
    console.error("Recording credit note failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this credit note." }, { status: 500 });
  }
}
