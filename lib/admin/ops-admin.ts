import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { orderByFor, type SortDir, type SortState } from "./list-query";

/**
 * Read models for the operational control areas: approvals, stock snapshots,
 * dispatch / delivery, SAP integration and communications. Everything here is
 * read-only over the shared tables; changes (retry, resend, policy edits) go
 * through the existing operational endpoints so there is one approval engine,
 * one outbox and one communications dispatcher.
 */

/* -------------------------------- approvals ------------------------------ */

export type ApprovalFilters = { q?: string; status?: string; module?: string; from?: Date; to?: Date };
const APPROVAL_SORTS: Record<string, (d: SortDir) => Record<string, unknown>> = { submitted: (d) => ({ submittedAt: d }), status: (d) => ({ status: d }), module: (d) => ({ module: d }), decided: (d) => ({ decidedAt: d }) };
export const APPROVAL_SORT_KEYS = Object.keys(APPROVAL_SORTS);

export async function listAdminApprovals(f: ApprovalFilters, page: number, pageSize: number, sort: SortState = { key: "submitted", dir: "desc" }) {
  const where: Prisma.ApprovalRequestWhereInput = {
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.module ? { module: f.module as never } : {}),
    ...(f.from || f.to ? { submittedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q ? { OR: [{ quotation: { quotationNumber: { contains: f.q, mode: "insensitive" } } }, { customerOrder: { reference: { contains: f.q, mode: "insensitive" } } }, { requestedBy: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.approvalRequest.count({ where }),
    prisma.approvalRequest.findMany({ where, orderBy: orderByFor(sort, APPROVAL_SORTS, "submitted") as Prisma.ApprovalRequestOrderByWithRelationInput[], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, module: true, actionType: true, status: true, requiredApproverRole: true, submittedAt: true, decidedAt: true, decisionReason: true, requestedBy: { select: { name: true } }, decidedBy: { select: { name: true } }, quotation: { select: { id: true, quotationNumber: true } }, customerOrder: { select: { id: true, reference: true } }, policy: { select: { name: true } } } }),
  ]);
  return { total, rows };
}

export async function listAdminApprovalPolicies() {
  return prisma.approvalPolicy.findMany({ orderBy: [{ active: "desc" }, { module: "asc" }, { name: "asc" }], select: { id: true, module: true, actionType: true, name: true, description: true, thresholdPercent: true, thresholdAmount: true, currency: true, requiredApproverRole: true, allowRequesterSelfApprove: true, isMandatory: true, overdueAfterHours: true, effectiveFrom: true, effectiveTo: true, active: true, _count: { select: { requests: true } } } });
}

/** Pending requests older than the policy's own overdue window (policies without a window are never "overdue"). */
export async function countOverdueApprovals(now = new Date()): Promise<number> {
  const pending = await prisma.approvalRequest.findMany({ where: { status: "PENDING", policy: { overdueAfterHours: { not: null } } }, select: { submittedAt: true, policy: { select: { overdueAfterHours: true } } } });
  return pending.filter((p) => p.policy?.overdueAfterHours && now.getTime() - p.submittedAt.getTime() > p.policy.overdueAfterHours * 3600_000).length;
}

/* ----------------------------------- stock ------------------------------- */

export async function listStockSnapshots(page: number, pageSize: number) {
  const [total, rows] = await Promise.all([
    prisma.stockSnapshot.count(),
    prisma.stockSnapshot.findMany({ orderBy: [{ snapshotAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, snapshotAt: true, sourceFileName: true, importedAt: true, notes: true, _count: { select: { lines: true } } } }),
  ]);
  return { total, rows };
}

export async function getStockSnapshotDetail(id: string, q: string | undefined, page: number, pageSize: number) {
  const snap = await prisma.stockSnapshot.findUnique({ where: { id }, select: { id: true, snapshotAt: true, sourceFileName: true, importedAt: true, notes: true } });
  if (!snap) return null;
  const where: Prisma.StockSnapshotLineWhereInput = { snapshotId: id, ...(q ? { OR: [{ product: { sapItemCode: { contains: q, mode: "insensitive" } } }, { product: { itemName: { contains: q, mode: "insensitive" } } }, { warehouseCode: { contains: q, mode: "insensitive" } }] } : {}) };
  const [total, lines, warehouses] = await Promise.all([
    prisma.stockSnapshotLine.count({ where }),
    prisma.stockSnapshotLine.findMany({ where, orderBy: [{ product: { sapItemCode: "asc" } }, { warehouseCode: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, warehouseCode: true, warehouseName: true, quantity: true, unitCode: true, product: { select: { id: true, sapItemCode: true, itemName: true } } } }),
    prisma.stockSnapshotLine.groupBy({ by: ["warehouseCode"], where: { snapshotId: id }, _count: { _all: true } }),
  ]);
  return { snapshot: snap, total, lines: lines.map((l) => ({ ...l, quantity: l.quantity.toString() })), warehouses: warehouses.map((w) => ({ code: w.warehouseCode, lines: w._count._all })) };
}

/* ------------------------------ dispatch / delivery ---------------------- */

export type DispatchFilters = { q?: string; status?: string; outcome?: string; from?: Date; to?: Date };
const DISPATCH_SORTS: Record<string, (d: SortDir) => Record<string, unknown>> = { created: (d) => ({ createdAt: d }), status: (d) => ({ status: d }), departed: (d) => ({ departedAt: d }), order: (d) => ({ order: { reference: d } }) };
export const DISPATCH_SORT_KEYS = Object.keys(DISPATCH_SORTS);

export async function listAdminDispatches(f: DispatchFilters, page: number, pageSize: number, sort: SortState = { key: "created", dir: "desc" }) {
  const where: Prisma.DispatchRecordWhereInput = {
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.outcome ? { deliveryRecord: { outcome: f.outcome as never } } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q ? { OR: [{ order: { reference: { contains: f.q, mode: "insensitive" } } }, { order: { customer: { name: { contains: f.q, mode: "insensitive" } } } }, { vehicle: { registrationNumber: { contains: f.q, mode: "insensitive" } } }, { driver: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.dispatchRecord.count({ where }),
    prisma.dispatchRecord.findMany({ where, orderBy: orderByFor(sort, DISPATCH_SORTS, "created") as Prisma.DispatchRecordOrderByWithRelationInput[], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, status: true, plannedDepartureAt: true, departedAt: true, cancellationReason: true, createdAt: true, order: { select: { id: true, reference: true, customer: { select: { name: true } } } }, driver: { select: { name: true } }, assistant: { select: { name: true } }, vehicle: { select: { registrationNumber: true } }, deliveryRecord: { select: { outcome: true, recordedAt: true, recipientName: true } }, _count: { select: { lines: true } } } }),
  ]);
  return { total, rows };
}

/* --------------------------------- integrations -------------------------- */

const mask = (v: string | null) => (v ? `${v.slice(0, 2)}${"•".repeat(Math.max(3, Math.min(8, v.length - 2)))}` : null);

/** Connection state for display. Only non-secret fields are selected and the username is masked; credentials live in the server environment and are never read here. */
export async function getIntegrationConnection() {
  const c = await prisma.integrationConnection.findFirst({ select: { provider: true, mode: true, enabled: true, baseUrl: true, companyDb: true, username: true, lastTestedAt: true, lastTestOk: true, lastTestMessage: true, lastConnectionHealthCheckedAt: true, updatedAt: true, updatedBy: { select: { name: true } } } });
  return c ? { ...c, username: mask(c.username) } : null;
}

export async function listSyncJobs(f: { status?: string; type?: string }, page: number, pageSize: number) {
  const where: Prisma.IntegrationSyncJobWhereInput = { ...(f.status ? { status: f.status as never } : {}), ...(f.type ? { jobType: f.type as never } : {}) };
  const [total, rows] = await Promise.all([
    prisma.integrationSyncJob.count({ where }),
    prisma.integrationSyncJob.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, jobType: true, status: true, trigger: true, startedAt: true, completedAt: true, errorMessage: true, summary: true, createdAt: true, triggeredBy: { select: { name: true } } } }),
  ]);
  return { total, rows };
}

export async function listOperations(f: { status?: string }, page: number, pageSize: number) {
  const where: Prisma.IntegrationOperationWhereInput = f.status ? { status: f.status as never } : {};
  const [total, rows] = await Promise.all([
    prisma.integrationOperation.count({ where }),
    prisma.integrationOperation.findMany({ where, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, operationType: true, status: true, attemptCount: true, lastAttemptAt: true, lastErrorCategory: true, lastErrorMessage: true, externalDocNum: true, resolvedAt: true, updatedAt: true, customerOrder: { select: { id: true, reference: true, customer: { select: { name: true } } } } } }),
  ]);
  return { total, rows };
}

export async function integrationHealth() {
  const [failedJobs, failedOps, uncertainOps, lastJob] = await Promise.all([
    prisma.integrationSyncJob.count({ where: { status: { in: ["FAILED", "PARTIAL"] } } }),
    prisma.integrationOperation.count({ where: { status: "FAILED" } }),
    prisma.integrationOperation.count({ where: { status: "UNCERTAIN" } }),
    prisma.integrationSyncJob.findFirst({ where: { status: { in: ["COMPLETED", "PARTIAL"] } }, orderBy: { completedAt: "desc" }, select: { completedAt: true, jobType: true } }),
  ]);
  return { failedJobs, failedOps, uncertainOps, lastSuccessfulSync: lastJob };
}

/* ------------------------------- communications -------------------------- */

export type IntakeFilters = { q?: string; status?: string; channel?: string; from?: Date; to?: Date };

export async function listMessageIntakes(f: IntakeFilters, page: number, pageSize: number) {
  const where: Prisma.MessageIntakeWhereInput = {
    ...(f.status ? { status: f.status as never } : {}), ...(f.channel ? { channel: f.channel as never } : {}),
    ...(f.from || f.to ? { receivedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q ? { OR: [{ fromAddress: { contains: f.q, mode: "insensitive" } }, { subject: { contains: f.q, mode: "insensitive" } }, { fromDisplayName: { contains: f.q, mode: "insensitive" } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.messageIntake.count({ where }),
    prisma.messageIntake.findMany({ where, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, channel: true, fromAddress: true, fromDisplayName: true, subject: true, status: true, receivedAt: true, customer: { select: { id: true, name: true } }, linkedOrder: { select: { id: true, reference: true } }, _count: { select: { attachments: true } } } }),
  ]);
  return { total, rows };
}

export type OutboundFilters = { q?: string; status?: string; type?: string; channel?: string; from?: Date; to?: Date };

export async function listOutboundMessages(f: OutboundFilters, page: number, pageSize: number) {
  const where: Prisma.OutboundMessageWhereInput = {
    ...(f.status ? { status: f.status as never } : {}), ...(f.type ? { type: f.type as never } : {}), ...(f.channel ? { channel: f.channel as never } : {}),
    ...(f.from || f.to ? { createdAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
    ...(f.q ? { OR: [{ toAddress: { contains: f.q, mode: "insensitive" } }, { subject: { contains: f.q, mode: "insensitive" } }, { customer: { name: { contains: f.q, mode: "insensitive" } } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.outboundMessage.count({ where }),
    prisma.outboundMessage.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, type: true, channel: true, status: true, toAddress: true, subject: true, attemptCount: true, lastErrorMessage: true, sentAt: true, createdAt: true, customer: { select: { id: true, name: true } }, relatedOrder: { select: { id: true, reference: true } }, relatedQuotation: { select: { id: true, quotationNumber: true } } } }),
  ]);
  return { total, rows };
}
