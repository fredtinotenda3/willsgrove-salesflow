import { NextRequest, NextResponse } from "next/server";
import { isValidId, readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { updateUserStatusSchema } from "@/lib/user-validation";
import { revokeSessionsIfDeactivated, updateUserStatus } from "@/lib/users";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/users/[id] -- administrator-only. Currently only toggles
 * status (Active/Inactive), matching the existing Settings > Users & Roles
 * "Activate/Deactivate" action. Re-checked against the database here, not
 * only via proxy.ts.
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const { id } = await context.params;
  if (!isValidId(id)) {
    return NextResponse.json({ success: false, message: "Invalid user id." }, { status: 400 });
  }

  try {
    const body = await readJsonObject(request);
    if (!body.ok) {
      return NextResponse.json({ success: false, message: body.message }, { status: 400 });
    }

    const parsed = updateUserStatusSchema.safeParse(body.body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request." },
        { status: 400 }
      );
    }

    const result = await updateUserStatus(id, parsed.data.status, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }

    if (result.changed) {
      await revokeSessionsIfDeactivated(id, parsed.data.status);
    }

    return NextResponse.json(
      { success: true, changed: result.changed },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("User status update failed:", error);
    return NextResponse.json({ success: false, message: "Unable to update the user." }, { status: 500 });
  }
}
