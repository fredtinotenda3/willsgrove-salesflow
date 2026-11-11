import "server-only";
import { Prisma } from "@prisma/client";
import { determineAutoAdvanceTarget } from "@/lib/returns-credits/status-recompute";
import { applyValidatedClaimStatusChange } from "@/lib/invoice-claims/claim-lifecycle";
import { validateClaimStatusTransition, type ClaimStatus, type ResolutionDecision } from "@/lib/invoice-claims/validation";

/**
 * Milestone 6B (Returns & Credit Notes). The database-touching half of
 * the auto-advance decision -- gathers the real, live inputs
 * lib/returns-credits/status-recompute.ts's determineAutoAdvanceTarget()
 * needs and writes whatever it decides, through the exact same
 * applyValidatedClaimStatusChange() helper 6A's own manual status-change
 * path uses (lib/invoice-claims/claim-lifecycle.ts), so resolvedAt/
 * closedAt bookkeeping and the audit-event shape can never drift between
 * the two callers.
 *
 * MUST be called from inside the SAME transaction that just recorded the
 * return or credit note (lib/returns-credits/returns.ts and
 * credit-notes.ts both do this) -- never as a separate follow-up
 * transaction, so a crash between "record the fact" and "recompute the
 * status" is impossible by construction, not by retry logic.
 */
export async function recomputeClaimStatusAfterActuals(
  tx: Prisma.TransactionClient,
  claimId: string,
  actorId: string | null
): Promise<void> {
  const claim = await tx.invoiceClaim.findUnique({ where: { id: claimId }, select: { status: true } });
  if (!claim) return; // defensive; callers always hold a valid claimId by this point

  const currentStatus = claim.status as ClaimStatus;
  if (currentStatus !== "APPROVED" && currentStatus !== "PARTIALLY_RESOLVED") return;

  // The most recently APPROVED resolution -- never a rejected or
  // not-yet-approved one; a recommendation is not the same as an executed
  // action (spec principle carried forward from 6A), so only an approved
  // decision can ever drive an auto-advance.
  const latestApproved = await tx.claimResolution.findFirst({
    where: { claimId, approvedById: { not: null } },
    orderBy: { approvedAt: "desc" },
    select: { decision: true, approvedCreditAmount: true },
  });

  // Live SUM, never a stored running total -- same "derive, don't store a
  // second truth" choice as every prior milestone's own aggregates.
  const actualCreditedSum = await tx.creditNote.aggregate({
    where: { claimId },
    _sum: { amount: true },
  });
  const actualCreditedTotal = (actualCreditedSum._sum.amount ?? new Prisma.Decimal(0)).toString();

  const receivedReturnCount = await tx.claimReturn.count({
    where: { claimId, receivedQuantity: { gt: 0 } },
  });

  const decision = determineAutoAdvanceTarget({
    currentStatus,
    latestApprovedDecision: (latestApproved?.decision as ResolutionDecision | undefined) ?? null,
    approvedCreditAmount: latestApproved?.approvedCreditAmount ? latestApproved.approvedCreditAmount.toDecimalPlaces(4).toString() : null,
    actualCreditedTotal,
    hasReceivedReturn: receivedReturnCount > 0,
  });

  if (!decision.advance) return;

  // Re-validate through the exhaustive transition graph before writing --
  // never trust the pure decision's own target blindly, same defensive
  // posture as lib/invoice-claims/claim-resolution.ts's own approval path.
  // Per status-recompute.ts's own analysis this should never fail (every
  // edge it can propose already exists in CLAIM_STATUS_TRANSITIONS from
  // APPROVED/PARTIALLY_RESOLVED) -- if it ever does, that's a genuine bug,
  // so this throws (aborting the whole transaction, including the
  // return/credit-note record that triggered it) rather than silently
  // recording the fact while skipping the status it was supposed to
  // justify. "Never leave the project in a broken intermediate state"
  // means the caller's action fails loudly and visibly, not half-applies.
  const transition = validateClaimStatusTransition(currentStatus, decision.toStatus);
  if (!transition.ok) {
    throw new Error(
      `Internal error: auto-advance proposed an invalid transition ${currentStatus} -> ${decision.toStatus} for claim ${claimId} (${transition.message}).`
    );
  }

  await applyValidatedClaimStatusChange(
    tx,
    claimId,
    currentStatus,
    decision.toStatus,
    actorId,
    decision.reason,
    "INVOICE_CLAIM_STATUS_AUTO_ADVANCED"
  );
}
