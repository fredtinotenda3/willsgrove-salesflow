import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { createInvoiceClaimSchema } from "@/lib/invoice-claims/validation";
import { createInvoiceClaim } from "@/lib/invoice-claims/create-claim";
import { listInvoiceClaims, clampPageSize } from "@/lib/invoice-claims/queries";

/**
 * Milestone 6A (Invoice Claims Management).
 *
 * GET  /api/invoice-claims -- list with filters + pagination.
 * POST /api/invoice-claims -- create a claim. Open to any authenticated
 * user (confirmed authorization split -- see docs/milestones/PROGRESS.md's
 * Milestone 6A section): any authenticated user may file a claim.
 */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const category = url.searchParams.get("category") ?? undefined;
  const priority = url.searchParams.get("priority") ?? undefined;
  const customerId = url.searchParams.get("customerId") ?? undefined;
  const sapInvoiceId = url.searchParams.get("sapInvoiceId") ?? undefined;
  const assignedToId = url.searchParams.get("assignedToId") ?? undefined;
  const search = url.searchParams.get("search") ?? undefined;
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = clampPageSize(Number(url.searchParams.get("pageSize") ?? ""));

  for (const [label, value] of [
    ["customerId", customerId],
    ["sapInvoiceId", sapInvoiceId],
    ["assignedToId", assignedToId],
  ] as const) {
    if (value && !isValidId(value)) {
      return NextResponse.json({ success: false, message: `Invalid ${label}.` }, { status: 400 });
    }
  }

  try {
    const result = await listInvoiceClaims({ status, category, priority, customerId, sapInvoiceId, assignedToId, search }, page, pageSize);
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Invoice claim list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load claims." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const body = await readJsonObject(request);
  if (!body.ok) {
    return NextResponse.json({ success: false, message: body.message }, { status: 400 });
  }

  const parsed = createInvoiceClaimSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, message: "Invalid claim data.", fieldErrors: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }

  try {
    const result = await createInvoiceClaim(parsed.data, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message, fieldErrors: result.fieldErrors }, { status: result.status });
    }
    return NextResponse.json({ success: true, id: result.id, claimReference: result.claimReference }, { status: 201 });
  } catch (error) {
    console.error("Invoice claim creation failed:", error);
    return NextResponse.json({ success: false, message: "Unable to create this claim." }, { status: 500 });
  }
}
