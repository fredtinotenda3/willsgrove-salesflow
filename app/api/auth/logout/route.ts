import { NextRequest, NextResponse } from "next/server";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { getCurrentSession } from "@/lib/auth/current-user";
import { revokeSession } from "@/lib/auth/session";
import { clearSessionCookie } from "@/lib/auth/cookies";

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const session = await getCurrentSession();
  if (session) {
    await revokeSession(session.sessionId);
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return response;
}
