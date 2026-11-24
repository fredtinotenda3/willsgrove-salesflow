import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { BULK_REASSIGN_LIMIT, isEligibleAssignee, isReassignableClaimStatus, isReassignableOrderStatus, isReassignableQuotation } from "./policy";
import { fail, type AdminFailure } from "./types";
import type { ReassignEntityType } from "./validation";

const TX = { maxWait: 20000, timeout: 20000 };

export type ReassignPlanItem = { id: string; label: string; fromUserId: string | null; fromUserName: string | null };
export type ReassignSkipped = { id: string; label: string; reason: string };
export type ReassignPlan = { entityType: ReassignEntityType; toUserId: string; toUserName: string; eligible: ReassignPlanItem[]; skipped: ReassignSkipped[] };

const ENTITY_AUDIT: Record<ReassignEntityType, { entityType: string; action: string }> = {
  ORDER: { entityType: "CustomerOrder", action: "ORDER_REASSIGN" },
  QUOTATION: { entityType: "Quotation", action: "QUOTATION_REASSIGN" },
  CUSTOMER: { entityType: "Customer", action: "CUSTOMER_ACCOUNT_MANAGER_ASSIGN" },
  CLAIM: { entityType: "InvoiceClaim", action: "CLAIM_REASSIGN" },
  MANAGEMENT_ACTION: { entityType: "ManagementAction", action: "MANAGEMENT_ACTION_REASSIGN" },
};

type Tx = PrismaTransactionClient | typeof prisma;

/** Loads the records and splits them into reassignable vs skipped-with-reason. Pure reads; used by both preview and execute. */
export async function planReassignment(db: Tx, entityType: ReassignEntityType, ids: string[], toUserId: string): Promise<ReassignPlan | AdminFailure> {
  if (ids.length > BULK_REASSIGN_LIMIT) return fail(400, `Reassign at most ${BULK_REASSIGN_LIMIT} records at a time.`);
  const target = await db.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true, status: true, role: true } });
  if (!target) return fail(404, "The new owner was not found.");
  if (!isEligibleAssignee(target)) return fail(409, "Work can only be assigned to an active user.");
  const unique = [...new Set(ids)];
  const eligible: ReassignPlanItem[] = [];
  const skipped: ReassignSkipped[] = [];
  const seen = new Set<string>();

  const push = (id: string, label: string, ok: boolean, current: { id: string; name: string } | null, why: string) => {
    seen.add(id);
    if (!ok) skipped.push({ id, label, reason: why });
    else if (current?.id === toUserId) skipped.push({ id, label, reason: "Already assigned to this user." });
    else eligible.push({ id, label, fromUserId: current?.id ?? null, fromUserName: current?.name ?? null });
  };

  if (entityType === "ORDER") {
    const rows = await db.customerOrder.findMany({ where: { id: { in: unique } }, select: { id: true, reference: true, status: true, salesperson: { select: { id: true, name: true } } } });
    for (const r of rows) push(r.id, r.reference, isReassignableOrderStatus(r.status), r.salesperson, `Orders in status ${r.status} keep their owner.`);
  } else if (entityType === "QUOTATION") {
    const rows = await db.quotation.findMany({ where: { id: { in: unique } }, select: { id: true, quotationNumber: true, revisionNumber: true, status: true, convertedOrderId: true, supersededAt: true, salesperson: { select: { id: true, name: true } } } });
    for (const r of rows) push(r.id, `${r.quotationNumber} r${r.revisionNumber}`, isReassignableQuotation(r), r.salesperson, "Only open (draft or issued), unconverted, current-revision quotations can be reassigned.");
  } else if (entityType === "CUSTOMER") {
    const rows = await db.customer.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, status: true, accountManager: { select: { id: true, name: true } } } });
    for (const r of rows) push(r.id, r.name, r.status === "ACTIVE", r.accountManager, "Inactive customers are not assigned.");
  } else if (entityType === "CLAIM") {
    const rows = await db.invoiceClaim.findMany({ where: { id: { in: unique } }, select: { id: true, claimReference: true, status: true, assignedTo: { select: { id: true, name: true } } } });
    for (const r of rows) push(r.id, r.claimReference, isReassignableClaimStatus(r.status), r.assignedTo, `Claims in status ${r.status} keep their owner.`);
  } else {
    const rows = await db.managementAction.findMany({ where: { id: { in: unique } }, select: { id: true, title: true, status: true, assignedTo: { select: { id: true, name: true } } } });
    for (const r of rows) push(r.id, r.title, r.status !== "COMPLETED" && r.status !== "DISMISSED", r.assignedTo, `Actions in status ${r.status} keep their owner.`);
  }
  for (const id of unique) if (!seen.has(id)) skipped.push({ id, label: id, reason: "Record not found." });
  return { entityType, toUserId, toUserName: target.name, eligible, skipped };
}

/**
 * Reassigns in ONE transaction. The plan is re-derived inside the
 * transaction (never trusted from the preview), then every change and its
 * audit event (from, to, reason, bulk size) commit together or not at all.
 */
export async function executeReassignment(entityType: ReassignEntityType, ids: string[], toUserId: string, reason: string, actorId: string): Promise<{ ok: true; plan: ReassignPlan } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const plan = await planReassignment(tx, entityType, ids, toUserId);
    if ("ok" in plan) return plan;
    if (plan.eligible.length === 0) return fail(409, "None of the selected records can be reassigned.");
    const eligibleIds = plan.eligible.map((e) => e.id);
    const where = { id: { in: eligibleIds } };
    if (entityType === "ORDER") await tx.customerOrder.updateMany({ where, data: { salespersonId: toUserId } });
    else if (entityType === "QUOTATION") await tx.quotation.updateMany({ where, data: { salespersonId: toUserId } });
    else if (entityType === "CUSTOMER") await tx.customer.updateMany({ where, data: { accountManagerId: toUserId } });
    else if (entityType === "CLAIM") await tx.invoiceClaim.updateMany({ where, data: { assignedToId: toUserId } });
    else await tx.managementAction.updateMany({ where, data: { assignedToId: toUserId } });

    const meta = ENTITY_AUDIT[entityType];
    await tx.auditEvent.createMany({
      data: plan.eligible.map((e) => ({
        actorId,
        action: meta.action,
        entityType: meta.entityType,
        entityId: e.id,
        beforeData: { assigneeId: e.fromUserId } as Prisma.InputJsonValue,
        afterData: { assigneeId: toUserId, reason, bulkSize: plan.eligible.length } as Prisma.InputJsonValue,
      })),
    });
    return { ok: true as const, plan };
  }, TX);
}

/** Every reassignable record currently owned by a user, per entity -- for "this person is leaving". */
export async function collectUserOwnedIds(fromUserId: string, types: ReassignEntityType[]): Promise<Record<ReassignEntityType, string[]>> {
  const out: Record<ReassignEntityType, string[]> = { ORDER: [], QUOTATION: [], CUSTOMER: [], CLAIM: [], MANAGEMENT_ACTION: [] };
  const take = BULK_REASSIGN_LIMIT;
  if (types.includes("ORDER")) out.ORDER = (await prisma.customerOrder.findMany({ where: { salespersonId: fromUserId, status: { in: ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] } }, select: { id: true }, take })).map((r) => r.id);
  if (types.includes("QUOTATION")) out.QUOTATION = (await prisma.quotation.findMany({ where: { salespersonId: fromUserId, status: { in: ["DRAFT", "ISSUED"] }, convertedOrderId: null, supersededAt: null }, select: { id: true }, take })).map((r) => r.id);
  if (types.includes("CUSTOMER")) out.CUSTOMER = (await prisma.customer.findMany({ where: { accountManagerId: fromUserId, status: "ACTIVE" }, select: { id: true }, take })).map((r) => r.id);
  if (types.includes("CLAIM")) out.CLAIM = (await prisma.invoiceClaim.findMany({ where: { assignedToId: fromUserId, status: { notIn: ["RESOLVED", "REJECTED", "CLOSED"] } }, select: { id: true }, take })).map((r) => r.id);
  if (types.includes("MANAGEMENT_ACTION")) out.MANAGEMENT_ACTION = (await prisma.managementAction.findMany({ where: { assignedToId: fromUserId, status: { notIn: ["COMPLETED", "DISMISSED"] } }, select: { id: true }, take })).map((r) => r.id);
  return out;
}
