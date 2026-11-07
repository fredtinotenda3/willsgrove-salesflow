import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readJsonObject } from "@/lib/http";
import { verifyCsrfOrigin } from "@/lib/auth/csrf";
import { requireUserOrResponse, getCurrentSession } from "@/lib/auth/current-user";
import { changePasswordSchema } from "@/lib/auth/validation";
import { verifyPassword, hashPassword, checkPasswordStrength } from "@/lib/auth/password";
import { revokeAllSessionsForUser } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  const csrf = verifyCsrfOrigin(request);
  if (!csrf.ok) {
    return NextResponse.json({ success: false, message: csrf.message }, { status: 403 });
  }

  // Deliberately NOT role-restricted: any authenticated user, including
  // one whose mustChangePassword is still true, can reach this endpoint --
  // it's how that flag gets cleared in the first place.
  const auth = await requireUserOrResponse();
  if (!auth.ok) return auth.response;
  const { user } = auth;

  const parsed = await readJsonObject(request);
  if (!parsed.ok) {
    return NextResponse.json({ success: false, message: parsed.message }, { status: 400 });
  }

  const input = changePasswordSchema.safeParse(parsed.body);
  if (!input.success) {
    return NextResponse.json(
      { success: false, message: input.error.issues[0]?.message ?? "Invalid request." },
      { status: 400 }
    );
  }

  const current = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });

  const currentOk = await verifyPassword(input.data.currentPassword, current.passwordHash);
  if (!currentOk) {
    return NextResponse.json({ success: false, message: "Current password is incorrect." }, { status: 401 });
  }

  const strength = checkPasswordStrength(input.data.newPassword);
  if (!strength.ok) {
    return NextResponse.json({ success: false, message: strength.message }, { status: 400 });
  }

  const newHash = await hashPassword(input.data.newPassword);
  const session = await getCurrentSession();

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, mustChangePassword: false },
    });

    await tx.auditEvent.create({
      data: {
        actorId: user.id,
        action: "PASSWORD_CHANGED",
        entityType: "User",
        entityId: user.id,
        beforeData: undefined,
        afterData: undefined,
      },
    });
  });

  // Hygiene after a credential change: every other session for this user
  // stops working immediately. The session making this request is kept so
  // the user isn't logged out by their own password change.
  await revokeAllSessionsForUser(user.id, session?.sessionId);

  return NextResponse.json({ success: true });
}
