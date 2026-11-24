import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireManagementReportAccess } from "@/lib/reporting/access";
import { managementActionRequestSchema } from "@/lib/management-intelligence/action-state";
import { listAssignableUsers, listTrackedActions, performManagementAction } from "@/lib/management-intelligence/actions";

/**
 * Management Action Centre API. Management-only (SALES_MANAGER and
 * ADMINISTRATOR), enforced here on the server; hiding the page from a
 * salesperson is only a convenience on top of this.
 *
 * GET  -> the tracked actions and the users an action can be assigned to.
 * POST -> one operation (acknowledge, assign, start, complete, dismiss,
 *         reopen). Same CSRF -> role -> body -> zod template as the other
 *         mutation routes. The finding itself is recomputed on the server.
 */
export async function GET() {
  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;
  try {
    const [actions, assignees] = await Promise.all([listTrackedActions(), listAssignableUsers()]);
    return NextResponse.json({ success: true, actions, assignees }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Management actions list failed:", error);
    return NextResponse.json({ success: false, message: "Unable to load management actions." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });

  const auth = await requireManagementReportAccess();
  if (!auth.ok) return auth.response;

  const body = await readJsonObject(request);
  if (!body.ok) return NextResponse.json({ success: false, message: body.message }, { status: 400 });

  const parsed = managementActionRequestSchema.safeParse(body.body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, message: "Invalid request body.", fieldErrors: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  if (parsed.data.assigneeId !== undefined && !isValidId(parsed.data.assigneeId)) {
    return NextResponse.json({ success: false, message: "Invalid assignee." }, { status: 400 });
  }

  try {
    const result = await performManagementAction(parsed.data, auth.user.id);
    if (!result.ok) return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    return NextResponse.json({ success: true, action: result.action }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Management action failed:", error);
    return NextResponse.json({ success: false, message: "Unable to update this action." }, { status: 500 });
  }
}
