import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { recordClaimReturnSchema } from "@/lib/returns-credits/validation";
import { recordClaimReturn } from "@/lib/returns-credits/returns";
import { listClaimReturns } from "@/lib/returns-credits/queries";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6B (Returns & Credit Notes).
 * GET lists every physical return recorded against this claim. POST
 * records a new one. Confirmed design decision: no dedicated role --
 * open to any authenticated user, same "no dedicated role" convention as
 * 6A's own createInvoiceClaim and recordClaimResolution. Only credit-note
 * recording (app/api/invoice-claims/[id]/credit-notes/route.ts) is
 * SALES_MANAGER/ADMINISTRATOR-gated.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid claim id." }, { status: 400 });
  }

  try {
    const returns = await listClaimReturns(id);
    return NextResponse.json({ success: true, returns }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Listing claim returns failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load returns for this claim." }, { status: 500 });
  }
}

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
    return NextResponse.json({ success: false, message: "Invalid claim id." }, { status: 400 });
  }

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = recordClaimReturnSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid return data.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await recordClaimReturn(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true, id: result.id, returnReference: result.returnReference }, { status: 201 });
  } catch (error) {
    console.error("Recording claim return failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this return." }, { status: 500 });
  }
}
