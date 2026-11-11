import "server-only";
import { Prisma } from "@prisma/client";
import { matchCreditNoteToClaim, type MatchCandidateClaim } from "@/lib/returns-credits/matching";
import { recomputeClaimStatusAfterActuals } from "@/lib/returns-credits/apply-status-recompute";
import type { ClaimStatus, ResolutionDecision } from "@/lib/invoice-claims/validation";

/**
 * Milestone 6B (Returns & Credit Notes). The database-touching half of
 * credit-note matching -- gathers real candidate claims for one credit
 * note's resolved base invoice and drives lib/returns-credits/matching.ts's
 * pure decision function over them, writing the result and recomputing
 * the matched claim's status. Used at import-confirm time
 * (lib/returns-credits/execute-import.ts); mirrors lib/invoice-
 * reconciliation/match-invoice.ts's own gather-then-match-then-write shape.
 */

async function gatherCandidateClaims(tx: Prisma.TransactionClient, sapInvoiceId: string): Promise<MatchCandidateClaim[]> {
  const claims = await tx.invoiceClaim.findMany({
    where: { sapInvoiceId, status: { in: ["APPROVED", "PARTIALLY_RESOLVED"] } },
    select: {
      id: true,
      status: true,
      resolutions: {
        where: { approvedById: { not: null } },
        orderBy: { approvedAt: "desc" },
        take: 1,
        select: { decision: true, approvedCreditAmount: true },
      },
    },
  });

  const candidates: MatchCandidateClaim[] = [];
  for (const claim of claims) {
    const latest = claim.resolutions[0] ?? null;

    const actualSum = await tx.creditNote.aggregate({ where: { claimId: claim.id }, _sum: { amount: true } });
    const actualCreditedTotal = (actualSum._sum.amount ?? new Prisma.Decimal(0)).toString();

    candidates.push({
      claimId: claim.id,
      status: claim.status as ClaimStatus,
      latestApprovedDecision: (latest?.decision as ResolutionDecision | undefined) ?? null,
      approvedCreditAmount: latest?.approvedCreditAmount ? latest.approvedCreditAmount.toDecimalPlaces(4).toString() : null,
      actualCreditedTotal,
    });
  }
  return candidates;
}

export interface AutoMatchCreditNoteResult {
  matched: boolean;
}

/**
 * Attempts to auto-match one currently-UNMATCHED credit note against the
 * candidate claims raised against its resolved sapInvoiceId. Left
 * UNMATCHED (matched: false, no write at all beyond what the caller
 * already did) when the credit note has no resolved sapInvoiceId, or
 * when lib/returns-credits/matching.ts's pure matcher finds zero or more
 * than one qualifying candidate -- never a best-effort guess.
 */
export async function runAutoMatchForCreditNote(
  tx: Prisma.TransactionClient,
  creditNoteId: string,
  actorId: string
): Promise<AutoMatchCreditNoteResult> {
  const creditNote = await tx.creditNote.findUniqueOrThrow({
    where: { id: creditNoteId },
    select: { sapInvoiceId: true, matchStatus: true },
  });

  if (!creditNote.sapInvoiceId || creditNote.matchStatus !== "UNMATCHED") {
    return { matched: false };
  }

  const candidates = await gatherCandidateClaims(tx, creditNote.sapInvoiceId);
  const result = matchCreditNoteToClaim(candidates);
  if (!result) return { matched: false };

  await tx.creditNote.update({
    where: { id: creditNoteId },
    data: {
      matchStatus: "AUTO_MATCHED",
      matchMethod: "AUTOMATIC",
      claimId: result.claimId,
      matchNote: result.note,
      matchedById: actorId,
      matchedAt: new Date(),
    },
  });

  await recomputeClaimStatusAfterActuals(tx, result.claimId, actorId);

  return { matched: true };
}
