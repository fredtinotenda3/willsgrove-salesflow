/**
 * Milestone 15 (Decision Intelligence). Small, pure, generic helpers
 * shared by every rule in lib/reporting/decision-rules.ts -- kept
 * separate from that file so the rule catalogue itself stays readable
 * (each rule function is a short, mostly-declarative block that calls
 * into these primitives rather than re-deriving them) and so these
 * primitives get their own focused unit tests independent of any one
 * rule's business logic.
 *
 * No `@prisma/client` import anywhere in this file -- pure, unit-
 * testable, same split as lib/reporting/product-segmentation.ts.
 */
import type { DecisionConfidence, DecisionPriority, RecommendationCandidate } from "@/lib/reporting/decision-types";

/**
 * Builds a RecommendationCandidate's stable dedupe key: the rule's own
 * id plus a primary-entity key the rule itself supplies (e.g. a
 * customer id, a "sapItemCode:currency" pair, or a fixed literal for a
 * whole-business aggregate rule that only ever produces one candidate).
 * This is the identity spec section 5 requires to survive regeneration
 * -- re-evaluating the same rule against the same entity on a later
 * read must UPDATE the existing DecisionRecommendation row (preserving
 * its lifecycle status/history), never create a duplicate. Delimited
 * with "::" (never found in a cuid, a SAP item code, or a 3-letter
 * currency code) so the two halves can never collide into an
 * accidental match between two different rules.
 */
export function buildDedupeKey(ruleId: string, primaryEntityKey: string): string {
  return `${ruleId}::${primaryEntityKey}`;
}

const PRIORITY_RANK: Record<DecisionPriority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  INFORMATIONAL: 4,
};

const CONFIDENCE_RANK: Record<DecisionConfidence, number> = {
  HIGH: 0,
  MEDIUM: 1,
  LOW: 2,
  INSUFFICIENT_DATA: 3,
};

/** Lower rank = more urgent. Used for sorting, never for display (the UI shows the label, not this number). */
export function priorityRank(priority: DecisionPriority): number {
  return PRIORITY_RANK[priority];
}

export function confidenceRank(confidence: DecisionConfidence): number {
  return CONFIDENCE_RANK[confidence];
}

/**
 * Sorts candidates for the priority attention queue (spec section 3.2):
 * most urgent priority first, then (within the same priority) most
 * recently detected first -- a stable, documented, fully explainable
 * ordering, never an arbitrary composite "risk score" (spec section 17
 * explicitly forbids inventing one). `detectedAtIso` is each
 * candidate's own evaluation timestamp, supplied by the caller (pure
 * functions in this module take no implicit clock).
 */
export function sortForPriorityQueue<T extends { priority: DecisionPriority }>(candidates: readonly T[], detectedAtIso: (candidate: T) => string): T[] {
  return [...candidates].sort((a, b) => {
    const rankDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (rankDiff !== 0) return rankDiff;
    return detectedAtIso(b).localeCompare(detectedAtIso(a));
  });
}

/**
 * Classifies a percentage decline (0-100, already clamped by the
 * caller so an increase never reaches this function) into a priority
 * using one documented, shared two-band threshold -- reused identically
 * by every "declining activity" rule (CUSTOMER_DECLINING_VALUE,
 * PRODUCT_DECLINING_ACTIVITY) so the bands can't drift apart between
 * rules that are conceptually the same shape. Never CRITICAL: a
 * revenue/activity decline, however large, is an attention item, not
 * an emergency -- CRITICAL is reserved in this rule catalogue for
 * rules whose evidence is a direct, currently-unresolved financial or
 * operational exposure (see decision-rules.ts's COMMERCIAL_EXPOSURE
 * and OPERATIONAL_APPROVAL_BOTTLENECK rules).
 */
export function classifyDeclinePriority(declinePercent: number): DecisionPriority {
  if (declinePercent >= 75) return "HIGH";
  return "MEDIUM";
}

/**
 * Classifies a repeated-count signal (claims, returns, unresolved
 * quotations, delivery rejections) shared by several rules across
 * categories. The "cutoff of 2" floor itself is applied by the calling
 * rule (each one documents why 2 is the right floor for its own
 * evidence, following M14's own precedent of the same cutoff for
 * claims/returns); this function only maps an already-qualified count
 * onto a priority band.
 */
export function classifyRepeatedCountPriority(count: number, highThreshold: number): DecisionPriority {
  return count >= highThreshold ? "HIGH" : "MEDIUM";
}

/** Rounds to one decimal place -- the same precision convention lib/reporting/sales-pipeline.ts's ratePercent already uses for percentages shown in this reporting layer. */
export function roundToOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Percent decline of `current` relative to `previous`, clamped to
 * [0, 100] -- an INCREASE (current >= previous) always returns 0,
 * since "declining activity" rules only ever fire on an actual
 * decline, never an improvement. Returns null when `previous` is 0 (or
 * negative, which should never occur for a revenue/quantity figure but
 * is guarded defensively) -- there is no baseline to decline from, and
 * the calling rule must treat that as "does not apply," never as a
 * 100% decline.
 */
export function percentDecline(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  if (current >= previous) return 0;
  return roundToOneDecimal(((previous - current) / previous) * 100);
}

/** Sorts RecommendationCandidate[] for the full list endpoint's default order -- same priority-first rule as sortForPriorityQueue, exposed under the decision-types.ts candidate shape directly since that is what callers of this module actually hold. */
export function sortCandidatesByPriority(candidates: readonly RecommendationCandidate[]): RecommendationCandidate[] {
  return [...candidates].sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority));
}
