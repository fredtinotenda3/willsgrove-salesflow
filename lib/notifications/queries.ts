import "server-only";
import { prisma } from "@/lib/prisma";

export type NotificationRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  readAt: string | null;
  createdAt: string;
};

export async function listNotificationsForUser(userId: string, options?: { unreadOnly?: boolean; take?: number }): Promise<NotificationRow[]> {
  const rows = await prisma.notification.findMany({
    where: { userId, ...(options?.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: options?.take ?? 30,
  });

  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}
