import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { toCsv } from "./csv";

import type { AuditFilters } from "./audit-filters";
export type { AuditFilters };

function where(f: AuditFilters): Prisma.AuditEventWhereInput {
  return {
    ...(f.actorId ? { actorId: f.actorId } : {}),
    ...(f.entityType ? { entityType: f.entityType } : {}),
    ...(f.action ? { action: { contains: f.action, mode: "insensitive" } } : {}),
    ...(f.q ? { OR: [{ entityId: { contains: f.q } }, { action: { contains: f.q, mode: "insensitive" } }, { actor: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
  };
}

/** Read-only. There is no update or delete path for audit events anywhere in the application. */
export async function listAuditEvents(f: AuditFilters, page: number, pageSize: number) {
  const w = where(f);
  const [total, rows] = await Promise.all([
    prisma.auditEvent.count({ where: w }),
    prisma.auditEvent.findMany({ where: w, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, action: true, entityType: true, entityId: true, beforeData: true, afterData: true, createdAt: true, actor: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows };
}

export async function auditFilterOptions() {
  const [types, actors] = await Promise.all([
    prisma.auditEvent.findMany({ distinct: ["entityType"], select: { entityType: true }, orderBy: { entityType: "asc" } }),
    prisma.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  return { entityTypes: types.map((t) => t.entityType), actors };
}

export function auditRowsToCsv(rows: Awaited<ReturnType<typeof listAuditEvents>>["rows"]): string {
  return toCsv(
    ["Time (UTC)", "Actor", "Action", "Entity type", "Entity id", "Before", "After"],
    rows.map((r) => [r.createdAt.toISOString(), r.actor?.name ?? "System", r.action, r.entityType, r.entityId, r.beforeData, r.afterData])
  );
}
