import "server-only";
import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { prisma } from "@/lib/prisma";

export const SESSION_COOKIE_NAME = "sf_session";
export const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1000; // 12 hours

function getAuthSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 16) {
    throw new Error(
      "AUTH_SECRET is missing or too short. Set a long random value in your environment (see .env.example)."
    );
  }
  return new TextEncoder().encode(secret);
}

type SessionCookiePayload = {
  sid: string;
};

/**
 * Creates a DB-backed session row and returns the signed JWT to set as the
 * session cookie's value.
 *
 * Design note: the cookie carries only a session id (`sid`), signed with
 * AUTH_SECRET via HS256. The signature is what makes the cookie
 * unforgeable -- nothing secret is stored in the database, so a database
 * read alone (backup leak, read-replica access, etc.) can never produce a
 * valid cookie. The Session row exists purely so a session can be looked
 * up and revoked server-side (logout, forced password change, a future
 * "sign out everywhere" action) even though the signed JWT itself would
 * otherwise keep verifying until its `exp`.
 */
export async function createSession(params: {
  userId: string;
  userAgent?: string | null;
  ipAddress?: string | null;
}): Promise<{ cookieValue: string; expiresAt: Date }> {
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);

  const session = await prisma.session.create({
    data: {
      userId: params.userId,
      expiresAt,
      userAgent: params.userAgent ?? null,
      ipAddress: params.ipAddress ?? null,
    },
    select: { id: true },
  });

  const cookieValue = await new SignJWT({ sid: session.id } satisfies SessionCookiePayload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(getAuthSecret());

  return { cookieValue, expiresAt };
}

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
  role: "SALESPERSON" | "SALES_MANAGER" | "ADMINISTRATOR";
  status: "ACTIVE" | "INACTIVE";
  mustChangePassword: boolean;
};

export type ResolvedSession = {
  sessionId: string;
  user: AuthenticatedUser;
};

/**
 * Verifies the session cookie's signature and expiry, then re-checks the
 * session and user against the database on every call -- never trusts a
 * cached or previously-verified result. This is deliberately NOT wrapped
 * in Next's `use cache: private`: a revoked session (logout, an admin
 * disabling the account, a forced password change) must stop working
 * immediately, not after a cache window elapses.
 */
export async function resolveSession(cookieValue: string | undefined): Promise<ResolvedSession | null> {
  if (!cookieValue) return null;

  let sid: string;
  try {
    const { payload } = await jwtVerify(cookieValue, getAuthSecret());
    if (typeof payload.sid !== "string" || payload.sid.length === 0) {
      return null;
    }
    sid = payload.sid;
  } catch (error) {
    if (
      error instanceof joseErrors.JWTExpired ||
      error instanceof joseErrors.JWSSignatureVerificationFailed ||
      error instanceof joseErrors.JWSInvalid
    ) {
      return null;
    }
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { id: sid },
    select: {
      id: true,
      expiresAt: true,
      revokedAt: true,
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          status: true,
          mustChangePassword: true,
        },
      },
    },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  if (session.user.status !== "ACTIVE") return null;

  return {
    sessionId: session.id,
    user: {
      id: session.user.id,
      name: session.user.name,
      email: session.user.email,
      role: session.user.role,
      status: session.user.status,
      mustChangePassword: session.user.mustChangePassword,
    },
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Revokes every other active session for a user, e.g. after a password change. */
export async function revokeAllSessionsForUser(userId: string, exceptSessionId?: string): Promise<void> {
  await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null,
      ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
    },
    data: { revokedAt: new Date() },
  });
}

/** Best-effort cleanup of long-expired session rows. Safe to run on a schedule; not required for correctness. */
export async function pruneExpiredSessions(olderThan: Date = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: olderThan } },
  });
  return result.count;
}
