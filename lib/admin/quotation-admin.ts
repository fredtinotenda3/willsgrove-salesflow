import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { orderByFor, type SortDir, type SortState } from "./list-query";

/**
 * Read model for the administration view of quotations. Quotations are
 * changed through the existing quotation lifecycle services (issue, cancel,
 * expire, revise, convert) so approval gates and revision history are never
 * bypassed; this file only reads.
 */
export const QUOTATION_STATUSES = ["DRAFT", "ISSUED", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"] as const;

export type QuotationFilters = { q?: string; status?: string; salespersonId?: string; customerId?: string; from?: Date; to?: Date; expiringBefore?: Date; includeSuperseded?: boolean; open?: boolean };

export const QUOTATION_SORTS: Record<string, (d: SortDir) => Record<string, unknown>> = {
  number: (d) => ({ quotationNumber: d }), customer: (d) => ({ customer: { name: d } }), status: (d) => ({ status: d }), salesperson: (d) => ({ salesperson: { name: d } }),
  total: (d) => ({ total: d }), valid: (d) => ({ validUntil: d }), created: (d) => ({ createdAt: d }),
};

export function quotationWhere(f: QuotationFilters): Prisma.QuotationWhereInput {
  return {
    ...(f.includeSuperseded ? {} : { supersededAt: null }),
    ...(f.status && (QUOTATION_STATUSES as readonly string[]).includes(f.status) ? { status: f.status as never } : {}),
    ...(f.salespersonId ? { salespersonId: f.salespersonId } : {}),
    ...(f.open ? { status: { in: ["DRAFT", "ISSUED"] as const } } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.expiringBefore ? { status: "ISSUED" as const, validUntil: { lt: f.expiringBefore } } : {}),
    ...(f.q ? { OR: [{ quotationNumber: { contains: f.q, mode: "insensitive" } }, { customerReference: { contains: f.q, mode: "insensitive" } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
}

export async function listAdminQuotations(f: QuotationFilters, page: number, pageSize: number, sort: SortState = { key: "created", dir: "desc" }) {
  const where = quotationWhere(f);
  const [total, rows] = await Promise.all([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where, orderBy: orderByFor(sort, QUOTATION_SORTS, "created") as Prisma.QuotationOrderByWithRelationInput[], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, quotationNumber: true, revisionNumber: true, status: true, currency: true, total: true, validUntil: true, createdAt: true, convertedOrderId: true, supersededAt: true, customer: { select: { id: true, name: true } }, salesperson: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
    }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, total: r.total.toString(), lineCount: r._count.lines })) };
}

export async function getAdminQuotationDetail(id: string) {
  const q = await prisma.quotation.findUnique({
    where: { id },
    select: {
      id: true, quotationNumber: true, revisionNumber: true, rootQuotationId: true, status: true, currency: true, quotationDate: true, validUntil: true, customerReference: true, internalNotes: true, customerNotes: true,
      subtotal: true, discountTotal: true, vatTotal: true, total: true, issuedAt: true, respondedAt: true, responseNotes: true, rejectionReason: true, expiredAt: true, cancelledAt: true, cancellationReason: true, convertedOrderId: true, convertedAt: true, supersededAt: true, createdAt: true, nextFollowUpDate: true,
      customer: { select: { id: true, name: true, sapCustomerCode: true } }, salesperson: { select: { id: true, name: true, status: true } }, preparedBy: { select: { name: true } }, issuedBy: { select: { name: true } },
      convertedOrder: { select: { id: true, reference: true, status: true } },
      lines: { orderBy: { lineNumber: "asc" }, select: { id: true, lineNumber: true, sapItemCodeSnapshot: true, sapItemDescriptionSnapshot: true, unlistedItemDescription: true, isUnlistedItem: true, quantity: true, unitOfMeasure: true, unitPrice: true, discountPercent: true, vatRatePercentSnapshot: true, lineSubtotal: true, discountAmount: true, vatAmount: true, lineTotal: true } },
      events: { orderBy: { createdAt: "desc" }, select: { id: true, eventType: true, notes: true, createdAt: true, actor: { select: { name: true } } } },
    },
  });
  if (!q) return null;
  const rootId = q.rootQuotationId ?? q.id;
  const [revisions, approvals, history] = await Promise.all([
    prisma.quotation.findMany({ where: { OR: [{ id: rootId }, { rootQuotationId: rootId }] }, orderBy: { revisionNumber: "asc" }, select: { id: true, quotationNumber: true, revisionNumber: true, status: true, total: true, currency: true, createdAt: true, supersededAt: true } }),
    prisma.approvalRequest.findMany({ where: { quotationId: id }, orderBy: { submittedAt: "desc" }, select: { id: true, status: true, actionType: true, requiredApproverRole: true, submittedAt: true, decidedAt: true, decisionReason: true, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } } } }),
    prisma.auditEvent.findMany({ where: { entityType: "Quotation", entityId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, beforeData: true, afterData: true, createdAt: true, actor: { select: { name: true } } } }),
  ]);
  const cancellable = (q.status === "DRAFT" || q.status === "ISSUED") && !q.convertedOrderId && !q.supersededAt;
  return { quotation: q, revisions, approvals, history, cancellable, expirable: q.status === "ISSUED" && !q.convertedOrderId && !q.supersededAt };
}
