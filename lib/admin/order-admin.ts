import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { checkOrderCancellable, checkOrderEditable, checkOrderReopenable, type OrderGuardFacts } from "./order-policy";
import { fail, type AdminFailure } from "./types";

const TX = { maxWait: 15000, timeout: 15000 };

export type OrderFilters = { q?: string; status?: string; salespersonId?: string; unassigned?: boolean; customerId?: string };

export async function listAdminOrders(f: OrderFilters, page: number, pageSize: number) {
  const where: Prisma.CustomerOrderWhereInput = {
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.unassigned ? { salespersonId: null } : f.salespersonId ? { salespersonId: f.salespersonId } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.q ? { OR: [{ reference: { contains: f.q, mode: "insensitive" } }, { customerPoReference: { contains: f.q, mode: "insensitive" } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, reference: true, status: true, currency: true, total: true, createdAt: true, updatedAt: true, customerPoReference: true, customer: { select: { name: true } }, salesperson: { select: { id: true, name: true } } },
    }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, total: r.total === null ? null : r.total.toString() })) };
}

async function guardFacts(db: PrismaTransactionClient | typeof prisma, id: string): Promise<(OrderGuardFacts & { reference: string }) | null> {
  const o = await db.customerOrder.findUnique({
    where: { id },
    select: { reference: true, status: true, handedToSapAt: true, invoicedAt: true, _count: { select: { pickingSessions: true, matchedSapInvoices: true } } },
  });
  if (!o) return null;
  const pendingApprovals = await db.approvalRequest.count({ where: { customerOrderId: id, status: "PENDING" } });
  return { reference: o.reference, status: o.status, handedToSapAt: o.handedToSapAt, invoicedAt: o.invoicedAt, pickingSessions: o._count.pickingSessions, invoiceMatches: o._count.matchedSapInvoices, pendingApprovals };
}

export async function getAdminOrderDetail(id: string) {
  const order = await prisma.customerOrder.findUnique({
    where: { id },
    select: {
      id: true, reference: true, status: true, source: true, currency: true, subtotal: true, taxTotal: true, total: true, customerPoReference: true, orderDate: true, requestedDeliveryDate: true, deliveryAddress: true, internalNotes: true, createdAt: true, updatedAt: true, handedToSapAt: true, invoicedAt: true,
      customer: { select: { id: true, name: true } }, salesperson: { select: { id: true, name: true, status: true } }, createdBy: { select: { name: true } },
      _count: { select: { lines: true, documents: true } },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 25, select: { id: true, fromStatus: true, toStatus: true, notes: true, createdAt: true, changedBy: { select: { name: true } } } },
      sourceQuotation: { select: { id: true, quotationNumber: true } },
    },
  });
  if (!order) return null;
  const facts = await guardFacts(prisma, id);
  const history = await prisma.auditEvent.findMany({ where: { entityType: "CustomerOrder", entityId: id }, orderBy: { createdAt: "desc" }, take: 25, select: { id: true, action: true, beforeData: true, afterData: true, createdAt: true, actor: { select: { name: true } } } });
  return { order, history, canEdit: facts ? checkOrderEditable(facts) : { ok: false as const, message: "" }, canCancel: facts ? checkOrderCancellable(facts) : { ok: false as const, message: "" }, canReopen: facts ? checkOrderReopenable(facts) : { ok: false as const, message: "" } };
}

export type OrderPatch = { customerPoReference?: string | null; requestedDeliveryDate?: string | null; deliveryAddress?: string | null; internalNotes?: string | null; reason: string };
const asDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

/** Correct permitted details only. Lines, prices, customer, totals and status are untouched. */
export async function updateOrderDetails(id: string, patch: OrderPatch, actorId: string): Promise<{ ok: true; changed: boolean } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const facts = await guardFacts(tx, id);
    if (!facts) return fail(404, "Order not found.");
    const guard = checkOrderEditable(facts);
    if (!guard.ok) return fail(409, guard.message);
    const existing = await tx.customerOrder.findUniqueOrThrow({ where: { id }, select: { customerPoReference: true, requestedDeliveryDate: true, deliveryAddress: true, internalNotes: true } });
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    const data: Prisma.CustomerOrderUpdateInput = {};
    if (patch.customerPoReference !== undefined && patch.customerPoReference !== existing.customerPoReference) { before.customerPoReference = existing.customerPoReference; after.customerPoReference = patch.customerPoReference; data.customerPoReference = patch.customerPoReference; }
    if (patch.deliveryAddress !== undefined && patch.deliveryAddress !== existing.deliveryAddress) { before.deliveryAddress = existing.deliveryAddress; after.deliveryAddress = patch.deliveryAddress; data.deliveryAddress = patch.deliveryAddress; }
    if (patch.internalNotes !== undefined && patch.internalNotes !== existing.internalNotes) { before.internalNotes = existing.internalNotes; after.internalNotes = patch.internalNotes; data.internalNotes = patch.internalNotes; }
    if (patch.requestedDeliveryDate !== undefined) {
      const next = asDate(patch.requestedDeliveryDate);
      const prev = existing.requestedDeliveryDate;
      if ((next?.getTime() ?? null) !== (prev?.getTime() ?? null)) { before.requestedDeliveryDate = prev?.toISOString().slice(0, 10) ?? null; after.requestedDeliveryDate = patch.requestedDeliveryDate; data.requestedDeliveryDate = next; }
    }
    if (Object.keys(after).length === 0) return { ok: true as const, changed: false };
    await tx.customerOrder.update({ where: { id }, data });
    await tx.auditEvent.create({ data: { actorId, action: "ORDER_ADMIN_UPDATE", entityType: "CustomerOrder", entityId: id, beforeData: before as Prisma.InputJsonValue, afterData: { ...after, reason: patch.reason } as Prisma.InputJsonValue } });
    return { ok: true as const, changed: true };
  }, TX);
}

async function transition(id: string, kind: "cancel" | "reopen", reason: string, actorId: string): Promise<{ ok: true } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const facts = await guardFacts(tx, id);
    if (!facts) return fail(404, "Order not found.");
    const guard = kind === "cancel" ? checkOrderCancellable(facts) : checkOrderReopenable(facts);
    if (!guard.ok) return fail(409, guard.message);
    const to = kind === "cancel" ? "CANCELLED" : "RECEIVED";
    // Compare-and-set on the status read above: a concurrent change makes this a no-op instead of overwriting it.
    const moved = await tx.customerOrder.updateMany({ where: { id, status: facts.status as never }, data: { status: to } });
    if (moved.count !== 1) return fail(409, "The order changed while you were working. Refresh and try again.");
    await tx.orderStatusHistory.create({ data: { orderId: id, changedById: actorId, fromStatus: facts.status as never, toStatus: to, notes: `${kind === "cancel" ? "Cancelled" : "Reopened"} by administrator: ${reason}` } });
    await tx.auditEvent.create({ data: { actorId, action: kind === "cancel" ? "ORDER_ADMIN_CANCEL" : "ORDER_ADMIN_REOPEN", entityType: "CustomerOrder", entityId: id, beforeData: { status: facts.status }, afterData: { status: to, reason } } });
    return { ok: true as const };
  }, TX);
}

export const cancelOrder = (id: string, reason: string, actorId: string) => transition(id, "cancel", reason, actorId);
export const reopenOrder = (id: string, reason: string, actorId: string) => transition(id, "reopen", reason, actorId);

/* ------------------------------ quotations ------------------------------ */

export type QuotationFilters = { q?: string; status?: string; salespersonId?: string };

export async function listAdminQuotations(f: QuotationFilters, page: number, pageSize: number) {
  const where: Prisma.QuotationWhereInput = {
    supersededAt: null,
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.salespersonId ? { salespersonId: f.salespersonId } : {}),
    ...(f.q ? { OR: [{ quotationNumber: { contains: f.q, mode: "insensitive" } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, quotationNumber: true, revisionNumber: true, status: true, currency: true, total: true, validUntil: true, convertedOrderId: true, supersededAt: true, customer: { select: { name: true } }, salesperson: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, total: r.total.toString(), validUntil: r.validUntil.toISOString().slice(0, 10) })) };
}

/* -------------------------------- claims -------------------------------- */

export type ClaimFilters = { q?: string; status?: string; assigneeId?: string; unassigned?: boolean };

export async function listAdminClaims(f: ClaimFilters, page: number, pageSize: number) {
  const where: Prisma.InvoiceClaimWhereInput = {
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.unassigned ? { assignedToId: null } : f.assigneeId ? { assignedToId: f.assigneeId } : {}),
    ...(f.q ? { OR: [{ claimReference: { contains: f.q, mode: "insensitive" } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.invoiceClaim.count({ where }),
    prisma.invoiceClaim.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, claimReference: true, status: true, createdAt: true, customer: { select: { name: true } }, assignedTo: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows };
}
