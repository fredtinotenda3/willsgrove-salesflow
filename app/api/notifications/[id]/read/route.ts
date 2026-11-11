import { NextRequest, NextResponse } from "next/server";
import { isValidId } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { markNotificationRead } from "@/lib/notifications/mark-read";

type RouteContext = { params: Promise<{ id: string }> };

/** Milestone 8. POST /api/notifications/[id]/read -- marks one of the current user's own notifications read; ownership is enforced inside markNotificationRead. */
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
    return NextResponse.json({ success: false, message: "Invalid notification id." }, { status: 400 });
  }

  try {
    const result = await markNotificationRead(id, user.id);
    if (!result.ok) {
      return NextResponse.json({ success: false, message: result.message }, { status: result.status });
    }
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to mark notification read:", error);
    return NextResponse.json({ success: false, message: "Unable to update this notification." }, { status: 500 });
  }
}
