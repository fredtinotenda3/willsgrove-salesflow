import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";

export type AdminOutcome = "SUCCESS" | "REFUSED" | "FAILED";

export type AdminAuditInput = {
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string;
  outcome?: AdminOutcome;
};

/**
 * The one shape every NEW administrative audit event uses, on the existing
 * AuditEvent table (no separate admin log): actor, action, entity, previous
 * and new values, the administrator's reason and the outcome. Pure so it is
 * unit-tested.
 */
export function buildAuditData(i: AdminAuditInput): Prisma.AuditEventUncheckedCreateInput {
  return {
    actorId: i.actorId,
    action: i.action,
    entityType: i.entityType,
    entityId: i.entityId,
    beforeData: (i.before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    afterData: { ...(i.after ?? {}), ...(i.reason ? { reason: i.reason } : {}), outcome: i.outcome ?? "SUCCESS" } as Prisma.InputJsonValue,
  };
}

/** Writes inside the caller's transaction so the change and its audit trail commit or roll back together. */
export async function writeAudit(db: PrismaTransactionClient, input: AdminAuditInput): Promise<void> {
  await db.auditEvent.create({ data: buildAuditData(input) });
}

/**
 * A refused destructive attempt (e.g. deleting an order that has invoices) is
 * itself evidence. Written outside any transaction and never allowed to mask
 * the refusal the administrator is about to be shown.
 */
export async function recordRefusal(input: Omit<AdminAuditInput, "outcome">): Promise<void> {
  try {
    await prisma.auditEvent.create({ data: buildAuditData({ ...input, outcome: "REFUSED" }) });
  } catch (error) {
    console.error("[admin] could not record refusal", error instanceof Error ? error.message : "unknown error");
  }
}
