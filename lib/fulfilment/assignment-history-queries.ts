import "server-only";
import { prisma } from "@/lib/prisma";
import {
  ASSIGNMENT_EVENT_ACTIONS,
  buildAssignmentHistory,
  collectAssignmentIds,
  type AssignmentHistoryEntry,
} from "@/lib/fulfilment/assignment-history";

/**
 * Loads the recorded assignment history (initial assignment + every change)
 * for a set of dispatch records, keyed by dispatch id. Shared by the order
 * detail page (lib/order-queries.ts) and the Delivered Orders detail page
 * (lib/delivered-orders/queries.ts) so both show exactly the same events.
 * Two extra lookups at most (personnel names, vehicle registrations) -- and
 * only for ids that appear in events written before names were snapshotted.
 */
export async function loadDispatchAssignmentHistory(dispatchRecordIds: string[]): Promise<Map<string, AssignmentHistoryEntry[]>> {
  if (dispatchRecordIds.length === 0) return new Map();

  const rows = await prisma.auditEvent.findMany({
    where: {
      entityType: "DispatchRecord",
      entityId: { in: dispatchRecordIds },
      action: { in: [...ASSIGNMENT_EVENT_ACTIONS] },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, entityId: true, action: true, createdAt: true, beforeData: true, afterData: true, actor: { select: { name: true } } },
  });

  const events = rows.map((row) => ({
    id: row.id,
    dispatchRecordId: row.entityId,
    action: row.action,
    createdAt: row.createdAt,
    actorName: row.actor?.name ?? null,
    beforeData: row.beforeData,
    afterData: row.afterData,
  }));

  const { personnelIds, vehicleIds } = collectAssignmentIds(events);
  const [personnel, vehicles] = await Promise.all([
    personnelIds.length > 0 ? prisma.personnel.findMany({ where: { id: { in: personnelIds } }, select: { id: true, name: true } }) : [],
    vehicleIds.length > 0 ? prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, registrationNumber: true } }) : [],
  ]);

  return buildAssignmentHistory(events, {
    personnel: new Map(personnel.map((p) => [p.id, p.name])),
    vehicles: new Map(vehicles.map((v) => [v.id, v.registrationNumber])),
  });
}
