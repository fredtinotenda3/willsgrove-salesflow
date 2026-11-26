import { getEffectiveOrderStatus, type EffectiveOrderStatusInput } from "@/lib/order-display";
import { loadOrderProgress, loadSingleOrderProgress } from "@/lib/order-progress";
import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { checkOrderCancellable, checkOrderEditable, checkOrderReopenable, type OrderGuardFacts } from "./order-policy";
import { fail, type AdminFailure } from "./types";
import { getOrderDeletionImpact } from "./record-deletion";
import { orderByFor, type SortDir, type SortState } from "./list-query";
import { loadTaxRatesByCode } from "@/lib/order-price-resolution";
import { pricingFromLines, summariseOrderTotal } from "@/lib/order-totals";

const TX = { maxWait: 15000, timeout: 15000 };

export const OPEN_ORDER_STATUSES = ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] as const;
export const ORDER_STATUSES = [...OPEN_ORDER_STATUSES, "READY_TO_INVOICE", "REJECTED", "CANCELLED"] as const;

export type OrderFilters = { q?: string; status?: string; salespersonId?: string; unassigned?: boolean; customerId?: string; from?: Date; to?: Date; staleBefore?: Date; source?: string };

export const ORDER_SORTS: Record<string, (dir: SortDir) => Record<string, unknown>> = {
  reference: (d) => ({ reference: d }), customer: (d) => ({ customer: { name: d } }), status: (d) => ({ status: d }), salesperson: (d) => ({ salesperson: { name: d } }),
  total: (d) => ({ total: d }), created: (d) => ({ createdAt: d }), updated: (d) => ({ updatedAt: d }),
};

/** "open" is a pseudo-status meaning every order still in play (before READY_TO_INVOICE). */
export function orderWhere(f: OrderFilters): Prisma.CustomerOrderWhereInput {
  const created = f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {};
  return {
    ...(f.status === "open" ? { status: { in: [...OPEN_ORDER_STATUSES] } } : f.status && (ORDER_STATUSES as readonly string[]).includes(f.status) ? { status: f.status as never } : {}),
    ...(f.unassigned ? { salespersonId: null } : f.salespersonId ? { salespersonId: f.salespersonId } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.source ? { source: f.source as never } : {}),
    ...created,
    ...(f.staleBefore ? { updatedAt: { lt: f.staleBefore } } : {}),
    ...(f.q ? { OR: [{ reference: { contains: f.q, mode: "insensitive" } }, { customerPoReference: { contains: f.q, mode: "insensitive" } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
}

/**
 * The order's CURRENT stage as an admin status key ("INVOICED", "DISPATCHED", "DELIVERED", "COMPLETED"...),
 * derived by the same getEffectiveOrderStatus every operational page uses, so Admin can never show
 * "Ready to Invoice" for an order that has already been invoiced, dispatched or delivered.
 */
function effectiveStatusKey(input: EffectiveOrderStatusInput): string {
  return getEffectiveOrderStatus(input).label.toUpperCase().replace(/\s+/g, "_");
}

export async function listAdminOrders(f: OrderFilters, page: number, pageSize: number, sort: SortState = { key: "created", dir: "desc" }) {
  const where = orderWhere(f);
  const [total, rows] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({
      where,
      orderBy: orderByFor(sort, ORDER_SORTS, "created") as Prisma.CustomerOrderOrderByWithRelationInput[],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: { id: true, reference: true, status: true, source: true, currency: true, total: true, createdAt: true, updatedAt: true, customerPoReference: true, customer: { select: { id: true, name: true } }, salesperson: { select: { id: true, name: true } }, _count: { select: { lines: true } },
        // Lines come back in the SAME query (no per-order lookups) so the total is derived by the shared calculation.
        lines: { select: { requestedQuantity: true, customerUnitPrice: true, approvedUnitPrice: true, product: { select: { vatCode: true } } } },
        // Dispatch states for the derived (dynamic) status below -- same query, no per-order lookups.
        dispatchRecords: { where: { status: { not: "CANCELLED" } }, select: { status: true } } },
    }),
  ]);
  // One query for every VAT code on the page, one for invoice progress of the READY_TO_INVOICE rows.
  const taxRates = await loadTaxRatesByCode(rows.flatMap((r) => r.lines.map((l) => l.product?.vatCode)));
  const progress = await loadOrderProgress(rows.filter((r) => r.status === "READY_TO_INVOICE").map((r) => r.id));
  return {
    total,
    rows: rows.map(({ lines, dispatchRecords, total: storedTotal, ...r }) => ({
      ...r,
      effectiveStatus: effectiveStatusKey({ status: r.status, dispatchStatuses: dispatchRecords.map((d) => d.status), invoiceState: progress.get(r.id)?.invoiceState, completed: progress.get(r.id)?.completed }),
      total: storedTotal === null ? null : storedTotal.toString(),
      orderTotal: summariseOrderTotal({ storedTotal, currency: r.currency, pricing: pricingFromLines(lines, taxRates) }),
      lineCount: r._count.lines,
    })),
  };
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
      id: true, reference: true, status: true, source: true, currency: true, subtotal: true, taxTotal: true, total: true, customerPoReference: true, orderDate: true, requestedDeliveryDate: true, deliveryAddress: true, internalNotes: true, createdAt: true, updatedAt: true, handedToSapAt: true, invoicedAt: true, receivedAt: true, approvedAt: true, isDemo: true,
      customer: { select: { id: true, name: true, sapCustomerCode: true } }, salesperson: { select: { id: true, name: true, status: true } }, createdBy: { select: { name: true } },
      _count: { select: { lines: true, documents: true } },
      statusHistory: { orderBy: { createdAt: "desc" }, take: 50, select: { id: true, fromStatus: true, toStatus: true, notes: true, createdAt: true, changedBy: { select: { name: true } } } },
      sourceQuotation: { select: { id: true, quotationNumber: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true, lineNumber: true, originalProductDescription: true, sapItemCodeSnapshot: true, requestedQuantity: true, requestedUnitCode: true, customerUnitPrice: true, approvedUnitPrice: true, lineTotal: true, salesNotes: true,
          product: { select: { id: true, itemName: true, vatCode: true } },
        },
      },
      documents: { orderBy: { createdAt: "desc" }, select: { id: true, originalFileName: true, mimeType: true, fileSize: true, documentType: true, classification: true, status: true, createdAt: true, uploadedBy: { select: { name: true } } } },
      approvals: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, notes: true, decidedAt: true, createdAt: true, decidedBy: { select: { name: true } } } },
      approvalRequests: { orderBy: { submittedAt: "desc" }, select: { id: true, status: true, actionType: true, requiredApproverRole: true, submittedAt: true, decidedAt: true, decisionReason: true, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } } },
      pickingSessions: { orderBy: { startedAt: "desc" }, select: { id: true, status: true, startedAt: true, completedAt: true, authorizedAt: true, notes: true, startedBy: { select: { name: true } }, authorizedBy: { select: { name: true } }, _count: { select: { lines: true } } } },
      handovers: { orderBy: { createdAt: "desc" }, select: { id: true, reference: true, format: true, lineCount: true, matchedLineCount: true, unmatchedLineCount: true, createdAt: true, generatedBy: { select: { name: true } } } },
      dispatchRecords: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, plannedDepartureAt: true, departedAt: true, cancellationReason: true, driver: { select: { name: true } }, assistant: { select: { name: true } }, vehicle: { select: { registrationNumber: true } }, deliveryRecord: { select: { outcome: true, recordedAt: true, recipientName: true, notes: true } } } },
      matchedSapInvoices: { orderBy: { createdAt: "desc" }, select: { id: true, sapDocNum: true, invoiceDate: true, currencyCode: true, total: true, reconciliationStatus: true } },
      invoiceClaims: { orderBy: { createdAt: "desc" }, select: { id: true, claimReference: true, status: true, category: true } },
      integrationOperation: { select: { status: true, externalDocNum: true, attemptCount: true, lastAttemptAt: true, lastErrorMessage: true } },
    },
  });
  if (!order) return null;
  const [facts, deletion] = await Promise.all([guardFacts(prisma, id), getOrderDeletionImpact(id)]);
  const history = await prisma.auditEvent.findMany({ where: { entityType: "CustomerOrder", entityId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, beforeData: true, afterData: true, createdAt: true, actor: { select: { name: true } } } });
  const none = { ok: false as const, message: "" };
  const taxRates = await loadTaxRatesByCode(order.lines.map((l) => l.product?.vatCode));
  const pricing = pricingFromLines(order.lines, taxRates);
  const orderProgress = await loadSingleOrderProgress(id);
  return {
    effectiveStatus: effectiveStatusKey({ status: order.status, dispatchStatuses: order.dispatchRecords.filter((d) => d.status !== "CANCELLED").map((d) => d.status), invoiceState: orderProgress.invoiceState, completed: orderProgress.completed }),
    pricing,
    orderTotal: summariseOrderTotal({ storedTotal: order.total, currency: order.currency, pricing }),
    order: { ...order, documents: order.documents.map((d) => ({ ...d, fileSize: Number(d.fileSize) })) },
    history,
    canEdit: facts ? checkOrderEditable(facts) : none,
    canCancel: facts ? checkOrderCancellable(facts) : none,
    canReopen: facts ? checkOrderReopenable(facts) : none,
    canDelete: deletion?.verdict ?? ({ deletable: false, reason: "", blockers: [] } as const),
  };
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
