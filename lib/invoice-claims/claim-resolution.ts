import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import {
  type RecordClaimResolutionInput,
  type ClaimStatus,
  type ResolutionDecision,
  resolutionDecisionRequiresDetail,
  resolutionDecisionToClaimStatus,
  validateClaimStatusTransition,
  isConcludedStatus,
} from "@/lib/invoice-claims/validation";

/**
 * Milestone 6A. Investigation findings and resolution recommendations.
 *
 * Any authenticated user may RECORD a resolution recommendation (the
 * claim moves to AWAITING_INTERNAL_ACTION so a manager can act on it --
 * recording itself is not an approval). Only SALES_MANAGER/ADMINISTRATOR
 * may APPROVE or REJECT one (checked at the route layer, same two-tier
 * convention as every other milestone's approval-weight action -- these
 * functions take the acting user's id but do not themselves check role).
 *
 * "A recommendation is not the same as an executed action" (spec section
 * 6) is structural here: recordClaimResolution() never changes the
 * claim's status to anything approval-weight by itself -- it can only
 * move an OPEN/UNDER_INVESTIGATION/AWAITING_CUSTOMER claim to
 * AWAITING_INTERNAL_ACTION, which validateClaimStatusTransition confirms
 * is never an approval-weight transition. Only approveClaimResolution()
 * can move the claim onward, and only to the status
 * resolutionDecisionToClaimStatus() maps that SAME resolution's decision
 * to -- never a status the approver chooses freely.
 */

export type RecordClaimResolutionResult =
  | { ok: true; id: string; claimStatus: ClaimStatus }
  | { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };

export async function recordClaimResolution(
  claimId: string,
  input: RecordClaimResolutionInput,
  recordedById: string
): Promise<RecordClaimResolutionResult> {
  if (resolutionDecisionRequiresDetail(input.decision) && !input.decisionDetail?.trim()) {
    return { ok: false, status: 400, message: "A detail is required when decision is OTHER.", fieldErrors: { decisionDetail: "Required when decision is OTHER." } };
  }

  const claim = await prisma.invoiceClaim.findUnique({ where: { id: claimId }, select: { id: true, status: true } });
  if (!claim) {
    return { ok: false, status: 404, message: "Claim not found." };
  }

  const currentStatus = claim.status as ClaimStatus;
  // Recording a resolution always targets AWAITING_INTERNAL_ACTION -- a
  // plain investigation-workflow move, never approval-weight (confirmed
  // by validateClaimStatusTransition itself, checked here defensively so
  // a future change to the transition graph can't silently make this
  // function perform an approval-weight move without this call failing
  // loudly first).
  const transition = validateClaimStatusTransition(currentStatus, "AWAITING_INTERNAL_ACTION");
  if (!transition.ok) {
    return { ok: false, status: 400, message: `Cannot record a resolution while the claim is ${currentStatus}: ${transition.message}` };
  }
  if (transition.requiresApproval) {
    // Defensive only -- should never trigger given the transition graph
    // as currently defined; if it ever does, failing loudly here is far
    // safer than silently granting an approval-weight move to an
    // unprivileged caller.
    return { ok: false, status: 500, message: "Internal error: recording a resolution would require approval, which is not expected." };
  }

  const resolution = await prisma.$transaction(async (tx) => {
    const created = await tx.claimResolution.create({
      data: {
        claimId,
        findings: input.findings ?? null,
        responsibleDepartment: input.responsibleDepartment ?? null,
        rootCause: input.rootCause ?? null,
        correctiveAction: input.correctiveAction ?? null,
        customerResponse: input.customerResponse ?? null,
        decision: input.decision,
        decisionDetail: input.decisionDetail ?? null,
        resolutionDate: input.resolutionDate ? dateOnlyStringToUtcDate(input.resolutionDate) : null,
        recordedById,
      },
      select: { id: true },
    });

    await tx.invoiceClaim.update({ where: { id: claimId }, data: { status: "AWAITING_INTERNAL_ACTION" } });

    await tx.auditEvent.create({
      data: {
        actorId: recordedById,
        action: "INVOICE_CLAIM_RESOLUTION_RECORDED",
        entityType: "InvoiceClaim",
        entityId: claimId,
        beforeData: { status: currentStatus },
        afterData: { status: "AWAITING_INTERNAL_ACTION", resolutionId: created.id, decision: input.decision },
      },
    });

    return created;
  }, TRANSACTION_OPTIONS);

  return { ok: true, id: resolution.id, claimStatus: "AWAITING_INTERNAL_ACTION" };
}

export type ApproveClaimResolutionResult =
  | { ok: true; claimStatus: ClaimStatus }
  | { ok: false; status: number; message: string };

export async function approveClaimResolution(
  claimId: string,
  resolutionId: string,
  approvedCreditAmount: string | undefined,
  approvedById: string
): Promise<ApproveClaimResolutionResult> {
  const resolution = await prisma.claimResolution.findUnique({
    where: { id: resolutionId },
    select: { id: true, claimId: true, decision: true, approvedById: true, rejectedById: true },
  });
  if (!resolution || resolution.claimId !== claimId) {
    return { ok: false, status: 404, message: "Resolution recommendation not found for this claim." };
  }
  if (resolution.approvedById) {
    return { ok: false, status: 409, message: "This resolution recommendation has already been approved." };
  }
  if (resolution.rejectedById) {
    return { ok: false, status: 409, message: "This resolution recommendation was already rejected; record a new one instead." };
  }

  const claim = await prisma.invoiceClaim.findUnique({ where: { id: claimId }, select: { status: true } });
  if (!claim) {
    return { ok: false, status: 404, message: "Claim not found." };
  }
  const currentStatus = claim.status as ClaimStatus;
  if (currentStatus !== "AWAITING_INTERNAL_ACTION") {
    return { ok: false, status: 400, message: `Cannot approve a resolution while the claim is ${currentStatus}; it must be AWAITING_INTERNAL_ACTION.` };
  }

  // Structural "recommendation -> status" mapping -- the approver cannot
  // choose a different target status than this.
  const targetStatus = resolutionDecisionToClaimStatus(resolution.decision as ResolutionDecision);
  const transition = validateClaimStatusTransition(currentStatus, targetStatus);
  if (!transition.ok) {
    return { ok: false, status: 500, message: `Internal error: approving this resolution would produce an invalid transition (${transition.message}).` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.claimResolution.update({
      where: { id: resolutionId },
      data: {
        approvedById,
        approvedAt: new Date(),
        approvedCreditAmount: approvedCreditAmount ?? null,
      },
    });

    const concludedNow = isConcludedStatus(targetStatus);
    let resolvedAtPatch: { resolvedAt: Date } | Record<string, never> = {};
    if (concludedNow) {
      const current = await tx.invoiceClaim.findUnique({ where: { id: claimId }, select: { resolvedAt: true } });
      if (current && current.resolvedAt === null) {
        resolvedAtPatch = { resolvedAt: new Date() };
      }
    }

    await tx.invoiceClaim.update({
      where: { id: claimId },
      data: {
        status: targetStatus,
        ...resolvedAtPatch,
        ...(targetStatus === "CLOSED" ? { closedAt: new Date() } : {}),
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId: approvedById,
        action: "INVOICE_CLAIM_RESOLUTION_APPROVED",
        entityType: "InvoiceClaim",
        entityId: claimId,
        beforeData: { status: currentStatus },
        afterData: { status: targetStatus, resolutionId, approvedCreditAmount: approvedCreditAmount ?? null },
      },
    });
  }, TRANSACTION_OPTIONS);

  return { ok: true, claimStatus: targetStatus };
}

export type RejectClaimResolutionResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

export async function rejectClaimResolution(
  claimId: string,
  resolutionId: string,
  rejectionReason: string,
  rejectedById: string
): Promise<RejectClaimResolutionResult> {
  const resolution = await prisma.claimResolution.findUnique({
    where: { id: resolutionId },
    select: { id: true, claimId: true, approvedById: true, rejectedById: true },
  });
  if (!resolution || resolution.claimId !== claimId) {
    return { ok: false, status: 404, message: "Resolution recommendation not found for this claim." };
  }
  if (resolution.approvedById) {
    return { ok: false, status: 409, message: "This resolution recommendation was already approved and cannot be rejected." };
  }
  if (resolution.rejectedById) {
    return { ok: false, status: 409, message: "This resolution recommendation was already rejected." };
  }

  // Rejecting a recommendation does NOT by itself change the claim's
  // status (schema comment on ClaimResolution.rejectedById) -- someone
  // still records a new resolution, or explicitly moves the claim's
  // status, as a separate action. This keeps "reject this specific
  // recommendation" and "decide what happens to the claim next" as two
  // distinct, separately-audited actions.
  await prisma.$transaction(async (tx) => {
    await tx.claimResolution.update({
      where: { id: resolutionId },
      data: { rejectedById, rejectedAt: new Date(), rejectionReason },
    });

    await tx.auditEvent.create({
      data: {
        actorId: rejectedById,
        action: "INVOICE_CLAIM_RESOLUTION_REJECTED",
        entityType: "InvoiceClaim",
        entityId: claimId,
        afterData: { resolutionId, rejectionReason },
      },
    });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}
