import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isManagementReportId, type ManagementReportId } from "@/lib/reporting/management-reports";
import { actionKey, applyOperation, type ActionStatus, type ManagementActionRequest } from "./action-state";
import { defaultManagementFilters, getReportIntelligence } from "./queries";
import type { ManagementFinding } from "./types";

export type TrackedAction = {
  id: string;
  findingKey: string;
  reportId: string;
  topic: string;
  title: string;
  finding: string;
  recommendedAction: string;
  priority: string;
  responsibleFunction: string;
  status: ActionStatus;
  assignedToId: string | null;
  assignedToName: string | null;
  assignedAt: string | null;
  statusNote: string | null;
  statusAt: string | null;
  completedAt: string | null;
  createdAt: string;
  evidence: { label: string; value: string }[];
};

type PerformResult = { ok: true; action: TrackedAction } | { ok: false; status: number; message: string };

const actionSelect = {
  id: true,
  findingKey: true,
  reportId: true,
  topic: true,
  title: true,
  finding: true,
  recommendedAction: true,
  priority: true,
  responsibleFunction: true,
  status: true,
  assignedToId: true,
  assignedTo: { select: { name: true } },
  assignedAt: true,
  statusNote: true,
  statusAt: true,
  completedAt: true,
  createdAt: true,
  evidence: true,
} satisfies Prisma.ManagementActionSelect;

type ActionRow = Prisma.ManagementActionGetPayload<{ select: typeof actionSelect }>;

function parseEvidence(value: Prisma.JsonValue): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item && typeof item === "object" && !Array.isArray(item) && typeof item.label === "string" && typeof item.value === "string") return [{ label: item.label, value: item.value }];
    return [];
  });
}

export function toTrackedAction(row: ActionRow): TrackedAction {
  return {
    id: row.id,
    findingKey: row.findingKey,
    reportId: row.reportId,
    topic: row.topic,
    title: row.title,
    finding: row.finding,
    recommendedAction: row.recommendedAction,
    priority: row.priority,
    responsibleFunction: row.responsibleFunction,
    status: row.status,
    assignedToId: row.assignedToId,
    assignedToName: row.assignedTo?.name ?? null,
    assignedAt: row.assignedAt?.toISOString() ?? null,
    statusNote: row.statusNote,
    statusAt: row.statusAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    evidence: parseEvidence(row.evidence),
  };
}

export async function listTrackedActions(): Promise<TrackedAction[]> {
  const rows = await prisma.managementAction.findMany({ select: actionSelect, orderBy: [{ updatedAt: "desc" }], take: 500 });
  return rows.map(toTrackedAction);
}

/** Managers and administrators are the only roles that can open the Action Centre, so they are the only valid assignees. */
export async function listAssignableUsers(): Promise<{ id: string; name: string; role: string }[]> {
  return prisma.user.findMany({ where: { status: "ACTIVE", role: { in: ["SALES_MANAGER", "ADMINISTRATOR"] } }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
}

async function resolveFinding(reportId: ManagementReportId, key: string): Promise<ManagementFinding | null> {
  const intel = await getReportIntelligence(reportId, defaultManagementFilters(), { period: "monthly" });
  return intel.findings.find((f) => f.key === key) ?? null;
}

/**
 * Applies one management action operation. The finding text and evidence
 * are always taken from a fresh server-side computation, never from the
 * request, so a client cannot record an invented finding. All writes,
 * the event row and the audit event commit in one transaction, and the
 * status change is guarded so two managers cannot both move the same
 * action from the same starting state.
 */
export async function performManagementAction(request: ManagementActionRequest, actorId: string): Promise<PerformResult> {
  if (!isManagementReportId(request.reportId)) return { ok: false, status: 400, message: "Unknown report." };
  const reportId = request.reportId;
  const findingKey = actionKey(reportId, request.findingKey);

  let assigneeId: string | null = null;
  if (request.operation === "ASSIGN") {
    if (!request.assigneeId) return { ok: false, status: 400, message: "Choose who the action is assigned to." };
    const assignee = await prisma.user.findUnique({ where: { id: request.assigneeId }, select: { id: true, status: true, role: true } });
    if (!assignee || assignee.status !== "ACTIVE" || (assignee.role !== "SALES_MANAGER" && assignee.role !== "ADMINISTRATOR")) {
      return { ok: false, status: 400, message: "The action can only be assigned to an active manager or administrator." };
    }
    assigneeId = assignee.id;
  }

  const existing = await prisma.managementAction.findUnique({ where: { findingKey }, select: { id: true } });
  let finding: ManagementFinding | null = null;
  if (!existing) {
    finding = await resolveFinding(reportId, request.findingKey);
    if (!finding) return { ok: false, status: 404, message: "This finding is not present in the current data, so there is nothing to act on." };
  }

  try {
    const action = await prisma.$transaction(async (tx) => {
      const row = finding
        ? await tx.managementAction.upsert({
            where: { findingKey },
            update: {},
            create: {
              findingKey,
              reportId,
              topic: finding.topic,
              title: finding.title,
              finding: finding.finding,
              recommendedAction: finding.recommendedAction,
              businessImpact: finding.businessImpact,
              expectedOutcome: finding.expectedOutcome,
              measurement: finding.measurement,
              priority: finding.priority,
              timeframe: finding.timeframe,
              responsibleFunction: finding.responsibleFunction,
              evidence: finding.evidence as unknown as Prisma.InputJsonValue,
            },
            select: { id: true, status: true, assignedToId: true },
          })
        : await tx.managementAction.findUniqueOrThrow({ where: { findingKey }, select: { id: true, status: true, assignedToId: true } });

      const from = row.status as ActionStatus;
      const result = applyOperation(from, request.operation, { hasAssignee: row.assignedToId !== null, assigneeId, note: request.note ?? null });
      if (!result.ok) throw new ActionRuleError(400, result.message);

      const now = new Date();
      const note = request.note?.trim() || null;
      const data: Prisma.ManagementActionUpdateManyMutationInput & { assignedToId?: string | null; assignedById?: string | null; statusById?: string } = {
        status: result.to,
        statusById: actorId,
        statusAt: now,
      };
      if (note !== null) data.statusNote = note;
      if (request.operation === "ASSIGN") {
        data.assignedToId = assigneeId;
        data.assignedById = actorId;
        data.assignedAt = now;
      }
      if (result.to === "COMPLETED") data.completedAt = now;
      if (request.operation === "REOPEN") data.completedAt = null;

      const changed = await tx.managementAction.updateMany({ where: { id: row.id, status: from }, data });
      if (changed.count !== 1) throw new ActionRuleError(409, "This action was changed by someone else. Refresh and try again.");

      await tx.managementActionEvent.create({
        data: { managementActionId: row.id, eventType: result.eventType, fromStatus: from, toStatus: result.to, actorId, assigneeId, notes: note },
      });
      await tx.auditEvent.create({
        data: {
          actorId,
          action: `MANAGEMENT_ACTION_${result.eventType}`,
          entityType: "ManagementAction",
          entityId: row.id,
          beforeData: { status: from },
          afterData: { status: result.to, assigneeId, note, findingKey },
        },
      });
      return tx.managementAction.findUniqueOrThrow({ where: { id: row.id }, select: actionSelect });
    });
    return { ok: true, action: toTrackedAction(action) };
  } catch (error) {
    if (error instanceof ActionRuleError) return { ok: false, status: error.status, message: error.message };
    throw error;
  }
}

class ActionRuleError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
