import { parseScaledDecimal } from "@/lib/picking/validation";
import type { ClaimStatus, ResolutionDecision } from "@/lib/invoice-claims/validation";

/**
 * Milestone 6B (Returns & Credit Notes). Pure, deterministic, conservative
 * automatic matching of an imported credit note to the one claim it
 * settles -- no `@prisma/client` import, no I/O; lib/returns-credits/
 * execute-import.ts does the database work and calls this with plain data.
 * Same shape and same philosophy as lib/invoice-reconciliation/matching.ts:
 * ambiguous (zero or multiple candidates) always resolves to `null` --
 * never a best-effort guess -- so the record lands UNMATCHED for manual
 * reconciliation (see lib/returns-credits/credit-notes.ts's
 * manuallyMatchCreditNote()).
 *
 * Confirmed matching granularity: a credit note matches to a CLAIM, not a
 * claim line -- financial exposure is already tracked claim-level in 6A
 * (ClaimResolution.approvedCreditAmount), so there is no CreditNoteLine
 * model and nothing here reads SAP item codes. The caller is responsible
 * for having already scoped `candidates` to claims raised against the
 * credit note's own resolved sapInvoiceId (never guessed -- see
 * execute-import.ts's resolution of baseInvoiceDocEntry/baseInvoiceDocNum
 * against an already-imported SapInvoice) and for having already loaded,
 * per claim, the decision and amount of its most recently APPROVED
 * ClaimResolution plus the live sum of CreditNote.amount already recorded
 * against it.
 */

export interface MatchCandidateClaim {
  claimId: string;
  status: ClaimStatus;
  /** The decision of the most recently APPROVED resolution on this claim,
   * or null if it somehow has none. */
  latestApprovedDecision: ResolutionDecision | null;
  /** That resolution's approvedCreditAmount, as a decimal string, or null
   * when the decision implies no credit at all. */
  approvedCreditAmount: string | null;
  /** Live sum of every CreditNote.amount already recorded against this
   * claim (NOT including the one currently being matched), as a
   * non-negative decimal string. */
  actualCreditedTotal: string;
}

export interface CreditNoteMatchResult {
  claimId: string;
  note: string;
}

const CREDIT_BEARING_DECISIONS: ReadonlySet<ResolutionDecision> = new Set([
  "PARTIAL_CREDIT_RECOMMENDED",
  "FULL_CREDIT_RECOMMENDED",
  "PRICING_CORRECTION_REQUIRED",
]);

/**
 * Auto-matches only when exactly one candidate claim:
 *  - is APPROVED or PARTIALLY_RESOLVED;
 *  - has a credit-bearing latest-approved decision (PARTIAL_CREDIT_
 *    RECOMMENDED / FULL_CREDIT_RECOMMENDED / PRICING_CORRECTION_REQUIRED);
 *  - still has outstanding exposure -- approvedCreditAmount minus what has
 *    already actually been credited is strictly greater than zero.
 *
 * A claim with zero remaining exposure (already fully credited) is never
 * offered as a candidate for a NEW credit note -- a further credit note
 * against it is exactly the "actual exceeds approved" exception that
 * lib/invoice-claims/financial.ts's actualExceedsApproved flag surfaces,
 * and surfacing an exception is not the same operation as silently
 * routing more money to a claim that doesn't need it; it lands UNMATCHED
 * for a human to decide, same as any other ambiguous case here.
 */
export function matchCreditNoteToClaim(candidates: MatchCandidateClaim[]): CreditNoteMatchResult | null {
  const qualifying = candidates.filter((candidate) => {
    if (candidate.status !== "APPROVED" && candidate.status !== "PARTIALLY_RESOLVED") return false;
    if (!candidate.latestApprovedDecision || !CREDIT_BEARING_DECISIONS.has(candidate.latestApprovedDecision)) return false;

    const approvedScaled = candidate.approvedCreditAmount ? parseScaledDecimal(candidate.approvedCreditAmount) ?? BigInt(0) : BigInt(0);
    const actualScaled = parseScaledDecimal(candidate.actualCreditedTotal) ?? BigInt(0);
    const remaining = approvedScaled - actualScaled;
    return remaining > BigInt(0);
  });

  if (qualifying.length !== 1) return null;

  const chosen = qualifying[0];
  return {
    claimId: chosen.claimId,
    note: "Matched to the only outstanding credit-bearing claim against this invoice.",
  };
}
