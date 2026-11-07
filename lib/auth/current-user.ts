import "server-only";
import { cookies } from "next/headers";
import {
  resolveSession,
  SESSION_COOKIE_NAME,
  type AuthenticatedUser,
  type ResolvedSession,
} from "@/lib/auth/session";

/**
 * Data Access Layer entry point for authentication.
 *
 * proxy.ts (project root) does an *optimistic* check only -- it looks for
 * a plausible session cookie and redirects to /login when one is clearly
 * absent, purely so an unauthenticated browser gets a fast redirect
 * instead of a flash of protected UI. It is not the security boundary.
 * Next.js's own docs are explicit about this: "Trusting the client for
 * authorization... Re-verify the session in every Server Action and
 * Route Handler, close to the data" -- and a Proxy matcher or routing
 * refactor can silently stop covering a route, so nothing here assumes
 * proxy.ts ran. Every Route Handler and Server Action calls
 * requireUser()/requireRole() itself, directly against the database via
 * resolveSession(), on every request.
 */

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const cookieValue = store.get(SESSION_COOKIE_NAME)?.value;
  const session = await resolveSession(cookieValue);
  return session?.user ?? null;
}

export async function getCurrentSession(): Promise<ResolvedSession | null> {
  const store = await cookies();
  const cookieValue = store.get(SESSION_COOKIE_NAME)?.value;
  return resolveSession(cookieValue);
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Authentication required.");
    this.name = "UnauthenticatedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * For Route Handlers: resolves the current user or throws. Callers should
 * catch UnauthenticatedError -> 401 and ForbiddenError -> 403, or use
 * requireUserOrResponse() below for the common case of returning a
 * Response directly.
 */
export async function requireUser(allowedRoles?: AuthenticatedUser["role"][]): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    throw new ForbiddenError();
  }
  return user;
}

export type AuthResult =
  | { ok: true; user: AuthenticatedUser }
  | { ok: false; response: Response };

/**
 * Convenience wrapper that returns a ready-to-return 401/403 JSON Response
 * instead of throwing, which keeps every route handler's auth check to a
 * single guard clause:
 *
 *   const auth = await requireUserOrResponse(["ADMINISTRATOR"]);
 *   if (!auth.ok) return auth.response;
 *   const { user } = auth;
 */
export async function requireUserOrResponse(allowedRoles?: AuthenticatedUser["role"][]): Promise<AuthResult> {
  const user = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      response: Response.json({ success: false, message: "Authentication required." }, { status: 401 }),
    };
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return {
      ok: false,
      response: Response.json(
        { success: false, message: "You do not have permission to perform this action." },
        { status: 403 }
      ),
    };
  }

  return { ok: true, user };
}
