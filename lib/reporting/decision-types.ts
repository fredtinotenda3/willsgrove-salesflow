import "server-only";

/**
 * Milestone 15 (Decision Intelligence). Shared types for the decision-
 * intelligence rule engine and its persistence layer.
 *
 * These mirror prisma/schema.prisma's DecisionCategory/DecisionPriority/
 * DecisionConfidence/DecisionRecommendationStatus enums EXACTLY (same
 * literal values) -- duplicated here, rather than imported from
 * `@prisma/client`, so that lib/reporting/decision-rules.ts and
 * lib/reporting/decision-recommendations.ts stay pure (no `@prisma/
 * client` import, same "pure calculation module" split M12-M14 already
 * established -- see lib/reporting/product-segmentation.ts's own header
 * comment for why that split matters: these modules are unit-tested
 * directly, with no database and no Prisma-generated client involved).
 * lib/reporting/decision-intelligence-queries.ts (the Prisma-backed
 * layer) is responsible for keeping these two sets of literals in sync;
 * a mismatch would surface immediately as a Prisma enum-validation
 * error the moment that module tries to persist a value this file
 * doesn't know about.
 */

export const DECISION_CATEGORIES = ["SALES", "CUSTOMER", "PRODUCT", "COMMERCIAL_EXPOSURE", "OPERATIONAL"] as const;
export type DecisionCategory = (typeof DECISION_CATEGORIES)[number];

export const DECISION_PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"] as const;
export type DecisionPriority = (typeof DECISION_PRIORITIES)[number];

export const DECISION_CONFIDENCES = ["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA"] as const;
export type DecisionConfidence = (typeof DECISION_CONFIDENCES)[number];

export const DECISION_RECOMMENDATION_STATUSES = ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DISMISSED"] as const;
export type DecisionRecommendationStatus = (typeof DECISION_RECOMMENDATION_STATUSES)[number];

/**
 * Valid status transitions for the recommendation lifecycle (spec
 * section 5). RESOLVED and DISMISSED are terminal but NOT dead ends --
 * REOPENED (back to OPEN) is allowed from either, because a later
 * rule re-evaluation (or a human) may determine the underlying issue
 * has recurred or was dismissed in error; spec section 6 requires the
 * full history to be preserved regardless, so re-opening never erases
 * the earlier RESOLVED/DISMISSED event.
 */
export const DECISION_RECOMMENDATION_STATUS_TRANSITIONS: Record<DecisionRecommendationStatus, readonly DecisionRecommendationStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DISMISSED"],
  ACKNOWLEDGED: ["IN_PROGRESS", "RESOLVED", "DISMISSED", "OPEN"],
  IN_PROGRESS: ["RESOLVED", "DISMISSED", "OPEN", "ACKNOWLEDGED"],
  RESOLVED: ["OPEN"],
  DISMISSED: ["OPEN"],
};

export function isValidDecisionStatusTransition(from: DecisionRecommendationStatus, to: DecisionRecommendationStatus): boolean {
  if (from === to) return false;
  return DECISION_RECOMMENDATION_STATUS_TRANSITIONS[from].includes(to);
}

/** One reference to a real source record backing a recommendation (spec section 4: "source record references"). `href` lets the UI/export link straight to the existing page for that record -- this module never re-renders that record's own detail itself. */
export type EvidenceSourceRecord = {
  type: string;
  id: string;
  label: string;
  href?: string;
};

/** The full evidence payload persisted on DecisionRecommendation.evidence (Json). `metrics` is a flat, JSON-safe map of the exact numbers the rule's explanation refers to -- every number a human would need to verify the recommendation by hand against the source data. */
export type DecisionEvidence = {
  metrics: Record<string, string | number | null>;
  sourceRecords: EvidenceSourceRecord[];
  /** Plain-English basis for this evaluation's confidence classification -- spec section 4: "confidence classification... with the basis for each confidence level documented." */
  confidenceBasis: string;
};

/**
 * One rule's output for one evaluated entity. Produced purely by
 * lib/reporting/decision-rules.ts (no Prisma, no I/O) from already-
 * fetched plain data -- lib/reporting/decision-intelligence-queries.ts
 * is the only module that turns this into a persisted
 * DecisionRecommendation row (via `dedupeKey`).
 */
export type RecommendationCandidate = {
  /** ruleId + the rule's own primary-entity key -- see decision-priority.ts's buildDedupeKey. Globally unique and stable across re-evaluations. */
  dedupeKey: string;
  ruleId: string;
  ruleVersion: number;
  decisionCategory: DecisionCategory;
  priority: DecisionPriority;
  confidence: DecisionConfidence;
  title: string;
  explanation: string;
  evidence: DecisionEvidence;
  recommendedNextAction: string;
  customerId?: string | null;
  productId?: string | null;
  sapItemCode?: string | null;
  salespersonId?: string | null;
  quotationId?: string | null;
  customerOrderId?: string | null;
  currencyCode?: string | null;
  reportingPeriodFrom: string;
  reportingPeriodTo: string;
};

/** Counts behind the executive decision summary (spec section 3.1) and the priority attention queue (spec section 3.2) -- computed purely from an already-evaluated candidate list, never re-queried. */
export type DecisionIntelligenceSummary = {
  totalRecommendations: number;
  byCategory: Record<DecisionCategory, number>;
  byPriority: Record<DecisionPriority, number>;
  byConfidence: Record<DecisionConfidence, number>;
  /** CRITICAL/HIGH recommendations only, sorted priority-first then most-recently-detected -- the "priority attention queue" itself (spec section 3.2). */
  priorityQueue: RecommendationCandidate[];
};
