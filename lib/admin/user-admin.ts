import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { generateTemporaryPassword, hashPassword } from "@/lib/auth/password";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { checkAdministratorContinuity, type RoleName, type RecordStatusName } from "./policy";
import { fail, type AdminFailure } from "./types";

const TX = { maxWait: 15000, timeout: 15000 };

export type UserRowFilters = { q?: string; role?: string; status?: string; department?: string };

export async function listAdminUsers(filters: UserRowFilters, page: number, pageSize: number) {
  const where: Prisma.UserWhereInput = {
    ...(filters.q ? { OR: [{ name: { contains: filters.q, mode: "insensitive" } }, { email: { contains: filters.q, mode: "insensitive" } }] } : {}),
    ...(filters.role ? { role: filters.role as RoleName } : {}),
    ...(filters.status ? { status: filters.status as RecordStatusName } : {}),
    ...(filters.department ? { department: filters.department as never } : {}),
  };
  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, name: true, email: true, role: true, status: true, department: true, mustChangePassword: true, createdAt: true },
    }),
  ]);
  const lastLogins = users.length
    ? await prisma.session.groupBy({ by: ["userId"], where: { userId: { in: users.map((u) => u.id) } }, _max: { createdAt: true } })
    : [];
  const loginByUser = new Map(lastLogins.map((l) => [l.userId, l._max.createdAt]));
  return { total, rows: users.map((u) => ({ ...u, lastLoginAt: loginByUser.get(u.id) ?? null })) };
}

/** Counts of work currently owned by a user -- what must be reassigned before they leave. */
export async function getUserWorkload(userId: string) {
  const [orders, quotations, customers, claims, actions] = await Promise.all([
    prisma.customerOrder.count({ where: { salespersonId: userId, status: { in: ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] } } }),
    prisma.quotation.count({ where: { salespersonId: userId, status: { in: ["DRAFT", "ISSUED"] }, convertedOrderId: null, supersededAt: null } }),
    prisma.customer.count({ where: { accountManagerId: userId, status: "ACTIVE" } }),
    prisma.invoiceClaim.count({ where: { assignedToId: userId, status: { notIn: ["RESOLVED", "REJECTED", "CLOSED"] } } }),
    prisma.managementAction.count({ where: { assignedToId: userId, status: { notIn: ["COMPLETED", "DISMISSED"] } } }),
  ]);
  return { orders, quotations, customers, claims, managementActions: actions, total: orders + quotations + customers + claims + actions };
}

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, email: true, role: true, status: true, department: true, mustChangePassword: true, createdAt: true, updatedAt: true },
  });
  if (!user) return null;
  const [lastSession, activeSessions, workload, audit] = await Promise.all([
    prisma.session.findFirst({ where: { userId }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    prisma.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
    getUserWorkload(userId),
    prisma.auditEvent.findMany({
      where: { OR: [{ actorId: userId }, { entityType: "User", entityId: userId }] },
      orderBy: { createdAt: "desc" },
      take: 25,
      select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actor: { select: { name: true } } },
    }),
  ]);
  return { user, lastLoginAt: lastSession?.createdAt ?? null, activeSessions, workload, audit };
}

async function otherActiveAdmins(tx: PrismaTransactionClient, excludeId: string): Promise<number> {
  return tx.user.count({ where: { role: "ADMINISTRATOR", status: "ACTIVE", id: { not: excludeId } } });
}

export async function updateUserProfile(
  targetId: string,
  input: { name?: string; role?: RoleName; department?: string | null; reason: string },
  actorId: string
): Promise<{ ok: true; changed: boolean; sessionsRevoked: boolean } | AdminFailure> {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, role: true, status: true, department: true } });
    if (!existing) return fail(404, "User not found.");
    const nextRole = input.role ?? existing.role;
    if (nextRole !== existing.role) {
      const check = checkAdministratorContinuity({ actorId, target: existing, next: { role: nextRole, status: existing.status }, otherActiveAdministrators: await otherActiveAdmins(tx, targetId) });
      if (!check.ok) return fail(409, check.message);
    }
    const data: Prisma.UserUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== existing.name) { data.name = input.name; before.name = existing.name; after.name = input.name; }
    if (nextRole !== existing.role) { data.role = nextRole; before.role = existing.role; after.role = nextRole; }
    if (input.department !== undefined && input.department !== existing.department) { data.department = input.department as never; before.department = existing.department; after.department = input.department; }
    if (Object.keys(data).length === 0) return { ok: true as const, changed: false, sessionsRevoked: false };
    await tx.user.update({ where: { id: targetId }, data });
    await tx.auditEvent.create({
      data: { actorId, action: after.role ? "USER_UPDATE_ROLE" : "USER_UPDATE", entityType: "User", entityId: targetId, beforeData: before as Prisma.InputJsonValue, afterData: { ...after, reason: input.reason } as Prisma.InputJsonValue },
    });
    return { ok: true as const, changed: true, sessionsRevoked: after.role !== undefined };
  }, TX);
  // A role change takes effect immediately: existing sessions are ended so permissions are never stale.
  if (result.ok && result.sessionsRevoked) await revokeAllSessionsForUser(targetId);
  return result;
}

export async function setUserStatus(targetId: string, status: RecordStatusName, reason: string, actorId: string): Promise<{ ok: true; changed: boolean } | AdminFailure> {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.user.findUnique({ where: { id: targetId }, select: { id: true, role: true, status: true } });
    if (!existing) return fail(404, "User not found.");
    if (existing.status === status) return { ok: true as const, changed: false };
    const check = checkAdministratorContinuity({ actorId, target: existing, next: { role: existing.role, status }, otherActiveAdministrators: await otherActiveAdmins(tx, targetId) });
    if (!check.ok) return fail(409, check.message);
    await tx.user.update({ where: { id: targetId }, data: { status } });
    await tx.auditEvent.create({
      data: { actorId, action: status === "ACTIVE" ? "USER_ACTIVATE" : "USER_DEACTIVATE", entityType: "User", entityId: targetId, beforeData: { status: existing.status }, afterData: { status, reason } },
    });
    return { ok: true as const, changed: true };
  }, TX);
  if (result.ok && result.changed && status === "INACTIVE") await revokeAllSessionsForUser(targetId);
  return result;
}

/**
 * Secure password actions. "reset" generates a new temporary password
 * server-side (shown once to the administrator, never stored recoverably or
 * written to the audit trail) and forces a change at next login.
 * "require-change" only sets the flag. Both end the user's sessions.
 */
export async function adminPasswordAction(targetId: string, action: "reset" | "require-change", reason: string, actorId: string): Promise<{ ok: true; temporaryPassword?: string } | AdminFailure> {
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, status: true } });
  if (!target) return fail(404, "User not found.");
  if (target.status !== "ACTIVE") return fail(409, "Activate the user before resetting their password.");
  const temporaryPassword = action === "reset" ? generateTemporaryPassword() : undefined;
  const passwordHash = temporaryPassword ? await hashPassword(temporaryPassword) : undefined;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: targetId }, data: { mustChangePassword: true, ...(passwordHash ? { passwordHash } : {}) } });
    await tx.auditEvent.create({
      data: { actorId, action: action === "reset" ? "USER_PASSWORD_RESET" : "USER_REQUIRE_PASSWORD_CHANGE", entityType: "User", entityId: targetId, beforeData: Prisma.JsonNull, afterData: { mustChangePassword: true, reason } },
    });
  }, TX);
  await revokeAllSessionsForUser(targetId);
  return { ok: true, temporaryPassword };
}
