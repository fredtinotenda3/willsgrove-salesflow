import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { confirmLostSaleSchema } from "@/lib/lost-sales/validation";
import { confirmLostSale } from "@/lib/lost-sales/confirm-lost-sale";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 4 (Lost-Sales Management).
 * POST confirms a genuine lost sale against an UnfulfilledDemand --
 * always a separate, deliberate action (never implied by a cancellation
 * decision alone). Restricted to SALES_MANAGER/ADMINISTRATOR, enforced
 * here at the route -- the same two-tier pattern as
 * app/api/orders/[id]/picking/[sessionId]/authorize/route.ts -- never
 * duplicated into lib/lost-sales/confirm-lost-sale.ts itself.
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

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return NextResponse.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = confirmLostSaleSchema.safeParse(body.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return NextResponse.json({ success: false, message: "Validation failed.", fieldErrors }, { status: 400 });
    }

    const result = await confirmLostSale({ unfulfilledDemandId: id, ...parsed.data }, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }

    return NextResponse.json(
      { success: true, record: result.record, demand: result.demand },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Confirming a lost sale failed:", error);
    return NextResponse.json({ success: false, message: "Unable to confirm this lost sale." }, { status: 500 });
  }
}
