import { parseScaledDecimal } from "@/lib/picking/validation";
import type { ClaimStatus, ResolutionDecision } from "@/lib/invoice-claims/validation";

/**
 * Milestone 6B (Returns & Credit Notes). Pure decision logic for
 * auto-advancing a claim's status once an actual return or credit note is
 * recorded against it -- no `@prisma/client` import, no I/O; the DB-
 * touching counterpart (lib/returns-credits/apply-status-recompute.ts)
 * gathers these inputs live and then calls
 * lib/invoice-claims/claim-lifecycle.ts's applyValidatedClaimStatusChange()
 * with whatever this function decides, so this decision can be unit
 * tested in isolation (same pure/impure split as lib/invoice-reconciliation/
 * matching.ts + match-invoice.ts).
 *
 * Confirmed design (see docs/milestones/PROGRESS.md's Milestone 6B
 * section): recording an actual return or credit note auto-advances the
 * claim's status when it now justifies that -- but this function only
 * ever NAMES a target status; the caller still runs it through
 * validateClaimStatusTransition() before writing, so an auto-advance can
 * never skip a step or reach a status the transition graph itself
 * disallows (the mapping below is designed to only ever propose edges
 * CLAIM_STATUS_TRANSITIONS already allows from APPROVED/PARTIALLY_RESOLVED
 * -- RESOLVED and PARTIALLY_RESOLVED are both reachable from either, per
 * lib/invoice-claims/validation.ts -- but the caller re-checks anyway
 * rather than trusting that invariant blindly).
 *
 * Only ever triggers from APPROVED or PARTIALLY_RESOLVED -- every other
 * status (OPEN, UNDER_INVESTIGATION, AWAITING_CUSTOMER,
 * AWAITING_INTERNAL_ACTION, RESOLVED, REJECTED, CLOSED) has nothing for
 * this function to recompute, since a return/credit note can only be
 * recorded once a resolution has actually been approved (enforced in
 * lib/returns-credits/returns.ts and credit-notes.ts, not here).
 *
 * Only three resolution decisions are ever acted on here -- exactly the
 * set lib/invoice-claims/display.ts's RESOLUTIONS_IMPLYING_6B_FOLLOWUP
 * already names (PHYSICAL_RETURN_REQUIRED, PARTIAL_CREDIT_RECOMMENDED,
 * FULL_CREDIT_RECOMMENDED) plus PRICING_CORRECTION_REQUIRED, which is
 * also money-bearing and was simply not yet given its own Milestone 6B
 * handling when that set was written in 6A -- a pricing correction is
 * settled by exactly one corrective credit note, same shape as a full
 * credit. REPLACEMENT_APPROVED, NO_ACTION_REQUIRED (already resolved at
 * approval time), CLAIM_REJECTED, DELIVERY_INVESTIGATION_REQUIRED, and
 * OTHER are deliberately left alone -- recording a return or credit note
 * against one of those claims (which this module's callers never do on
 * their own initiative) would do nothing here, and the claim stays
 * exactly where a human last put it.
 */

export interface AutoAdvanceInput {
  currentStatus: ClaimStatus;
  /** The decision of the most recently APPROVED resolution on this claim
   * (null if the claim somehow has none -- defensive; APPROVED/
   * PARTIALLY_RESOLVED should always have one). */
  latestApprovedDecision: ResolutionDecision | null;
  /** That same resolution's approvedCreditAmount, as a decimal string, or
   * null when the decision implies no credit at all. */
  approvedCreditAmount: string | null;
  /** Live sum of every CreditNote.amount recorded against this claim, as
   * a non-negative decimal string -- "0.0000" when none yet. */
  actualCreditedTotal: string;
  /** True when at least one ClaimReturn with receivedQuantity > 0 has
   * been recorded against this claim. */
  hasReceivedReturn: boolean;
}

export type AutoAdvanceResult =
  | { advance: true; toStatus: ClaimStatus; reason: string }
  | { advance: false };

const CREDIT_BEARING_DECISIONS: ReadonlySet<ResolutionDecision> = new Set([
  "PARTIAL_CREDIT_RECOMMENDED",
  "FULL_CREDIT_RECOMMENDED",
  "PRICING_CORRECTION_REQUIRED",
]);

export function determineAutoAdvanceTarget(input: AutoAdvanceInput): AutoAdvanceResult {
  if (input.currentStatus !== "APPROVED" && input.currentStatus !== "PARTIALLY_RESOLVED") {
    return { advance: false };
  }
  if (!input.latestApprovedDecision) {
    return { advance: false };
  }

  const decision = input.latestApprovedDecision;

  if (decision === "PHYSICAL_RETURN_REQUIRED") {
    // No credit involved at all -- resolved purely by the warehouse
    // actually receiving goods back, never by any CreditNote. No
    // "already RESOLVED" guard is needed here: input.currentStatus is
    // narrowed to APPROVED | PARTIALLY_RESOLVED by the check above, so it
    // can never already BE RESOLVED at this point.
    if (input.hasReceivedReturn) {
      return { advance: true, toStatus: "RESOLVED", reason: "Physical return received; claim auto-resolved." };
    }
    return { advance: false };
  }

  if (!CREDIT_BEARING_DECISIONS.has(decision)) {
    // REPLACEMENT_APPROVED, NO_ACTION_REQUIRED, CLAIM_REJECTED,
    // DELIVERY_INVESTIGATION_REQUIRED, OTHER -- nothing to auto-advance.
    return { advance: false };
  }

  const actualScaled = parseScaledDecimal(input.actualCreditedTotal) ?? BigInt(0);
  if (actualScaled <= BigInt(0)) {
    return { advance: false }; // nothing recorded yet
  }

  if (decision === "PARTIAL_CREDIT_RECOMMENDED") {
    // Partial by its own classification already, regardless of how much
    // of the approved amount has actually been credited so far -- any
    // real credit note at all resolves it as PARTIALLY_RESOLVED, never
    // silently escalated to fully RESOLVED just because the amounts
    // happen to match (a manager explicitly chose "partial").
    if (input.currentStatus !== "PARTIALLY_RESOLVED") {
      return { advance: true, toStatus: "PARTIALLY_RESOLVED", reason: "Partial credit note recorded; claim auto-advanced." };
    }
    return { advance: false };
  }

  // FULL_CREDIT_RECOMMENDED or PRICING_CORRECTION_REQUIRED: fully
  // resolved only once the actual credited total reaches (or exceeds --
  // never clamped, matching Milestone 5's own over-invoicing philosophy;
  // lib/invoice-claims/financial.ts's actualExceedsApproved flag is where
  // an excess is surfaced, not here) what was approved. Interim partial
  // progress toward that figure is still PARTIALLY_RESOLVED rather than
  // silently staying APPROVED forever while real money has already moved.
  const approvedScaled = input.approvedCreditAmount ? parseScaledDecimal(input.approvedCreditAmount) ?? BigInt(0) : BigInt(0);

  if (approvedScaled > BigInt(0) && actualScaled >= approvedScaled) {
    // Same narrowing note as the PHYSICAL_RETURN_REQUIRED branch above --
    // currentStatus can never already be RESOLVED here.
    return { advance: true, toStatus: "RESOLVED", reason: "Credit note recorded in full; claim auto-resolved." };
  }

  if (input.currentStatus !== "PARTIALLY_RESOLVED") {
    return { advance: true, toStatus: "PARTIALLY_RESOLVED", reason: "Partial progress toward the approved credit recorded; claim auto-advanced." };
  }
  return { advance: false };
}
