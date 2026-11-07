import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreateUserInput } from "@/lib/user-validation";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { normalizeEmail } from "@/lib/auth/validation";
import { revokeAllSessionsForUser } from "@/lib/auth/session";

export type MutationFailure = {
  ok: false;
  status: number;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type CreateUserResult =
  | { ok: true; id: string; temporaryPassword: string }
  | MutationFailure;

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const duplicateEmailFailure: MutationFailure = {
  ok: false,
  status: 409,
  message: "A user with this email address already exists.",
  fieldErrors: { email: "This email address is already used." },
};

/**
 * Creates a new application user. Administrator-only -- enforced by the
 * caller (app/api/users/route.ts) via requireUserOrResponse(["ADMINISTRATOR"]),
 * never only by proxy.ts or by hiding the "Add User" button in the UI.
 *
 * The initial password is generated here, never supplied by the admin --
 * it is returned once in the result for the admin to relay out-of-band,
 * and mustChangePassword is set so the new user must replace it at first
 * login (the same rule as the seeded admin account).
 */
export async function createUser(
  input: CreateUserInput,
  actorId: string
): Promise<CreateUserResult> {
  const email = normalizeEmail(input.email);
  const temporaryPassword = generateTemporaryPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  try {
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: input.name,
          email,
          passwordHash,
          role: input.role,
          mustChangePassword: true,
          isDemo: false,
        },
        select: { id: true },
      });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "USER_CREATE",
          entityType: "User",
          entityId: user.id,
          afterData: { name: input.name, email, role: input.role },
        },
      });

      return user;
    });

    return { ok: true, id: created.id, temporaryPassword };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateEmailFailure;
    }
    throw error;
  }
}

export type UpdateUserStatusResult = { ok: true; changed: boolean } | MutationFailure;

/**
 * Activates/deactivates a user. An administrator deactivating their OWN
 * account is rejected -- otherwise the last administrator could lock
 * themselves out with no way back in short of direct database access.
 */
export async function updateUserStatus(
  targetId: string,
  status: "ACTIVE" | "INACTIVE",
  actorId: string
): Promise<UpdateUserStatusResult> {
  if (targetId === actorId && status === "INACTIVE") {
    return {
      ok: false,
      status: 409,
      message: "You cannot deactivate your own account.",
    };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: targetId }, select: { status: true } });
    if (!existing) {
      return { ok: false, status: 404, message: "User not found." } satisfies MutationFailure;
    }

    if (existing.status === status) {
      return { ok: true, changed: false } as const;
    }

    await tx.user.update({ where: { id: targetId }, data: { status } });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: status === "ACTIVE" ? "USER_ACTIVATE" : "USER_DEACTIVATE",
        entityType: "User",
        entityId: targetId,
        beforeData: { status: existing.status },
        afterData: { status },
      },
    });

    return { ok: true, changed: true } as const;
  });
}

/**
 * Called after updateUserStatus deactivates a user -- revokes every active
 * session for that user immediately, outside the status-update
 * transaction (session revocation isn't part of the same atomic unit of
 * work and shouldn't roll back the status change if it fails).
 */
export async function revokeSessionsIfDeactivated(targetId: string, status: "ACTIVE" | "INACTIVE") {
  if (status === "INACTIVE") {
    await revokeAllSessionsForUser(targetId);
  }
}

export async function listUsers() {
  const users = await prisma.user.findMany({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
      mustChangePassword: true,
      isDemo: true,
      createdAt: true,
    },
  });

  return users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    mustChangePassword: user.mustChangePassword,
    isDemo: user.isDemo,
    createdAt: user.createdAt.toISOString(),
  }));
}
