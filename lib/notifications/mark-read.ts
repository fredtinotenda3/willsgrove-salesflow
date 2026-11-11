import "server-only";
import { prisma } from "@/lib/prisma";

export type MarkReadResult = { ok: true } | { ok: false; status: number; message: string };

/** Scoped to `userId` so one user can never mark another's notification read via a guessed id. */
export async function markNotificationRead(notificationId: string, userId: string): Promise<MarkReadResult> {
  const notification = await prisma.notification.findUnique({ where: { id: notificationId }, select: { id: true, userId: true } });
  if (!notification || notification.userId !== userId) {
    return { ok: false, status: 404, message: "Notification not found." };
  }

  await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } });
  return { ok: true };
}

export async function markAllNotificationsRead(userId: string): Promise<MarkReadResult> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  return { ok: true };
}
