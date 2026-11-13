/**
 * Milestone 15 (Decision Intelligence). Orchestrates the full rule
 * catalogue (lib/reporting/decision-rules.ts) over already-fetched
 * plain data and produces both the full candidate list and the
 * executive summary / priority queue (spec sections 3.1/3.2). Pure --
 * no Prisma import, no I/O. lib/reporting/decision-intelligence-queries.ts
 * is the only caller: it fetches each array below from the database
 * (composing M12-M14's existing query functions) and then calls
 * `evaluateAllDecisionRules` once per report request.
 */
import {
  evaluateCommercialClaimExposure,
  evaluateCommercialCreditNoteBacklog,
  evaluateCustomerDecliningValue,
  evaluateCustomerInsufficientRecentActivity,
  evaluateCustomerRepeatedClaimsReturns,
  evaluateCustomerUnresolvedQuotations,
  evaluateOperationalApprovalBottleneck,
  evaluateOperationalOrdersAwaitingFulfilment,
  evaluateOperationalUnfulfilledDemandBacklog,
  evaluateProductDecliningActivity,
  evaluateProductDeliveryRejections,
  evaluateProductInsufficientMasterData,
  evaluateProductRepeatedClaimsReturns,
  evaluateProductSignificantLostDemand,
  evaluateSalesUnresolvedQuotationsBacklog,
  evaluateSalesUnverifiedAttributionConcentration,
  type CommercialClaimExposureInput,
  type CommercialCreditNoteBacklogInput,
  type CustomerInsufficientRecentActivityInput,
  type CustomerRepeatedClaimsReturnsInput,
  type CustomerRevenueDeclineInput,
  type CustomerUnresolvedQuotationsInput,
  type OperationalApprovalBottleneckInput,
  type OperationalOrdersAwaitingFulfilmentInput,
  type OperationalUnfulfilledDemandBacklogInput,
  type ProductActivityDeclineInput,
  type ProductDeliveryRejectionsInput,
  type ProductInsufficientMasterDataInput,
  type ProductLostDemandInput,
  type ProductRepeatedClaimsReturnsInput,
  type SalesUnresolvedQuotationsBacklogInput,
  type SalesUnverifiedAttributionInput,
} from "@/lib/reporting/decision-rules";
import { sortForPriorityQueue } from "@/lib/reporting/decision-priority";
import {
  DECISION_CATEGORIES,
  DECISION_CONFIDENCES,
  DECISION_PRIORITIES,
  type DecisionIntelligenceSummary,
  type RecommendationCandidate,
} from "@/lib/reporting/decision-types";

export type DecisionRuleRawInputs = {
  period: { from: string; to: string };
  customerRevenueDeclines: CustomerRevenueDeclineInput[];
  customerRepeatedClaimsReturns: CustomerRepeatedClaimsReturnsInput[];
  customerUnresolvedQuotations: CustomerUnresolvedQuotationsInput[];
  customerInsufficientRecentActivity: CustomerInsufficientRecentActivityInput[];
  productActivityDeclines: ProductActivityDeclineInput[];
  productRepeatedClaimsReturns: ProductRepeatedClaimsReturnsInput[];
  productLostDemand: ProductLostDemandInput[];
  productDeliveryRejections: ProductDeliveryRejectionsInput[];
  productInsufficientMasterData: ProductInsufficientMasterDataInput[];
  commercialClaimExposure: CommercialClaimExposureInput[];
  commercialCreditNoteBacklog: CommercialCreditNoteBacklogInput[];
  salesUnverifiedAttribution: SalesUnverifiedAttributionInput[];
  salesUnresolvedQuotationsBacklog: SalesUnresolvedQuotationsBacklogInput[];
  operationalApprovalBottleneck: OperationalApprovalBottleneckInput;
  operationalUnfulfilledDemandBacklog: OperationalUnfulfilledDemandBacklogInput;
  operationalOrdersAwaitingFulfilment: OperationalOrdersAwaitingFulfilmentInput;
};

function compact<T>(values: readonly (T | null)[]): T[] {
  return values.filter((v): v is T => v !== null);
}

/**
 * Evaluates every rule in the catalogue against its own slice of
 * `raw` and returns the full, unsorted candidate list. Each rule is
 * independent -- one rule's output never depends on another's, so
 * the order of evaluation below carries no meaning and this function
 * is trivially safe to extend with a new rule (append it; nothing
 * else changes).
 */
export function evaluateAllDecisionRules(raw: DecisionRuleRawInputs): RecommendationCandidate[] {
  const { period } = raw;
  return [
    ...compact(raw.customerRevenueDeclines.map((i) => evaluateCustomerDecliningValue(i, period))),
    ...compact(raw.customerRepeatedClaimsReturns.map((i) => evaluateCustomerRepeatedClaimsReturns(i, period))),
    ...compact(raw.customerUnresolvedQuotations.map((i) => evaluateCustomerUnresolvedQuotations(i, period))),
    ...compact(raw.customerInsufficientRecentActivity.map((i) => evaluateCustomerInsufficientRecentActivity(i, period))),
    ...compact(raw.productActivityDeclines.map((i) => evaluateProductDecliningActivity(i, period))),
    ...compact(raw.productRepeatedClaimsReturns.map((i) => evaluateProductRepeatedClaimsReturns(i, period))),
    ...compact(raw.productLostDemand.map((i) => evaluateProductSignificantLostDemand(i, period))),
    ...compact(raw.productDeliveryRejections.map((i) => evaluateProductDeliveryRejections(i, period))),
    ...compact(raw.productInsufficientMasterData.map((i) => evaluateProductInsufficientMasterData(i, period))),
    ...compact(raw.commercialClaimExposure.map((i) => evaluateCommercialClaimExposure(i, period))),
    ...compact(raw.commercialCreditNoteBacklog.map((i) => evaluateCommercialCreditNoteBacklog(i, period))),
    ...compact(raw.salesUnverifiedAttribution.map((i) => evaluateSalesUnverifiedAttributionConcentration(i, period))),
    ...compact(raw.salesUnresolvedQuotationsBacklog.map((i) => evaluateSalesUnresolvedQuotationsBacklog(i, period))),
    ...compact([evaluateOperationalApprovalBottleneck(raw.operationalApprovalBottleneck, period)]),
    ...compact([evaluateOperationalUnfulfilledDemandBacklog(raw.operationalUnfulfilledDemandBacklog, period)]),
    ...compact([evaluateOperationalOrdersAwaitingFulfilment(raw.operationalOrdersAwaitingFulfilment, period)]),
  ];
}

/**
 * Builds the executive decision summary (spec section 3.1) and the
 * priority attention queue (spec section 3.2) from an already-
 * evaluated candidate list -- `detectedAtIso` supplies each
 * candidate's persisted firstDetectedAt/lastEvaluatedAt (the queries
 * layer knows this; a freshly-evaluated-but-not-yet-persisted
 * candidate has no such timestamp of its own, so the caller passes
 * whatever is appropriate, e.g. the evaluation run's own "now").
 * Only CRITICAL/HIGH candidates enter the queue -- MEDIUM/LOW/
 * INFORMATIONAL items are still visible in the full recommendation
 * list, just not in the attention queue itself.
 */
export function buildDecisionIntelligenceSummary(candidates: readonly RecommendationCandidate[], detectedAtIso: (candidate: RecommendationCandidate) => string): DecisionIntelligenceSummary {
  const byCategory = Object.fromEntries(DECISION_CATEGORIES.map((c) => [c, 0])) as DecisionIntelligenceSummary["byCategory"];
  const byPriority = Object.fromEntries(DECISION_PRIORITIES.map((p) => [p, 0])) as DecisionIntelligenceSummary["byPriority"];
  const byConfidence = Object.fromEntries(DECISION_CONFIDENCES.map((c) => [c, 0])) as DecisionIntelligenceSummary["byConfidence"];

  for (const candidate of candidates) {
    byCategory[candidate.decisionCategory] += 1;
    byPriority[candidate.priority] += 1;
    byConfidence[candidate.confidence] += 1;
  }

  const urgent = candidates.filter((c) => c.priority === "CRITICAL" || c.priority === "HIGH");
  const priorityQueue = sortForPriorityQueue(urgent, detectedAtIso);

  return {
    totalRecommendations: candidates.length,
    byCategory,
    byPriority,
    byConfidence,
    priorityQueue,
  };
}
