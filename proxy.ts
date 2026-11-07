import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * OPTIMISTIC check only. This runs on Next.js's Node.js proxy runtime
 * before routes render, and it does exactly one thing: if a request for a
 * protected page has no session cookie at all, redirect to /login so an
 * unauthenticated visitor doesn't see a flash of protected UI before the
 * page itself notices.
 *
 * It does NOT verify the cookie's signature, does NOT check expiry or
 * revocation, and does NOT hit the database -- so it must never be
 * treated as the authorization boundary. Next.js's own guidance (and the
 * well-known 2025 Next.js middleware-bypass disclosure, where a crafted
 * header let requests skip middleware entirely) is the reason every real
 * check lives in lib/auth/current-user.ts and is re-run inside every page,
 * Route Handler, and Server Action -- see requireUser()/requireUserOrResponse()
 * there. If this file is ever bypassed, misconfigured, or simply not
 * matched for a given path, the real checks still hold the line.
 */
export function proxy(request: NextRequest) {
  const hasSessionCookie = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Run on every page request except:
     * - /login (must be reachable while signed out)
     * - /api/* (route handlers return their own 401/403 JSON; see
     *   lib/auth/current-user.ts -- they never rely on proxy coverage)
     * - Next.js internals and static/public assets
     */
    "/((?!login|api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|ico|jpg|jpeg|webp)$).*)",
  ],
};
