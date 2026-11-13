import { describe, it, expect } from "vitest";
import {
  buildDedupeKey,
  priorityRank,
  confidenceRank,
  sortForPriorityQueue,
  classifyDeclinePriority,
  classifyRepeatedCountPriority,
  roundToOneDecimal,
  percentDecline,
  sortCandidatesByPriority,
} from "@/lib/reporting/decision-priority";
import type { DecisionPriority, RecommendationCandidate } from "@/lib/reporting/decision-types";

/**
 * Milestone 15 (Decision Intelligence). Unconditional unit tests for
 * lib/reporting/decision-priority.ts -- pure, generic helpers shared by
 * every rule in decision-rules.ts. No @prisma/client import, no
 * database, runnable without RUN_DB_INTEGRATION_TESTS.
 */

describe("buildDedupeKey", () => {
  it("joins ruleId and primaryEntityKey with a :: delimiter", () => {
    expect(buildDedupeKey("CUSTOMER_DECLINING_VALUE", "cust-1:USD")).toBe("CUSTOMER_DECLINING_VALUE::cust-1:USD");
  });

  it("produces distinct keys for distinct entities under the same rule, and the same key for the same rule+entity (the stable identity spec section 5 requires)", () => {
    const a = buildDedupeKey("RULE", "entity-1");
    const b = buildDedupeKey("RULE", "entity-2");
    const aAgain = buildDedupeKey("RULE", "entity-1");
    expect(a).not.toBe(b);
    expect(a).toBe(aAgain);
  });
});

describe("priorityRank / confidenceRank", () => {
  it("ranks priorities most-urgent-first: CRITICAL < HIGH < MEDIUM < LOW < INFORMATIONAL", () => {
    expect(priorityRank("CRITICAL")).toBeLessThan(priorityRank("HIGH"));
    expect(priorityRank("HIGH")).toBeLessThan(priorityRank("MEDIUM"));
    expect(priorityRank("MEDIUM")).toBeLessThan(priorityRank("LOW"));
    expect(priorityRank("LOW")).toBeLessThan(priorityRank("INFORMATIONAL"));
  });

  it("ranks confidence most-reliable-first: HIGH < MEDIUM < LOW < INSUFFICIENT_DATA", () => {
    expect(confidenceRank("HIGH")).toBeLessThan(confidenceRank("MEDIUM"));
    expect(confidenceRank("MEDIUM")).toBeLessThan(confidenceRank("LOW"));
    expect(confidenceRank("LOW")).toBeLessThan(confidenceRank("INSUFFICIENT_DATA"));
  });
});

describe("sortForPriorityQueue", () => {
  it("sorts by priority first (CRITICAL before HIGH before MEDIUM)", () => {
    const items: { id: string; priority: DecisionPriority }[] = [
      { id: "a", priority: "MEDIUM" },
      { id: "b", priority: "CRITICAL" },
      { id: "c", priority: "HIGH" },
    ];
    const sorted = sortForPriorityQueue(items, () => "2026-01-01T00:00:00.000Z");
    expect(sorted.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("within the same priority, sorts most-recently-detected first", () => {
    const items: { id: string; priority: DecisionPriority }[] = [
      { id: "older", priority: "HIGH" },
      { id: "newer", priority: "HIGH" },
    ];
    const timestamps: Record<string, string> = { older: "2026-01-01T00:00:00.000Z", newer: "2026-06-01T00:00:00.000Z" };
    const sorted = sortForPriorityQueue(items, (i) => timestamps[i.id]);
    expect(sorted.map((i) => i.id)).toEqual(["newer", "older"]);
  });

  it("does not mutate the input array", () => {
    const items: { id: string; priority: DecisionPriority }[] = [
      { id: "a", priority: "MEDIUM" },
      { id: "b", priority: "CRITICAL" },
    ];
    const original = [...items];
    sortForPriorityQueue(items, () => "2026-01-01T00:00:00.000Z");
    expect(items).toEqual(original);
  });
});

describe("classifyDeclinePriority", () => {
  it("returns HIGH at and above the 75% boundary", () => {
    expect(classifyDeclinePriority(75)).toBe("HIGH");
    expect(classifyDeclinePriority(100)).toBe("HIGH");
  });

  it("returns MEDIUM below the 75% boundary (down to the rule's own fire threshold)", () => {
    expect(classifyDeclinePriority(74.9)).toBe("MEDIUM");
    expect(classifyDeclinePriority(40)).toBe("MEDIUM");
  });

  it("never returns CRITICAL -- an activity decline is an attention item, not an emergency", () => {
    const sample = [0, 10, 40, 74.9, 75, 90, 100];
    for (const decline of sample) {
      expect(classifyDeclinePriority(decline)).not.toBe("CRITICAL");
    }
  });
});

describe("classifyRepeatedCountPriority", () => {
  it("returns HIGH at and above the supplied threshold", () => {
    expect(classifyRepeatedCountPriority(4, 4)).toBe("HIGH");
    expect(classifyRepeatedCountPriority(10, 4)).toBe("HIGH");
  });

  it("returns MEDIUM below the supplied threshold", () => {
    expect(classifyRepeatedCountPriority(3, 4)).toBe("MEDIUM");
    expect(classifyRepeatedCountPriority(2, 4)).toBe("MEDIUM");
  });

  it("respects a different threshold per call (rules use different floors)", () => {
    expect(classifyRepeatedCountPriority(5, 5)).toBe("HIGH");
    expect(classifyRepeatedCountPriority(4, 5)).toBe("MEDIUM");
  });
});

describe("roundToOneDecimal", () => {
  it("rounds to one decimal place", () => {
    expect(roundToOneDecimal(33.333)).toBe(33.3);
    expect(roundToOneDecimal(33.36)).toBe(33.4);
    expect(roundToOneDecimal(10)).toBe(10);
  });
});

describe("percentDecline", () => {
  it("returns null when previous is zero -- no baseline to decline from", () => {
    expect(percentDecline(0, 0)).toBeNull();
    expect(percentDecline(100, 0)).toBeNull();
  });

  it("returns null when previous is negative (defensive guard against a figure that should never occur)", () => {
    expect(percentDecline(10, -5)).toBeNull();
  });

  it("returns 0 for an increase or flat figure -- never a negative decline", () => {
    expect(percentDecline(150, 100)).toBe(0);
    expect(percentDecline(100, 100)).toBe(0);
  });

  it("computes a correct, rounded decline percentage for an actual decrease", () => {
    expect(percentDecline(40, 100)).toBe(60);
    expect(percentDecline(50, 100)).toBe(50);
  });

  it("clamps to [0, 100] in practice -- a decrease toward zero approaches but never exceeds 100%", () => {
    const decline = percentDecline(0.01, 100);
    expect(decline).toBeLessThanOrEqual(100);
    expect(decline).toBeGreaterThan(99);
  });
});

describe("sortCandidatesByPriority", () => {
  function makeCandidate(priority: DecisionPriority, dedupeKey: string): RecommendationCandidate {
    return {
      dedupeKey,
      ruleId: "TEST_RULE",
      ruleVersion: 1,
      decisionCategory: "OPERATIONAL",
      priority,
      confidence: "HIGH",
      title: "t",
      explanation: "e",
      evidence: { metrics: {}, sourceRecords: [], confidenceBasis: "b" },
      recommendedNextAction: "n",
      reportingPeriodFrom: "2026-01-01",
      reportingPeriodTo: "2026-01-31",
    };
  }

  it("sorts a full candidate list priority-first", () => {
    const candidates = [makeCandidate("LOW", "k1"), makeCandidate("CRITICAL", "k2"), makeCandidate("MEDIUM", "k3")];
    const sorted = sortCandidatesByPriority(candidates);
    expect(sorted.map((c) => c.priority)).toEqual(["CRITICAL", "MEDIUM", "LOW"]);
  });

  it("does not mutate the input array", () => {
    const candidates = [makeCandidate("LOW", "k1"), makeCandidate("CRITICAL", "k2")];
    const original = [...candidates];
    sortCandidatesByPriority(candidates);
    expect(candidates).toEqual(original);
  });
});
