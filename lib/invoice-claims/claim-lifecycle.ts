import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import {
  type ClaimStatus,
  validateClaimStatusTransition,
  isConcludedStatus,
} from "@/lib/invoice-claims/validation";

/**
 * Milestone 6A. Claim status transitions.
 *
 * Route-layer convention for this one action (confirmed design, see
 * PROGRESS.md's Milestone 6A section): the ROUTE itself
 * (app/api/invoice-claims/[id]/status/route.ts) stays open to any
 * authenticated user, then inline-checks the acting user's role only for
 * the specific transition being requested -- `requiresApproval` below is
 * exactly that signal. This function itself stays role-agnostic and
 * takes the acting user's role as a plain parameter so the route can
 * make that one inline check without this function silently re-deciding
 * authorization on its own.
 */

export type ChangeClaimStatusResult =
  | { ok: true; status: ClaimStatus }
  | { ok: false; status: number; message: string; requiresApproval?: true };

/**
 * Milestone 6B addition: the actual status-write + resolvedAt/closedAt
 * bookkeeping + audit-event write, factored out of changeClaimStatus()
 * below so lib/returns-credits/status-recompute.ts's own auto-advance
 * path (triggered by recording an actual return or credit note) writes
 * through the exact same code, not a second hand-copied version that
 * could silently drift. The CALLER is responsible for having already
 * validated the transition via validateClaimStatusTransition() and for
 * deciding whether the actor is authorized -- this function only ever
 * writes a transition it is handed, so every caller must still route
 * through that validator first (both existing callers do).
 */
export async function applyValidatedClaimStatusChange(
  tx: Prisma.TransactionClient,
  claimId: string,
  currentStatus: ClaimStatus,
  toStatus: ClaimStatus,
  actorId: string | null,
  reason: string,
  auditAction: string
): Promise<void> {
  const concludedNow = isConcludedStatus(toStatus);

  // resolvedAt is set the first time the claim reaches ANY concluded
  // status (RESOLVED/PARTIALLY_RESOLVED/REJECTED/CLOSED) -- never
  // overwritten on a later transition between concluded statuses, so
  // "average resolution time" reflects the FIRST conclusion, not the
  // most recent status edit. Read-modify within the same transaction
  // since Prisma has no "set if currently null" update shorthand.
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
      status: toStatus,
      ...resolvedAtPatch,
      ...(toStatus === "CLOSED" ? { closedAt: new Date() } : {}),
    },
  });

  await tx.auditEvent.create({
    data: {
      actorId,
      action: auditAction,
      entityType: "InvoiceClaim",
      entityId: claimId,
      beforeData: { status: currentStatus },
      afterData: { status: toStatus, reason },
    },
  });
}

export async function changeClaimStatus(
  claimId: string,
  toStatus: ClaimStatus,
  reason: string,
  actorId: string,
  actorRole: string
): Promise<ChangeClaimStatusResult> {
  const claim = await prisma.invoiceClaim.findUnique({ where: { id: claimId }, select: { id: true, status: true } });
  if (!claim) {
    return { ok: false, status: 404, message: "Claim not found." };
  }

  const currentStatus = claim.status as ClaimStatus;
  const transition = validateClaimStatusTransition(currentStatus, toStatus);
  if (!transition.ok) {
    return { ok: false, status: 400, message: transition.message };
  }

  if (transition.requiresApproval && actorRole !== "SALES_MANAGER" && actorRole !== "ADMINISTRATOR") {
    return {
      ok: false,
      status: 403,
      message: "Only a sales manager or administrator may approve this transition.",
      requiresApproval: true,
    };
  }

  await prisma.$transaction(
    (tx) => applyValidatedClaimStatusChange(tx, claimId, currentStatus, toStatus, actorId, reason, "INVOICE_CLAIM_STATUS_CHANGED"),
    TRANSACTION_OPTIONS
  );

  return { ok: true, status: toStatus };
}
