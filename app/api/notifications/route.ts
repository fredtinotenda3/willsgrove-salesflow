import { NextRequest, NextResponse } from "next/server";
import { requireUserOrResponse } from "@/lib/auth/current-user";
import { listNotificationsForUser, getUnreadNotificationCount } from "@/lib/notifications/queries";

/** Milestone 8. GET /api/notifications -- always scoped to the current user's own notifications. No role restriction: every role gets their own feed. */
export async function GET(request: NextRequest) {
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const unreadOnly = request.nextUrl.searchParams.get("unreadOnly") === "true";
  const takeParam = request.nextUrl.searchParams.get("take");
  const take = takeParam ? Math.min(Math.max(Number.parseInt(takeParam, 10) || 30, 1), 100) : undefined;

  try {
    const [notifications, unreadCount] = await Promise.all([
      listNotificationsForUser(user.id, { unreadOnly, take }),
      getUnreadNotificationCount(user.id),
    ]);
    return NextResponse.json({ success: true, notifications, unreadCount }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to list notifications:", error);
    return NextResponse.json({ success: false, message: "Unable to load notifications." }, { status: 500 });
  }
}
