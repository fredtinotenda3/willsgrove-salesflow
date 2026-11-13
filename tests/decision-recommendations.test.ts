import { describe, it, expect } from "vitest";
import { evaluateAllDecisionRules, buildDecisionIntelligenceSummary, type DecisionRuleRawInputs } from "@/lib/reporting/decision-recommendations";

/**
 * Milestone 15 (Decision Intelligence). Unconditional unit tests for
 * lib/reporting/decision-recommendations.ts -- the pure orchestrator
 * that runs every rule in the catalogue over already-fetched plain data
 * and builds the executive summary / priority queue (spec sections
 * 3.1/3.2). No database, no mocking.
 */

const PERIOD = { from: "2026-01-01", to: "2026-01-31" };

function emptyRawInputs(): DecisionRuleRawInputs {
  return {
    period: PERIOD,
    customerRevenueDeclines: [],
    customerRepeatedClaimsReturns: [],
    customerUnresolvedQuotations: [],
    customerInsufficientRecentActivity: [],
    productActivityDeclines: [],
    productRepeatedClaimsReturns: [],
    productLostDemand: [],
    productDeliveryRejections: [],
    productInsufficientMasterData: [],
    commercialClaimExposure: [],
    commercialCreditNoteBacklog: [],
    salesUnverifiedAttribution: [],
    salesUnresolvedQuotationsBacklog: [],
    operationalApprovalBottleneck: { overdueCount: 0 },
    operationalUnfulfilledDemandBacklog: { openCount: 0 },
    operationalOrdersAwaitingFulfilment: { awaitingCount: 0 },
  };
}

describe("evaluateAllDecisionRules", () => {
  it("returns an empty array when every input slice is empty/below-floor -- never fabricates a recommendation from nothing", () => {
    expect(evaluateAllDecisionRules(emptyRawInputs())).toEqual([]);
  });

  it("evaluates each array-shaped rule input independently, one candidate per qualifying row", () => {
    const raw = emptyRawInputs();
    raw.customerRepeatedClaimsReturns = [
      { customerId: "cust-1", customerName: "Acme", claimCount: 2, returnCount: 0 },
      { customerId: "cust-2", customerName: "Beta Co", claimCount: 0, returnCount: 3 },
      { customerId: "cust-3", customerName: "No Signal", claimCount: 0, returnCount: 0 },
    ];
    const candidates = evaluateAllDecisionRules(raw);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.customerId).sort()).toEqual(["cust-1", "cust-2"]);
  });

  it("evaluates each scalar-shaped (whole-business aggregate) rule input exactly once", () => {
    const raw = emptyRawInputs();
    raw.operationalApprovalBottleneck = { overdueCount: 2 };
    raw.operationalUnfulfilledDemandBacklog = { openCount: 10 };
    const candidates = evaluateAllDecisionRules(raw);
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.ruleId).sort()).toEqual(["OPERATIONAL_APPROVAL_BOTTLENECK", "OPERATIONAL_UNFULFILLED_DEMAND_BACKLOG"]);
  });

  it("one rule's output never depends on another's -- combining unrelated firing inputs produces the union of their candidates, not a merged or deduplicated set", () => {
    const raw = emptyRawInputs();
    raw.customerUnresolvedQuotations = [{ customerId: "cust-1", customerName: "Acme", unresolvedCount: 1 }];
    raw.salesUnresolvedQuotationsBacklog = [{ salespersonId: "sp-1", salespersonName: "Jane", unresolvedCount: 3 }];
    const candidates = evaluateAllDecisionRules(raw);
    expect(candidates).toHaveLength(2);
    expect(candidates.find((c) => c.ruleId === "CUSTOMER_UNRESOLVED_QUOTATIONS")).toBeDefined();
    expect(candidates.find((c) => c.ruleId === "SALES_UNRESOLVED_QUOTATIONS_BACKLOG")).toBeDefined();
  });
});

describe("buildDecisionIntelligenceSummary", () => {
  it("returns all-zero counts and an empty priority queue for an empty candidate list", () => {
    const summary = buildDecisionIntelligenceSummary([], () => "2026-01-01T00:00:00.000Z");
    expect(summary.totalRecommendations).toBe(0);
    expect(summary.priorityQueue).toEqual([]);
    expect(Object.values(summary.byCategory).every((n) => n === 0)).toBe(true);
    expect(Object.values(summary.byPriority).every((n) => n === 0)).toBe(true);
    expect(Object.values(summary.byConfidence).every((n) => n === 0)).toBe(true);
  });

  it("tallies byCategory/byPriority/byConfidence correctly across a mixed candidate list", () => {
    const raw = emptyRawInputs();
    raw.operationalApprovalBottleneck = { overdueCount: 10 }; // CRITICAL / OPERATIONAL / HIGH confidence
    raw.customerRepeatedClaimsReturns = [{ customerId: "cust-1", customerName: "Acme", claimCount: 2, returnCount: 0 }]; // MEDIUM / CUSTOMER / HIGH confidence
    raw.customerInsufficientRecentActivity = [{ customerId: "cust-2", customerName: "Beta", daysSinceLastOrder: null, hasAnyOrderHistory: false, recencyThresholdDays: 90 }]; // INFORMATIONAL / CUSTOMER / INSUFFICIENT_DATA
    const candidates = evaluateAllDecisionRules(raw);
    const summary = buildDecisionIntelligenceSummary(candidates, () => "2026-01-01T00:00:00.000Z");

    expect(summary.totalRecommendations).toBe(3);
    expect(summary.byCategory.OPERATIONAL).toBe(1);
    expect(summary.byCategory.CUSTOMER).toBe(2);
    expect(summary.byPriority.CRITICAL).toBe(1);
    expect(summary.byPriority.MEDIUM).toBe(1);
    expect(summary.byPriority.INFORMATIONAL).toBe(1);
    expect(summary.byConfidence.HIGH).toBe(2);
    expect(summary.byConfidence.INSUFFICIENT_DATA).toBe(1);
  });

  it("the priority queue contains ONLY CRITICAL/HIGH candidates -- MEDIUM/LOW/INFORMATIONAL are tallied but excluded from the queue", () => {
    const raw = emptyRawInputs();
    raw.operationalApprovalBottleneck = { overdueCount: 10 }; // CRITICAL
    raw.customerRepeatedClaimsReturns = [{ customerId: "cust-1", customerName: "Acme", claimCount: 2, returnCount: 0 }]; // MEDIUM
    const candidates = evaluateAllDecisionRules(raw);
    const summary = buildDecisionIntelligenceSummary(candidates, () => "2026-01-01T00:00:00.000Z");

    expect(summary.priorityQueue).toHaveLength(1);
    expect(summary.priorityQueue[0].ruleId).toBe("OPERATIONAL_APPROVAL_BOTTLENECK");
    expect(summary.totalRecommendations).toBe(2);
  });

  it("sorts the priority queue priority-first using the supplied detectedAtIso accessor", () => {
    const raw = emptyRawInputs();
    raw.operationalUnfulfilledDemandBacklog = { openCount: 20 }; // HIGH
    raw.operationalApprovalBottleneck = { overdueCount: 10 }; // CRITICAL
    const candidates = evaluateAllDecisionRules(raw);
    const summary = buildDecisionIntelligenceSummary(candidates, () => "2026-01-01T00:00:00.000Z");

    expect(summary.priorityQueue.map((c) => c.priority)).toEqual(["CRITICAL", "HIGH"]);
  });

  it("never introduces a blended/composite score anywhere in the summary", () => {
    const summary = buildDecisionIntelligenceSummary([], () => "2026-01-01T00:00:00.000Z");
    expect(Object.keys(summary)).not.toContain("compositeScore");
    expect(Object.keys(summary)).not.toContain("overallRiskScore");
  });
});
