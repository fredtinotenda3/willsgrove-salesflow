import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { loginSchema, normalizeEmail } from "@/lib/auth/validation";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { setSessionCookie } from "@/lib/auth/cookies";
import { checkRateLimit, LOGIN_RATE_LIMIT, loginRateLimitKey } from "@/lib/auth/rate-limit";

function clientIp(request: NextRequest): string {
  // Behind a reverse proxy, the real client IP arrives in X-Forwarded-For.
  // Falls back to a constant so unproxied local requests still rate-limit
  // sanely rather than being keyed on `undefined`.
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return "unknown";
}

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  const parsed = await readJsonObject(request);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  const input = loginSchema.safeParse(parsed.body);
  if (!input.success) {
    return NextResponse.json(
      { success: false, message: input.error.issues[0]?.message ?? "Invalid login details." },
      { status: 400 }
    );
  }

  const email = normalizeEmail(input.data.email);
  const ip = clientIp(request);

  const rate = checkRateLimit(loginRateLimitKey(ip, email), LOGIN_RATE_LIMIT.limit, LOGIN_RATE_LIMIT.windowMs);
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, message: "Too many login attempts. Please wait before trying again." },
      { status: 429, headers: { "Retry-After": Math.ceil(rate.retryAfterMs / 1000).toString() } }
    );
  }

  // Constant-shaped response regardless of which part of the credential
  // pair was wrong, so the endpoint doesn't reveal whether an email is
  // registered.
  const invalidCredentials = () =>
    NextResponse.json({ success: false, message: "Incorrect email or password." }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return invalidCredentials();
  }

  const passwordOk = await verifyPassword(input.data.password, user.passwordHash);
  if (!passwordOk) {
    return invalidCredentials();
  }

  if (user.status !== "ACTIVE") {
    return NextResponse.json(
      { success: false, message: "This account is inactive. Contact an administrator." },
      { status: 403 }
    );
  }

  const { cookieValue, expiresAt } = await createSession({
    userId: user.id,
    userAgent: request.headers.get("user-agent"),
    ipAddress: ip,
  });

  const response = NextResponse.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      mustChangePassword: user.mustChangePassword,
    },
  });
  setSessionCookie(response, cookieValue, expiresAt);
  return response;
}
