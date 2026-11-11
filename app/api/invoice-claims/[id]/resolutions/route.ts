import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { recordClaimResolutionSchema } from "@/lib/invoice-claims/validation";
import { recordClaimResolution } from "@/lib/invoice-claims/claim-resolution";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 6A. POST records a new investigation finding / resolution
 * recommendation against a claim (always moves the claim to
 * AWAITING_INTERNAL_ACTION -- never an approval by itself). Open to any
 * authenticated user, per the confirmed authorization split: anyone may
 * investigate and recommend; only a manager may approve
 * ([resolutionId]/approve, below).
 */
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

  const parsed = recordClaimResolutionSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid resolution data.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }

  try {
    const result = await recordClaimResolution(id, parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true, id: result.id, claimStatus: result.claimStatus }, { status: 201 });
  } catch (error) {
    console.error("Invoice claim resolution recording failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this resolution." }, { status: 500 });
  }
}
