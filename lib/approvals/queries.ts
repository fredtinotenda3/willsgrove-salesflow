import "server-only";
import { prisma } from "@/lib/prisma";
import type { ListApprovalsQuery } from "@/lib/approvals/validation";
import { dateOnlyStringToUtcDate } from "@/lib/dates";

export type ApprovalRequestRow = {
  id: string;
  module: string;
  actionType: string;
  status: string;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  requiredApproverRole: string;
  reason: string | null;
  submittedValues: Record<string, unknown>;
  submittedAt: string;
  decidedAt: string | null;
  decisionReason: string | null;
  quotation: { id: string; quotationNumber: string; revisionNumber: number; customerName: string } | null;
  customerOrder: { id: string; reference: string } | null;
  isOverdue: boolean;
};

const listInclude = {
  requestedBy: { select: { id: true, name: true } },
  decidedBy: { select: { id: true, name: true } },
  policy: { select: { overdueAfterHours: true } },
  quotation: { select: { id: true, quotationNumber: true, revisionNumber: true, customer: { select: { name: true } } } },
  customerOrder: { select: { id: true, reference: true } },
} as const;

/**
 * Which `requiredApproverRole` values a user holding `viewerRole` can
 * actually decide -- the inverse of lib/approvals/validation.ts's
 * eligibleApproverRoles() (which goes policy-role -> who may decide it;
 * this goes viewer-role -> which policy-roles they satisfy). SALESPERSON
 * satisfies none, so it returns [] rather than ever granting them a
 * "pending my decision" count or query result.
 */
function requiredRolesSatisfiedBy(viewerRole: string): string[] {
  if (viewerRole === "ADMINISTRATOR") return ["SALES_MANAGER", "ADMINISTRATOR"];
  if (viewerRole === "SALES_MANAGER") return ["SALES_MANAGER"];
  return [];
}

function computeOverdue(status: string, submittedAt: Date, overdueAfterHours: number | null): boolean {
  if (status !== "PENDING" || overdueAfterHours === null) return false;
  const dueBy = new Date(submittedAt.getTime() + overdueAfterHours * 60 * 60 * 1000);
  return new Date() > dueBy;
}

function mapRow(row: {
  id: string;
  module: string;
  actionType: string;
  status: string;
  requestedBy: { id: string; name: string };
  decidedBy: { id: string; name: string } | null;
  requiredApproverRole: string;
  reason: string | null;
  submittedValues: unknown;
  submittedAt: Date;
  decidedAt: Date | null;
  decisionReason: string | null;
  policy: { overdueAfterHours: number | null } | null;
  quotation: { id: string; quotationNumber: string; revisionNumber: number; customer: { name: string } } | null;
  customerOrder: { id: string; reference: string } | null;
}): ApprovalRequestRow {
  return {
    id: row.id,
    module: row.module,
    actionType: row.actionType,
    status: row.status,
    requestedBy: row.requestedBy,
    decidedBy: row.decidedBy,
    requiredApproverRole: row.requiredApproverRole,
    reason: row.reason,
    submittedValues: row.submittedValues as Record<string, unknown>,
    submittedAt: row.submittedAt.toISOString(),
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionReason: row.decisionReason,
    quotation: row.quotation
      ? { id: row.quotation.id, quotationNumber: row.quotation.quotationNumber, revisionNumber: row.quotation.revisionNumber, customerName: row.quotation.customer.name }
      : null,
    customerOrder: row.customerOrder,
    isOverdue: computeOverdue(row.status, row.submittedAt, row.policy?.overdueAfterHours ?? null),
  };
}

export type ApprovalListFilters = ListApprovalsQuery & {
  /** Convenience filters the UI's own tabs use -- resolved to requestedById/status/decidedById-eligibility before querying. */
  mine?: { viewerId: string; kind: "submitted" | "pendingDecision"; viewerRole: string };
  includeDemo?: boolean;
};

export async function listApprovalRequests(filters: ApprovalListFilters): Promise<ApprovalRequestRow[]> {
  const where: Record<string, unknown> = filters.includeDemo ? {} : { isDemo: false };

  if (filters.module) where.module = filters.module;
  if (filters.actionType) where.actionType = filters.actionType;
  if (filters.status) where.status = filters.status;
  if (filters.requestedById) where.requestedById = filters.requestedById;
  if (filters.decidedById) where.decidedById = filters.decidedById;
  if (filters.dateFrom || filters.dateTo) {
    where.submittedAt = {
      ...(filters.dateFrom ? { gte: dateOnlyStringToUtcDate(filters.dateFrom) } : {}),
      ...(filters.dateTo ? { lte: dateOnlyStringToUtcDate(filters.dateTo) } : {}),
    };
  }

  if (filters.mine?.kind === "submitted") {
    where.requestedById = filters.mine.viewerId;
  } else if (filters.mine?.kind === "pendingDecision") {
    // "Requests awaiting my decision" (spec section 8) -- PENDING, this
    // viewer's role satisfies requiredApproverRole (ADMINISTRATOR
    // satisfies both; SALES_MANAGER satisfies only its own; SALESPERSON
    // satisfies neither -- requiredRolesSatisfiedBy returns [] for it,
    // which `{ in: [] }` correctly turns into "match nothing"), and this
    // viewer did not submit it (the self-approval block would refuse the
    // decision anyway, but excluding it here keeps the tab honest about
    // what the viewer can actually act on).
    where.status = "PENDING";
    where.requiredApproverRole = { in: requiredRolesSatisfiedBy(filters.mine.viewerRole) };
    where.requestedById = { not: filters.mine.viewerId };
  }

  const rows = await prisma.approvalRequest.findMany({
    where,
    include: listInclude,
    orderBy: { submittedAt: "desc" },
    take: 200,
  });

  let mapped = rows.map(mapRow);
  if (filters.currency) {
    mapped = mapped.filter((row) => row.submittedValues.currency === filters.currency);
  }
  return mapped;
}

export type ApprovalRequestDetail = ApprovalRequestRow & {
  evidence: string | null;
  previousValues: Record<string, unknown> | null;
  withdrawnAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  policyId: string | null;
  events: { id: string; eventType: string; actorName: string | null; notes: string | null; createdAt: string }[];
  /** The business record's CURRENT values, for the approver's side-by-side comparison (spec section 8). Null once the request is itself terminal and the comparison is no longer actionable. */
  currentValues: Record<string, unknown> | null;
};

export async function getApprovalRequestById(id: string): Promise<ApprovalRequestDetail | null> {
  const row = await prisma.approvalRequest.findUnique({
    where: { id },
    include: {
      ...listInclude,
      events: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!row) return null;

  let currentValues: Record<string, unknown> | null = null;
  if (row.quotation) {
    const quotation = await prisma.quotation.findUnique({
      where: { id: row.quotation.id },
      select: { subtotal: true, discountTotal: true, vatTotal: true, total: true, currency: true, lines: { select: { discountPercent: true } } },
    });
    if (quotation) {
      const maxDiscount = quotation.lines.reduce((max, line) => {
        const value = line.discountPercent ? Number(line.discountPercent) : 0;
        return value > max ? value : max;
      }, 0);
      currentValues = {
        maxDiscountPercent: maxDiscount.toString(),
        subtotal: quotation.subtotal.toString(),
        discountTotal: quotation.discountTotal.toString(),
        vatTotal: quotation.vatTotal.toString(),
        total: quotation.total.toString(),
        currency: quotation.currency,
      };
    }
  }

  return {
    ...mapRow(row),
    evidence: row.evidence,
    previousValues: row.previousValues as Record<string, unknown> | null,
    withdrawnAt: row.withdrawnAt ? row.withdrawnAt.toISOString() : null,
    cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
    cancellationReason: row.cancellationReason,
    policyId: row.policyId,
    events: row.events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      actorName: event.actor?.name ?? null,
      notes: event.notes,
      createdAt: event.createdAt.toISOString(),
    })),
    currentValues,
  };
}

/**
 * The quotation detail page's own banner (spec section 8's "the
 * quotation detail page must display its approval status"): is there a
 * live (PENDING) approval request against THIS quotation right now.
 * Deliberately narrow -- a terminal (APPROVED/REJECTED/CANCELLED/
 * WITHDRAWN) request is visible in full in the quotation's revision/
 * event history already and in /approvals; this is only for "is the
 * issue gate currently blocking" at a glance.
 */
export async function getLiveApprovalRequestForQuotation(quotationId: string): Promise<{ id: string; status: string; requiredApproverRole: string; submittedAt: string } | null> {
  const row = await prisma.approvalRequest.findFirst({
    where: { quotationId, status: "PENDING" },
    select: { id: true, status: true, requiredApproverRole: true, submittedAt: true },
    orderBy: { submittedAt: "desc" },
  });
  if (!row) return null;
  return { id: row.id, status: row.status, requiredApproverRole: row.requiredApproverRole, submittedAt: row.submittedAt.toISOString() };
}

export type ApprovalDashboard = {
  statusCounts: Record<string, number>;
  moduleCounts: Record<string, number>;
  pendingMyDecisionCount: number;
  submittedByMeCount: number;
  overdueCount: number;
  averageTurnaroundHours: number | null;
};

const ALL_STATUSES = ["DRAFT", "PENDING", "APPROVED", "REJECTED", "CANCELLED", "WITHDRAWN"] as const;
const ALL_MODULES = ["QUOTATIONS", "ORDERS"] as const;

export async function getApprovalDashboard(viewerId: string, viewerRole: string, options?: { includeDemo?: boolean }): Promise<ApprovalDashboard> {
  const includeDemo = options?.includeDemo ?? false;
  const baseWhere = includeDemo ? {} : { isDemo: false };

  const [statusGroups, moduleGroups, decided, pendingWithPolicy, submittedByMeCount] = await Promise.all([
    prisma.approvalRequest.groupBy({ by: ["status"], where: baseWhere, _count: { _all: true } }),
    prisma.approvalRequest.groupBy({ by: ["module"], where: baseWhere, _count: { _all: true } }),
    prisma.approvalRequest.findMany({ where: { ...baseWhere, decidedAt: { not: null } }, select: { submittedAt: true, decidedAt: true } }),
    prisma.approvalRequest.findMany({
      where: { ...baseWhere, status: "PENDING" },
      select: { submittedAt: true, policy: { select: { overdueAfterHours: true } } },
    }),
    prisma.approvalRequest.count({ where: { ...baseWhere, requestedById: viewerId } }),
  ]);

  const statusCounts: Record<string, number> = {};
  for (const status of ALL_STATUSES) statusCounts[status] = 0;
  for (const row of statusGroups) statusCounts[row.status] = row._count._all;

  const moduleCounts: Record<string, number> = {};
  // Named `moduleName`, not `module` -- assigning to a bare `module`
  // identifier collides with Next.js/webpack's own module-scope binding
  // (@next/next/no-assign-module-variable).
  for (const moduleName of ALL_MODULES) moduleCounts[moduleName] = 0;
  for (const row of moduleGroups) moduleCounts[row.module] = row._count._all;

  const overdueCount = pendingWithPolicy.filter((row) => computeOverdue("PENDING", row.submittedAt, row.policy?.overdueAfterHours ?? null)).length;

  const turnaroundHours = decided
    .filter((row) => row.decidedAt !== null)
    .map((row) => (row.decidedAt!.getTime() - row.submittedAt.getTime()) / (1000 * 60 * 60));
  const averageTurnaroundHours = turnaroundHours.length > 0 ? turnaroundHours.reduce((sum, hours) => sum + hours, 0) / turnaroundHours.length : null;

  const pendingMyDecisionWhere: Record<string, unknown> = {
    ...baseWhere,
    status: "PENDING",
    requiredApproverRole: { in: requiredRolesSatisfiedBy(viewerRole) },
    requestedById: { not: viewerId },
  };
  const pendingMyDecisionCount = await prisma.approvalRequest.count({ where: pendingMyDecisionWhere });

  return {
    statusCounts,
    moduleCounts,
    pendingMyDecisionCount,
    submittedByMeCount,
    overdueCount,
    averageTurnaroundHours: averageTurnaroundHours !== null ? Math.round(averageTurnaroundHours * 10) / 10 : null,
  };
}
