import "server-only";
import type { Prisma, NotificationType, UserRole } from "@prisma/client";

/**
 * Milestone 8 (Validation and Approvals). Minimal internal notification
 * mechanism (spec section 9) -- no email/WhatsApp integration (explicitly
 * out of scope, deferred to Milestone 10), no real-time push (nothing
 * else in this codebase uses websockets either). A notification is
 * created inside the SAME transaction as the business event it describes
 * (same "never a state where the fact exists but its audit trail
 * doesn't" discipline as every other dual-write in this project), using
 * the caller's own `tx`, never opening a transaction here.
 */

export type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string | null;
};

export async function createNotification(tx: Prisma.TransactionClient, input: CreateNotificationInput): Promise<void> {
  await tx.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
    },
  });
}

/**
 * Bulk-notifies every active user with a given role (and, per
 * lib/approvals/validation.ts's eligibleApproverRoles(), every role that
 * satisfies it) -- used when an approval request needs to reach "the
 * eligible approver group" (spec section 2) rather than one named
 * individual, since this milestone deliberately does not build a named-
 * assignment feature (see PROGRESS.md's Milestone 8 section).
 */
export async function createNotificationForRoles(
  tx: Prisma.TransactionClient,
  roles: readonly UserRole[],
  input: Omit<CreateNotificationInput, "userId">
): Promise<void> {
  const recipients = await tx.user.findMany({
    where: { role: { in: roles as UserRole[] }, status: "ACTIVE" },
    select: { id: true },
  });
  if (recipients.length === 0) return;

  await tx.notification.createMany({
    data: recipients.map((user) => ({
      userId: user.id,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link ?? null,
    })),
  });
}
