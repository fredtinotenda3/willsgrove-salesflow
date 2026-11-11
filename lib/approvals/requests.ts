import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { createNotification, createNotificationForRoles } from "@/lib/notifications/create";
import {
  type ApprovalModule,
  type ApprovalActionType,
  type ApprovalRequestStatus,
  type ApproverRole,
  validateApprovalTargetRef,
  validateApprovalStatusTransition,
  canDecideOwnRequest,
  eligibleApproverRoles,
} from "@/lib/approvals/validation";

/**
 * Milestone 8 (Validation and Approvals). The generic lifecycle -- every
 * module-specific gate (today: lib/approvals/quotation-gate.ts) calls
 * createApprovalRequest; every decision (approve/reject/withdraw/cancel)
 * goes through exactly one of the functions below, which is what keeps
 * "no arbitrary status changes bypassing approval" (spec section 6)
 * true across every current and future module this framework serves.
 */

export type MutationFailure = { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };

export type CreateApprovalRequestInput = {
  module: ApprovalModule;
  actionType: ApprovalActionType;
  quotationId?: string | null;
  customerOrderId?: string | null;
  policyId: string;
  requiredApproverRole: ApproverRole;
  requestedById: string;
  reason?: string | null;
  previousValues?: Prisma.InputJsonValue | null;
  submittedValues: Prisma.InputJsonValue;
  previousRequestId?: string | null;
  rootRequestId?: string | null;
  isDemo?: boolean;
};

/**
 * Creates a brand-new PENDING request inside the caller's own
 * transaction (never opens one itself -- the gate that calls this is
 * always coupled to the business action it's blocking, e.g. "attempting
 * to issue this quotation"). Notifies every user holding (or
 * out-ranking) `requiredApproverRole` -- the "eligible approver group"
 * (spec section 2), since this milestone does not build named
 * assignment to one specific approver.
 */
export async function createApprovalRequest(tx: Prisma.TransactionClient, input: CreateApprovalRequestInput) {
  const refCheck = validateApprovalTargetRef(input.module, input);
  if (!refCheck.ok) {
    throw new Error(`createApprovalRequest: ${refCheck.message}`);
  }

  const created = await tx.approvalRequest.create({
    data: {
      module: input.module,
      actionType: input.actionType,
      status: "PENDING",
      quotationId: input.quotationId ?? null,
      customerOrderId: input.customerOrderId ?? null,
      policyId: input.policyId,
      requiredApproverRole: input.requiredApproverRole,
      requestedById: input.requestedById,
      reason: input.reason ?? null,
      previousValues: input.previousValues ?? undefined,
      submittedValues: input.submittedValues,
      previousRequestId: input.previousRequestId ?? null,
      rootRequestId: input.rootRequestId ?? null,
      isDemo: input.isDemo ?? false,
    },
    select: { id: true, module: true, actionType: true, requiredApproverRole: true },
  });

  await tx.approvalEvent.create({
    data: {
      approvalRequestId: created.id,
      eventType: input.previousRequestId ? "RESUBMITTED" : "SUBMITTED",
      actorId: input.requestedById,
    },
  });

  await tx.auditEvent.create({
    data: {
      actorId: input.requestedById,
      action: "APPROVAL_REQUEST_SUBMITTED",
      entityType: "ApprovalRequest",
      entityId: created.id,
      afterData: { module: input.module, actionType: input.actionType, status: "PENDING" },
    },
  });

  await createNotificationForRoles(tx, eligibleApproverRoles(input.requiredApproverRole), {
    type: "APPROVAL_SUBMITTED",
    title: "Approval needed",
    message: `A new ${input.actionType.replaceAll("_", " ").toLowerCase()} approval request is waiting for a decision.`,
    link: `/approvals/${created.id}`,
  });

  return created;
}

/**
 * Marks a live (PENDING/DRAFT) request CANCELLED with an INVALIDATED
 * event -- the system-triggered form of "changes to material financial
 * values after approval must invalidate... renewed approval" (spec
 * section 4A), distinct from a human CANCELLED decision. Never throws
 * on a request that is already terminal -- it is always called
 * defensively (lib/quotations/edit.ts calls this after every line
 * change; it should simply no-op for a quotation with no live request).
 */
export async function invalidateApprovalRequest(tx: Prisma.TransactionClient, requestId: string, notes: string): Promise<void> {
  const request = await tx.approvalRequest.findUnique({ where: { id: requestId }, select: { status: true } });
  if (!request) return;
  const transition = validateApprovalStatusTransition(request.status as ApprovalRequestStatus, "CANCELLED");
  if (!transition.ok) return;

  await tx.approvalRequest.update({
    where: { id: requestId },
    data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: notes },
  });
  await tx.approvalEvent.create({ data: { approvalRequestId: requestId, eventType: "INVALIDATED", notes } });
  await tx.auditEvent.create({
    data: { action: "APPROVAL_REQUEST_INVALIDATED", entityType: "ApprovalRequest", entityId: requestId, afterData: { status: "CANCELLED", reason: notes } },
  });
}

export type DecideResult = { ok: true; status: "APPROVED" | "REJECTED" } | MutationFailure;

async function loadRequestForDecision(requestId: string) {
  return prisma.approvalRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      status: true,
      requestedById: true,
      requiredApproverRole: true,
      module: true,
      quotation: { select: { preparedById: true, salespersonId: true } },
    },
  });
}

/**
 * The set of user ids who may never decide this specific request,
 * regardless of role or the firing policy's own
 * `allowRequesterSelfApprove` -- spec section 3's "requester must not
 * approve their own request" plus section 7's named "quotation preparer
 * versus pricing exception approver" pair.
 */
function blockedDeciderIds(request: NonNullable<Awaited<ReturnType<typeof loadRequestForDecision>>>): string[] {
  const ids = [request.requestedById];
  if (request.quotation) {
    ids.push(request.quotation.preparedById);
  }
  return [...new Set(ids)];
}

export async function approveApprovalRequest(requestId: string, decidedById: string, decidedByRole: ApproverRole, decisionReason: string | undefined): Promise<DecideResult> {
  const request = await loadRequestForDecision(requestId);
  if (!request) return { ok: false, status: 404, message: "Approval request not found." };

  if (!eligibleApproverRoles(request.requiredApproverRole as ApproverRole).includes(decidedByRole)) {
    return { ok: false, status: 403, message: `This request requires ${request.requiredApproverRole} (or higher) to decide.` };
  }
  if (canDecideOwnRequest(decidedById, blockedDeciderIds(request))) {
    return { ok: false, status: 403, message: "You cannot approve a request you submitted or prepared the underlying record for." };
  }

  const transition = validateApprovalStatusTransition(request.status as ApprovalRequestStatus, "APPROVED");
  if (!transition.ok) {
    return { ok: false, status: 409, message: transition.message };
  }

  const decided = await prisma.$transaction(async (tx) => {
    // Conditional on the SAME status this function already validated the
    // transition from -- the atomic guard against "concurrent approval
    // race conditions" and "approval of already decided requests" (spec
    // section 6): if another decision landed between the read above and
    // this write, `count` is 0 and nothing here is applied.
    const { count } = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: request.status },
      data: { status: "APPROVED", decidedAt: new Date(), decidedById, decisionReason: decisionReason ?? null },
    });
    if (count === 0) return false;

    await tx.approvalEvent.create({ data: { approvalRequestId: requestId, eventType: "APPROVED", actorId: decidedById, notes: decisionReason ?? null } });
    await tx.auditEvent.create({
      data: { actorId: decidedById, action: "APPROVAL_REQUEST_APPROVED", entityType: "ApprovalRequest", entityId: requestId, beforeData: { status: request.status }, afterData: { status: "APPROVED" } },
    });
    await createNotification(tx, {
      userId: request.requestedById,
      type: "APPROVAL_APPROVED",
      title: "Approval request approved",
      message: "Your approval request was approved.",
      link: `/approvals/${requestId}`,
    });
    return true;
  }, TRANSACTION_OPTIONS);

  if (!decided) {
    return { ok: false, status: 409, message: "This request was already decided by someone else." };
  }
  return { ok: true, status: "APPROVED" };
}

export async function rejectApprovalRequest(requestId: string, decidedById: string, decidedByRole: ApproverRole, decisionReason: string): Promise<DecideResult> {
  const request = await loadRequestForDecision(requestId);
  if (!request) return { ok: false, status: 404, message: "Approval request not found." };

  if (!eligibleApproverRoles(request.requiredApproverRole as ApproverRole).includes(decidedByRole)) {
    return { ok: false, status: 403, message: `This request requires ${request.requiredApproverRole} (or higher) to decide.` };
  }
  if (canDecideOwnRequest(decidedById, blockedDeciderIds(request))) {
    return { ok: false, status: 403, message: "You cannot reject a request you submitted or prepared the underlying record for." };
  }

  const transition = validateApprovalStatusTransition(request.status as ApprovalRequestStatus, "REJECTED");
  if (!transition.ok) {
    return { ok: false, status: 409, message: transition.message };
  }

  const decided = await prisma.$transaction(async (tx) => {
    const { count } = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: request.status },
      data: { status: "REJECTED", decidedAt: new Date(), decidedById, decisionReason },
    });
    if (count === 0) return false;

    await tx.approvalEvent.create({ data: { approvalRequestId: requestId, eventType: "REJECTED", actorId: decidedById, notes: decisionReason } });
    await tx.auditEvent.create({
      data: { actorId: decidedById, action: "APPROVAL_REQUEST_REJECTED", entityType: "ApprovalRequest", entityId: requestId, beforeData: { status: request.status }, afterData: { status: "REJECTED", decisionReason } },
    });
    await createNotification(tx, {
      userId: request.requestedById,
      type: "APPROVAL_REJECTED",
      title: "Approval request rejected",
      message: decisionReason,
      link: `/approvals/${requestId}`,
    });
    return true;
  }, TRANSACTION_OPTIONS);

  if (!decided) {
    return { ok: false, status: 409, message: "This request was already decided by someone else." };
  }
  return { ok: true, status: "REJECTED" };
}

export type WithdrawResult = { ok: true } | MutationFailure;

/** Requester-only -- "cancellation and withdrawal where appropriate" (spec section 2), while the request is still live. */
export async function withdrawApprovalRequest(requestId: string, actorId: string, decisionReason: string | undefined): Promise<WithdrawResult> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true, requestedById: true } });
  if (!request) return { ok: false, status: 404, message: "Approval request not found." };
  if (request.requestedById !== actorId) {
    return { ok: false, status: 403, message: "Only the user who submitted this request may withdraw it." };
  }
  const transition = validateApprovalStatusTransition(request.status as ApprovalRequestStatus, "WITHDRAWN");
  if (!transition.ok) {
    return { ok: false, status: 409, message: transition.message };
  }

  const applied = await prisma.$transaction(async (tx) => {
    const { count } = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: request.status },
      data: { status: "WITHDRAWN", withdrawnAt: new Date(), withdrawnById: actorId },
    });
    if (count === 0) return false;
    await tx.approvalEvent.create({ data: { approvalRequestId: requestId, eventType: "WITHDRAWN", actorId, notes: decisionReason ?? null } });
    await tx.auditEvent.create({ data: { actorId, action: "APPROVAL_REQUEST_WITHDRAWN", entityType: "ApprovalRequest", entityId: requestId, beforeData: { status: request.status }, afterData: { status: "WITHDRAWN" } } });
    return true;
  }, TRANSACTION_OPTIONS);

  if (!applied) {
    return { ok: false, status: 409, message: "This request's status already changed; refresh and try again." };
  }
  return { ok: true };
}

export type CancelResult = { ok: true } | MutationFailure;

/** ADMINISTRATOR-only at the route layer (not re-checked here -- same split as every other lib/-vs-route boundary in this project). */
export async function cancelApprovalRequest(requestId: string, actorId: string, cancellationReason: string): Promise<CancelResult> {
  const request = await prisma.approvalRequest.findUnique({ where: { id: requestId }, select: { id: true, status: true } });
  if (!request) return { ok: false, status: 404, message: "Approval request not found." };
  const transition = validateApprovalStatusTransition(request.status as ApprovalRequestStatus, "CANCELLED");
  if (!transition.ok) {
    return { ok: false, status: 409, message: transition.message };
  }

  const applied = await prisma.$transaction(async (tx) => {
    const { count } = await tx.approvalRequest.updateMany({
      where: { id: requestId, status: request.status },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actorId, cancellationReason },
    });
    if (count === 0) return false;
    await tx.approvalEvent.create({ data: { approvalRequestId: requestId, eventType: "CANCELLED", actorId, notes: cancellationReason } });
    await tx.auditEvent.create({ data: { actorId, action: "APPROVAL_REQUEST_CANCELLED", entityType: "ApprovalRequest", entityId: requestId, beforeData: { status: request.status }, afterData: { status: "CANCELLED", cancellationReason } } });
    return true;
  }, TRANSACTION_OPTIONS);

  if (!applied) {
    return { ok: false, status: 409, message: "This request's status already changed; refresh and try again." };
  }
  return { ok: true };
}
