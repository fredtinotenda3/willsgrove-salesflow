import "server-only";
import { prisma } from "@/lib/prisma";
import type { ApprovalActionType, ApprovalModule, ApproverRole, ThresholdPolicyLike } from "@/lib/approvals/validation";

/**
 * Milestone 8. Active-policy lookup used by every module's own gate
 * (today: lib/approvals/quotation-gate.ts). "Effective" is evaluated
 * against the current moment (now), not any business-record date -- the
 * question a gate asks is "does a threshold apply to this submission
 * attempt right now," not "did one apply on some historical date,"
 * unlike e.g. PriceListEntry's validFrom/validTo (which answers the
 * latter, a genuinely different question).
 */
export async function findActivePolicies(module: ApprovalModule, actionType: ApprovalActionType): Promise<ThresholdPolicyLike[]> {
  const now = new Date();
  const rows = await prisma.approvalPolicy.findMany({
    where: {
      module,
      actionType,
      active: true,
      OR: [{ effectiveFrom: null }, { effectiveFrom: { lte: now } }],
      AND: [{ OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }] }],
    },
    select: { id: true, actionType: true, thresholdPercent: true, thresholdAmount: true, currency: true, requiredApproverRole: true },
  });

  return rows.map((row) => ({
    id: row.id,
    actionType: row.actionType as ApprovalActionType,
    thresholdPercent: row.thresholdPercent ? row.thresholdPercent.toString() : null,
    requiredApproverRole: row.requiredApproverRole as ApproverRole,
  }));
}

export type ApprovalPolicyRow = {
  id: string;
  module: string;
  actionType: string;
  name: string;
  description: string | null;
  thresholdPercent: string | null;
  thresholdAmount: string | null;
  currency: string | null;
  requiredApproverRole: string;
  allowRequesterSelfApprove: boolean;
  isMandatory: boolean;
  overdueAfterHours: number | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  active: boolean;
  enforced: boolean; // true only for actionTypes this milestone actually wires a live gate for -- see createApprovalPolicySchema's own comment
  createdAt: string;
};

const ENFORCED_ACTION_TYPES = new Set(["QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD"]);

function mapPolicyRow(row: {
  id: string;
  module: string;
  actionType: string;
  name: string;
  description: string | null;
  thresholdPercent: unknown;
  thresholdAmount: unknown;
  currency: string | null;
  requiredApproverRole: string;
  allowRequesterSelfApprove: boolean;
  isMandatory: boolean;
  overdueAfterHours: number | null;
  effectiveFrom: Date | null;
  effectiveTo: Date | null;
  active: boolean;
  createdAt: Date;
}): ApprovalPolicyRow {
  return {
    id: row.id,
    module: row.module,
    actionType: row.actionType,
    name: row.name,
    description: row.description,
    thresholdPercent: row.thresholdPercent ? (row.thresholdPercent as { toString(): string }).toString() : null,
    thresholdAmount: row.thresholdAmount ? (row.thresholdAmount as { toString(): string }).toString() : null,
    currency: row.currency,
    requiredApproverRole: row.requiredApproverRole,
    allowRequesterSelfApprove: row.allowRequesterSelfApprove,
    isMandatory: row.isMandatory,
    overdueAfterHours: row.overdueAfterHours,
    effectiveFrom: row.effectiveFrom ? row.effectiveFrom.toISOString().slice(0, 10) : null,
    effectiveTo: row.effectiveTo ? row.effectiveTo.toISOString().slice(0, 10) : null,
    active: row.active,
    enforced: ENFORCED_ACTION_TYPES.has(row.actionType),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listApprovalPolicies(): Promise<ApprovalPolicyRow[]> {
  const rows = await prisma.approvalPolicy.findMany({ orderBy: [{ module: "asc" }, { actionType: "asc" }, { createdAt: "desc" }] });
  return rows.map(mapPolicyRow);
}

export async function getApprovalPolicyById(id: string): Promise<ApprovalPolicyRow | null> {
  const row = await prisma.approvalPolicy.findUnique({ where: { id } });
  return row ? mapPolicyRow(row) : null;
}
