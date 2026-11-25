import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeClaimFinancialSummary } from "@/lib/invoice-claims/financial";
import { orderByFor, type SortDir, type SortState } from "./list-query";

/**
 * Read models for the financial-control workspaces (SAP invoices, import
 * batches, claims, credit notes, returns). Imported SAP data is never edited
 * here: corrections go through the existing reconciliation / claim / credit
 * note workflows, and exposure figures come from lib/invoice-claims/financial
 * (the same calculation the claims dashboard uses).
 */
export const INVOICE_RECON_STATUSES = ["UNMATCHED", "PARTIALLY_MATCHED", "RECONCILIATION_REQUIRED", "MATCHED", "CANCELLED_REVERSED"] as const;
export const CLAIM_STATUSES = ["OPEN", "UNDER_INVESTIGATION", "AWAITING_CUSTOMER", "AWAITING_INTERNAL_ACTION", "APPROVED", "PARTIALLY_RESOLVED", "RESOLVED", "REJECTED", "CLOSED"] as const;
export const CONCLUDED_CLAIM = ["RESOLVED", "REJECTED", "CLOSED"] as const;
const dec = (v: Prisma.Decimal | null | undefined) => (v === null || v === undefined ? null : v.toString());

/* -------------------------------- invoices ------------------------------- */

export type InvoiceFilters = { q?: string; status?: string; batchId?: string; customerId?: string; from?: Date; to?: Date; withUnmatchedLines?: boolean };

export const INVOICE_SORTS: Record<string, (d: SortDir) => Record<string, unknown>> = {
  number: (d) => ({ sapDocNum: d }), customer: (d) => ({ customerName: d }), date: (d) => ({ invoiceDate: d }), total: (d) => ({ total: d }), status: (d) => ({ reconciliationStatus: d }), imported: (d) => ({ createdAt: d }),
};

export function invoiceWhere(f: InvoiceFilters): Prisma.SapInvoiceWhereInput {
  return {
    ...(f.status && (INVOICE_RECON_STATUSES as readonly string[]).includes(f.status) ? { reconciliationStatus: f.status as never } : {}),
    ...(f.batchId ? { importBatchId: f.batchId } : {}),
    ...(f.customerId ? { matchedCustomerId: f.customerId } : {}),
    ...(f.from || f.to ? { invoiceDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.withUnmatchedLines ? { lines: { some: { matchStatus: "UNMATCHED" as const } } } : {}),
    ...(f.q ? { OR: [{ sapDocNum: { contains: f.q, mode: "insensitive" } }, { customerName: { contains: f.q, mode: "insensitive" } }, { customerSapCode: { contains: f.q, mode: "insensitive" } }, { sapOrderReference: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
}

export async function listAdminInvoices(f: InvoiceFilters, page: number, pageSize: number, sort: SortState = { key: "imported", dir: "desc" }) {
  const where = invoiceWhere(f);
  const [total, rows] = await Promise.all([
    prisma.sapInvoice.count({ where }),
    prisma.sapInvoice.findMany({
      where, orderBy: orderByFor(sort, INVOICE_SORTS, "imported") as Prisma.SapInvoiceOrderByWithRelationInput[], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, sapDocNum: true, customerName: true, customerSapCode: true, invoiceDate: true, currencyCode: true, total: true, reconciliationStatus: true, isCancelledOrReversed: true, createdAt: true, matchedOrder: { select: { id: true, reference: true } }, importBatch: { select: { id: true, originalFileName: true } }, _count: { select: { lines: true, claims: true } } },
    }),
  ]);
  const unmatched = rows.length ? await prisma.sapInvoiceLine.groupBy({ by: ["sapInvoiceId"], where: { sapInvoiceId: { in: rows.map((r) => r.id) }, matchStatus: "UNMATCHED" }, _count: { _all: true } }) : [];
  const unmatchedBy = new Map(unmatched.map((u) => [u.sapInvoiceId, u._count._all]));
  return { total, rows: rows.map((r) => ({ ...r, total: dec(r.total), lineCount: r._count.lines, claimCount: r._count.claims, unmatchedLines: unmatchedBy.get(r.id) ?? 0 })) };
}

export async function getAdminInvoiceDetail(id: string) {
  const inv = await prisma.sapInvoice.findUnique({
    where: { id },
    select: {
      id: true, sapDocNum: true, sapDocEntry: true, customerSapCode: true, customerName: true, invoiceDate: true, currencyCode: true, documentStatusRaw: true, isCancelledOrReversed: true, sapOrderReference: true, subtotal: true, taxTotal: true, total: true, reconciliationStatus: true, reconciliationNotes: true, createdAt: true, isDemo: true,
      importBatch: { select: { id: true, originalFileName: true, createdAt: true, uploadedBy: { select: { name: true } } } },
      matchedCustomer: { select: { id: true, name: true } }, matchedOrder: { select: { id: true, reference: true, status: true } },
      lines: { orderBy: { lineNumber: "asc" }, select: { id: true, lineNumber: true, sapItemCode: true, sapItemDescription: true, quantityInvoiced: true, unitOfMeasure: true, unitPrice: true, discount: true, taxCode: true, lineTotal: true, matchStatus: true, matchMethod: true, matchNote: true, matchedAt: true, matchedBy: { select: { name: true } }, matchedOrder: { select: { id: true, reference: true } }, matchedOrderLine: { select: { lineNumber: true } } } },
      claims: { orderBy: { createdAt: "desc" }, select: { id: true, claimReference: true, status: true, category: true } },
      creditNotes: { orderBy: { createdAt: "desc" }, select: { id: true, sapCreditNoteDocNum: true, amount: true, currencyCode: true, matchStatus: true, creditNoteDate: true } },
      deliveryRecord: { select: { outcome: true, podReference: true, notes: true, recordedAt: true, recordedBy: { select: { name: true } } } },
    },
  });
  if (!inv) return null;
  const lineStatus = new Map<string, number>();
  for (const l of inv.lines) lineStatus.set(l.matchStatus, (lineStatus.get(l.matchStatus) ?? 0) + 1);
  return { invoice: inv, lineStatusCounts: Object.fromEntries(lineStatus) };
}

export async function listImportBatches(page: number, pageSize: number) {
  const [total, rows] = await Promise.all([
    prisma.sapInvoiceImportBatch.count(),
    prisma.sapInvoiceImportBatch.findMany({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, originalFileName: true, totalRows: true, importedInvoiceCount: true, importedLineCount: true, duplicateRowCount: true, invalidRowCount: true, createdAt: true, uploadedBy: { select: { name: true } } } }),
  ]);
  const ids = rows.map((r) => r.id);
  const open = ids.length ? await prisma.sapInvoice.groupBy({ by: ["importBatchId"], where: { importBatchId: { in: ids }, reconciliationStatus: { in: ["UNMATCHED", "PARTIALLY_MATCHED", "RECONCILIATION_REQUIRED"] } }, _count: { _all: true } }) : [];
  const openBy = new Map(open.map((o) => [o.importBatchId, o._count._all]));
  return { total, rows: rows.map((r) => ({ ...r, openExceptions: openBy.get(r.id) ?? 0 })) };
}

/* --------------------------------- claims -------------------------------- */

export type ClaimFilters = { q?: string; status?: string; assigneeId?: string; unassigned?: boolean; priority?: string; category?: string; customerId?: string; openOnly?: boolean; from?: Date; to?: Date };

export const CLAIM_SORTS: Record<string, (d: SortDir) => Record<string, unknown>> = {
  reference: (d) => ({ claimReference: d }), customer: (d) => ({ customer: { name: d } }), status: (d) => ({ status: d }), priority: (d) => ({ priority: d }), owner: (d) => ({ assignedTo: { name: d } }), date: (d) => ({ claimDate: d }), created: (d) => ({ createdAt: d }),
};

export function claimWhere(f: ClaimFilters): Prisma.InvoiceClaimWhereInput {
  return {
    ...(f.status && (CLAIM_STATUSES as readonly string[]).includes(f.status) ? { status: f.status as never } : f.openOnly ? { status: { notIn: [...CONCLUDED_CLAIM] } } : {}),
    ...(f.unassigned ? { assignedToId: null } : f.assigneeId ? { assignedToId: f.assigneeId } : {}),
    ...(f.priority ? { priority: f.priority as never } : {}),
    ...(f.category ? { category: f.category as never } : {}),
    ...(f.customerId ? { customerId: f.customerId } : {}),
    ...(f.from || f.to ? { claimDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q ? { OR: [{ claimReference: { contains: f.q, mode: "insensitive" } }, { customerComplaintReference: { contains: f.q, mode: "insensitive" } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }, { sapInvoice: { sapDocNum: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
}

export async function listAdminClaims(f: ClaimFilters, page: number, pageSize: number, sort: SortState = { key: "created", dir: "desc" }) {
  const where = claimWhere(f);
  const [total, rows] = await Promise.all([
    prisma.invoiceClaim.count({ where }),
    prisma.invoiceClaim.findMany({
      where, orderBy: orderByFor(sort, CLAIM_SORTS, "created") as Prisma.InvoiceClaimOrderByWithRelationInput[], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, claimReference: true, status: true, priority: true, category: true, claimDate: true, createdAt: true, customer: { select: { id: true, name: true } }, assignedTo: { select: { id: true, name: true } }, sapInvoice: { select: { id: true, sapDocNum: true, currencyCode: true } }, _count: { select: { lines: true, resolutions: true } } },
    }),
  ]);
  return { total, rows };
}

export async function getAdminClaimDetail(id: string) {
  const claim = await prisma.invoiceClaim.findUnique({
    where: { id },
    select: {
      id: true, claimReference: true, customerComplaintReference: true, category: true, description: true, priority: true, claimDate: true, status: true, resolvedAt: true, closedAt: true, customerCommunicationNotes: true, createdAt: true,
      customer: { select: { id: true, name: true } }, order: { select: { id: true, reference: true } }, sapInvoice: { select: { id: true, sapDocNum: true, currencyCode: true, total: true } },
      reportedBy: { select: { name: true } }, assignedTo: { select: { id: true, name: true, status: true } },
      lines: { select: { id: true, sapItemCodeSnapshot: true, sapItemDescriptionSnapshot: true, disputeType: true, acceptedQuantity: true, rejectedQuantity: true, disputedAmount: true, reason: true, investigationOutcome: true } },
      resolutions: { orderBy: { recordedAt: "desc" }, select: { id: true, decision: true, decisionDetail: true, findings: true, rootCause: true, responsibleDepartment: true, recordedAt: true, approvedAt: true, approvedCreditAmount: true, rejectedAt: true, rejectionReason: true, recordedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, rejectedBy: { select: { name: true } } } },
      attachments: { orderBy: { uploadedAt: "desc" }, select: { id: true, originalFileName: true, mimeType: true, fileSize: true, uploadedAt: true, uploadedBy: { select: { name: true } } } },
      creditNotes: { orderBy: { createdAt: "desc" }, select: { id: true, sapCreditNoteDocNum: true, amount: true, currencyCode: true, matchStatus: true, creditNoteDate: true } },
      returns: { orderBy: { receivedAt: "desc" }, select: { id: true, returnReference: true, receivedQuantity: true, condition: true, receivedDate: true, receivedBy: { select: { name: true } } } },
    },
  });
  if (!claim) return null;
  const [financial, history] = await Promise.all([
    computeClaimFinancialSummary(id),
    prisma.auditEvent.findMany({ where: { entityType: "InvoiceClaim", entityId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, beforeData: true, afterData: true, createdAt: true, actor: { select: { name: true } } } }),
  ]);
  return { claim: { ...claim, attachments: claim.attachments.map((a) => ({ ...a, fileSize: Number(a.fileSize) })) }, financial, history };
}

/* ------------------------------ credit notes ----------------------------- */

export type CreditNoteFilters = { q?: string; status?: string; from?: Date; to?: Date };
const CN_SORTS: Record<string, (d: SortDir) => Record<string, unknown>> = { number: (d) => ({ sapCreditNoteDocNum: d }), amount: (d) => ({ amount: d }), date: (d) => ({ creditNoteDate: d }), status: (d) => ({ matchStatus: d }), created: (d) => ({ createdAt: d }) };
export const CREDIT_NOTE_SORT_KEYS = Object.keys(CN_SORTS);

export async function listAdminCreditNotes(f: CreditNoteFilters, page: number, pageSize: number, sort: SortState = { key: "created", dir: "desc" }) {
  const where: Prisma.CreditNoteWhereInput = {
    ...(f.status ? { matchStatus: f.status as never } : {}),
    ...(f.from || f.to ? { creditNoteDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q ? { OR: [{ sapCreditNoteDocNum: { contains: f.q, mode: "insensitive" } }, { sapInvoice: { sapDocNum: { contains: f.q, mode: "insensitive" } } }, { claim: { claimReference: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.creditNote.count({ where }),
    prisma.creditNote.findMany({ where, orderBy: orderByFor(sort, CN_SORTS, "created") as Prisma.CreditNoteOrderByWithRelationInput[], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, sapCreditNoteDocNum: true, amount: true, currencyCode: true, matchStatus: true, creditNoteDate: true, createdAt: true, sapInvoice: { select: { id: true, sapDocNum: true } }, claim: { select: { id: true, claimReference: true } } } }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, amount: r.amount.toString() })) };
}

/* --------------------------------- returns ------------------------------- */

export type ReturnFilters = { q?: string; condition?: string; from?: Date; to?: Date };
const RET_SORTS: Record<string, (d: SortDir) => Record<string, unknown>> = { reference: (d) => ({ returnReference: d }), quantity: (d) => ({ receivedQuantity: d }), received: (d) => ({ receivedDate: d }), condition: (d) => ({ condition: d }) };
export const RETURN_SORT_KEYS = Object.keys(RET_SORTS);

export async function listAdminReturns(f: ReturnFilters, page: number, pageSize: number, sort: SortState = { key: "received", dir: "desc" }) {
  const where: Prisma.ClaimReturnWhereInput = {
    ...(f.condition ? { condition: f.condition as never } : {}),
    ...(f.from || f.to ? { receivedDate: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q ? { OR: [{ returnReference: { contains: f.q, mode: "insensitive" } }, { claim: { claimReference: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.claimReturn.count({ where }),
    prisma.claimReturn.findMany({ where, orderBy: orderByFor(sort, RET_SORTS, "received") as Prisma.ClaimReturnOrderByWithRelationInput[], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, returnReference: true, receivedQuantity: true, condition: true, receivedDate: true, claim: { select: { id: true, claimReference: true, customer: { select: { name: true } } } }, claimLine: { select: { sapItemCodeSnapshot: true, sapItemDescriptionSnapshot: true } }, creditNote: { select: { id: true, sapCreditNoteDocNum: true } }, receivedBy: { select: { name: true } } } }),
  ]);
  return { total, rows: rows.map((r) => ({ ...r, receivedQuantity: r.receivedQuantity.toString() })) };
}
