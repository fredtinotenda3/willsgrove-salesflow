import { NextRequest, NextResponse } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { markAllNotificationsRead } from "@/lib/notifications/mark-read";

/** Milestone 8. POST /api/notifications/mark-all-read -- marks all of the current user's own unread notifications read. */
export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  try {
    await markAllNotificationsRead(user.id);
    return NextResponse.json({ success: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to mark all notifications read:", error);
    return NextResponse.json({ success: false, message: "Unable to update notifications." }, { status: 500 });
  }
}
