import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { recordDecisionSchema } from "@/lib/lost-sales/validation";
import { recordCustomerDecision } from "@/lib/lost-sales/record-decision";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * Milestone 4 (Lost-Sales Management).
 * POST records one customer decision against an UnfulfilledDemand. No
 * dedicated role -- any authenticated user may record a decision, the
 * same "no dedicated role" convention as picking (see
 * lib/picking/start-picking.ts's own comment). Enforced here, at the
 * route, exactly like every other role/no-role boundary in this project.
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
    return NextResponse.json({ success: false, message: "Invalid id." }, { status: 400 });
  }

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return NextResponse.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = recordDecisionSchema.safeParse(body.body);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join(".") || "form";
        if (!fieldErrors[key]) fieldErrors[key] = issue.message;
      }
      return NextResponse.json({ success: false, message: "Validation failed.", fieldErrors }, { status: 400 });
    }

    const result = await recordCustomerDecision({ unfulfilledDemandId: id, ...parsed.data }, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }

    return NextResponse.json(
      { success: true, event: result.event, demand: result.demand },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Recording a customer decision failed:", error);
    return NextResponse.json({ success: false, message: "Unable to record this decision." }, { status: 500 });
  }
}
