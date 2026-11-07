import "server-only";
import type { NextResponse } from "next/server";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * Centralizes the session cookie's attributes so login/logout/change-password
 * can't drift from each other. httpOnly keeps it out of reach of any
 * injected script; SameSite=Lax is the first CSRF layer (see
 * lib/auth/csrf.ts for the second); `secure` is forced on in production so
 * the cookie is never sent over plain HTTP once deployed.
 */
export function setSessionCookie(response: NextResponse, value: string, expiresAt: Date): void {
  response.cookies.set(SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}
