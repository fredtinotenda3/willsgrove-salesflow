import "server-only";
import { prisma } from "@/lib/prisma";
import { checkOrderEligibility } from "@/lib/integrations/sap/order-eligibility";
import { getOrCreateConnection } from "@/lib/integrations/sap/connection";
import { isSapRunningInMockMode } from "@/lib/integrations/sap/get-adapter";

/**
 * Milestone 9 (SAP Business One Integration). Read-side queries for the
 * /integrations/sap/* dashboard (spec section 13) and for a single
 * order's SAP status. Nothing here writes; nothing here duplicates a
 * value that is already stored elsewhere -- every "status" shown is
 * derived live from IntegrationConnection/IntegrationSyncJob/
 * IntegrationOperation rows and, for an order, from
 * checkOrderEligibility, exactly this milestone's "derive, don't store a
 * second truth" convention (already established in Milestones 4/5).
 */

export interface SapDashboardSummary {
  connection: {
    mode: "MOCK" | "LIVE";
    enabled: boolean;
    lastTestedAt: Date | null;
    lastTestOk: boolean | null;
    lastTestMessage: string | null;
  };
  isMockMode: boolean;
  lastCompletedSyncAt: Record<"PRODUCT_IMPORT" | "CUSTOMER_IMPORT" | "INVOICE_IMPORT" | "CREDIT_NOTE_IMPORT" | "SALES_ORDER_OUTBOX", Date | null>;
  operationCounts: Record<"PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "UNCERTAIN", number>;
  recentJobs: SapSyncJobRow[];
  attentionNeeded: SapOperationRow[];
}

export interface SapSyncJobRow {
  id: string;
  jobType: string;
  status: string;
  trigger: string;
  triggeredByName: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  summary: unknown;
  errorMessage: string | null;
}

export interface SapOperationRow {
  id: string;
  status: string;
  idempotencyKey: string;
  orderId: string;
  orderReference: string;
  customerName: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastErrorCategory: string | null;
  lastErrorMessage: string | null;
  externalDocEntry: string | null;
  externalDocNum: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const JOB_TYPES = ["PRODUCT_IMPORT", "CUSTOMER_IMPORT", "INVOICE_IMPORT", "CREDIT_NOTE_IMPORT", "SALES_ORDER_OUTBOX"] as const;
const OPERATION_STATUSES = ["PENDING", "PROCESSING", "SUCCEEDED", "FAILED", "UNCERTAIN"] as const;

function mapOperationRow(row: {
  id: string;
  status: string;
  idempotencyKey: string;
  customerOrderId: string;
  attemptCount: number;
  lastAttemptAt: Date | null;
  lastErrorCategory: string | null;
  lastErrorMessage: string | null;
  externalDocEntry: string | null;
  externalDocNum: string | null;
  createdAt: Date;
  updatedAt: Date;
  customerOrder: { reference: string; customer: { name: string } };
}): SapOperationRow {
  return {
    id: row.id,
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    orderId: row.customerOrderId,
    orderReference: row.customerOrder.reference,
    customerName: row.customerOrder.customer.name,
    attemptCount: row.attemptCount,
    lastAttemptAt: row.lastAttemptAt,
    lastErrorCategory: row.lastErrorCategory,
    lastErrorMessage: row.lastErrorMessage,
    externalDocEntry: row.externalDocEntry,
    externalDocNum: row.externalDocNum,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function getSapDashboardSummary(): Promise<SapDashboardSummary> {
  const [connection, isMockMode, lastJobsByType, operationCountRows, recentJobs, attentionRows] = await Promise.all([
    getOrCreateConnection(),
    isSapRunningInMockMode(),
    Promise.all(
      JOB_TYPES.map((jobType) =>
        prisma.integrationSyncJob.findFirst({
          where: { jobType, status: "COMPLETED" },
          orderBy: { completedAt: "desc" },
          select: { completedAt: true },
        })
      )
    ),
    prisma.integrationOperation.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.integrationSyncJob.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
      include: { triggeredBy: { select: { name: true } } },
    }),
    prisma.integrationOperation.findMany({
      where: { status: { in: ["FAILED", "UNCERTAIN"] } },
      orderBy: { updatedAt: "desc" },
      take: 20,
      include: { customerOrder: { select: { reference: true, customer: { select: { name: true } } } } },
    }),
  ]);

  const lastCompletedSyncAt = {} as SapDashboardSummary["lastCompletedSyncAt"];
  JOB_TYPES.forEach((jobType, index) => {
    lastCompletedSyncAt[jobType] = lastJobsByType[index]?.completedAt ?? null;
  });

  const operationCounts = {} as SapDashboardSummary["operationCounts"];
  OPERATION_STATUSES.forEach((status) => (operationCounts[status] = 0));
  for (const row of operationCountRows) operationCounts[row.status as (typeof OPERATION_STATUSES)[number]] = row._count._all;

  return {
    connection: {
      mode: connection.mode,
      enabled: connection.enabled,
      lastTestedAt: connection.lastTestedAt,
      lastTestOk: connection.lastTestOk,
      lastTestMessage: connection.lastTestMessage,
    },
    isMockMode,
    lastCompletedSyncAt,
    operationCounts,
    recentJobs: recentJobs.map((job) => ({
      id: job.id,
      jobType: job.jobType,
      status: job.status,
      trigger: job.trigger,
      triggeredByName: job.triggeredBy?.name ?? null,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      summary: job.summary,
      errorMessage: job.errorMessage,
    })),
    attentionNeeded: attentionRows.map(mapOperationRow),
  };
}

export interface ListOperationsFilters {
  status?: (typeof OPERATION_STATUSES)[number];
  limit?: number;
}

export async function listIntegrationOperations(filters: ListOperationsFilters = {}): Promise<SapOperationRow[]> {
  const rows = await prisma.integrationOperation.findMany({
    where: filters.status ? { status: filters.status } : undefined,
    orderBy: { updatedAt: "desc" },
    take: Math.min(filters.limit ?? 50, 200),
    include: { customerOrder: { select: { reference: true, customer: { select: { name: true } } } } },
  });
  return rows.map(mapOperationRow);
}

export async function getIntegrationOperationById(id: string): Promise<SapOperationRow | null> {
  const row = await prisma.integrationOperation.findUnique({
    where: { id },
    include: { customerOrder: { select: { reference: true, customer: { select: { name: true } } } } },
  });
  return row ? mapOperationRow(row) : null;
}

/**
 * The per-order status spec section 10.3 asks for -- NOT_READY, READY,
 * PENDING, PROCESSING, SYNCED, FAILED, REQUIRES_REVIEW, or CANCELLED.
 * Computed live every time, never stored as a column on CustomerOrder or
 * OrderStatus (this milestone's own "derive, don't store a second
 * truth" convention -- see lib/integrations/sap/order-eligibility.ts's
 * module comment for why that convention matters especially here, given
 * how much of eligibility can change out from under a stored value: a
 * customer getting mapped, an approval getting decided, and so on).
 */
export type OrderIntegrationStatus = "NOT_READY" | "READY" | "PENDING" | "PROCESSING" | "SYNCED" | "FAILED" | "REQUIRES_REVIEW" | "CANCELLED";

export interface OrderIntegrationStatusResult {
  status: OrderIntegrationStatus;
  blockers: string[];
  operation: SapOperationRow | null;
}

export async function getOrderIntegrationStatus(orderId: string): Promise<OrderIntegrationStatusResult> {
  const order = await prisma.customerOrder.findUnique({ where: { id: orderId }, select: { status: true } });
  const operationRow = await prisma.integrationOperation.findUnique({
    where: { customerOrderId: orderId },
    include: { customerOrder: { select: { reference: true, customer: { select: { name: true } } } } },
  });

  if (operationRow) {
    const operation = mapOperationRow(operationRow);
    const statusMap: Record<string, OrderIntegrationStatus> = {
      PENDING: "PENDING",
      PROCESSING: "PROCESSING",
      SUCCEEDED: "SYNCED",
      FAILED: "FAILED",
      UNCERTAIN: "REQUIRES_REVIEW",
    };
    return { status: statusMap[operation.status] ?? "FAILED", blockers: [], operation };
  }

  if (order?.status === "CANCELLED") {
    return { status: "CANCELLED", blockers: [], operation: null };
  }

  const eligibility = await checkOrderEligibility(orderId);
  if (eligibility.eligible) {
    return { status: "READY", blockers: [], operation: null };
  }
  return { status: "NOT_READY", blockers: eligibility.blockers.map((b) => b.message), operation: null };
}
