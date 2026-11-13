import { describe, it, expect } from "vitest";
import {
  DECISION_CATEGORIES,
  DECISION_PRIORITIES,
  DECISION_CONFIDENCES,
  DECISION_RECOMMENDATION_STATUSES,
  DECISION_RECOMMENDATION_STATUS_TRANSITIONS,
  isValidDecisionStatusTransition,
  type DecisionRecommendationStatus,
} from "@/lib/reporting/decision-types";

/**
 * Milestone 15 (Decision Intelligence). Unconditional unit tests for the
 * lifecycle transition rules in lib/reporting/decision-types.ts (spec
 * section 5). Pure, no database required -- this file exercises the
 * EXACT function (isValidDecisionStatusTransition) that
 * lib/reporting/decision-intelligence-queries.ts's
 * updateDecisionRecommendationStatus calls server-side before any
 * mutation is persisted.
 */

describe("the four fixed enums", () => {
  it("each has the exact literal values the Prisma schema's enums mirror", () => {
    expect(DECISION_CATEGORIES).toEqual(["SALES", "CUSTOMER", "PRODUCT", "COMMERCIAL_EXPOSURE", "OPERATIONAL"]);
    expect(DECISION_PRIORITIES).toEqual(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"]);
    expect(DECISION_CONFIDENCES).toEqual(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA"]);
    expect(DECISION_RECOMMENDATION_STATUSES).toEqual(["OPEN", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DISMISSED"]);
  });
});

describe("isValidDecisionStatusTransition", () => {
  it("rejects a self-transition from every status (never a no-op transition)", () => {
    for (const status of DECISION_RECOMMENDATION_STATUSES) {
      expect(isValidDecisionStatusTransition(status, status)).toBe(false);
    }
  });

  it("allows OPEN to move to any of ACKNOWLEDGED, IN_PROGRESS, RESOLVED, DISMISSED", () => {
    for (const to of ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "DISMISSED"] as DecisionRecommendationStatus[]) {
      expect(isValidDecisionStatusTransition("OPEN", to)).toBe(true);
    }
  });

  it("allows RESOLVED and DISMISSED to be reopened (back to OPEN) -- terminal states are not dead ends", () => {
    expect(isValidDecisionStatusTransition("RESOLVED", "OPEN")).toBe(true);
    expect(isValidDecisionStatusTransition("DISMISSED", "OPEN")).toBe(true);
  });

  it("rejects RESOLVED or DISMISSED moving directly to any status other than OPEN", () => {
    for (const to of ["ACKNOWLEDGED", "IN_PROGRESS", "DISMISSED"] as DecisionRecommendationStatus[]) {
      expect(isValidDecisionStatusTransition("RESOLVED", to)).toBe(false);
    }
    for (const to of ["ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"] as DecisionRecommendationStatus[]) {
      expect(isValidDecisionStatusTransition("DISMISSED", to)).toBe(false);
    }
  });

  it("allows ACKNOWLEDGED and IN_PROGRESS to reach RESOLVED or DISMISSED", () => {
    expect(isValidDecisionStatusTransition("ACKNOWLEDGED", "RESOLVED")).toBe(true);
    expect(isValidDecisionStatusTransition("ACKNOWLEDGED", "DISMISSED")).toBe(true);
    expect(isValidDecisionStatusTransition("IN_PROGRESS", "RESOLVED")).toBe(true);
    expect(isValidDecisionStatusTransition("IN_PROGRESS", "DISMISSED")).toBe(true);
  });

  it("every status has at least one legal outbound transition (no orphaned terminal state with zero exits)", () => {
    for (const status of DECISION_RECOMMENDATION_STATUSES) {
      expect(DECISION_RECOMMENDATION_STATUS_TRANSITIONS[status].length).toBeGreaterThan(0);
    }
  });

  it("every transition map entry only ever lists OTHER statuses, never itself", () => {
    for (const status of DECISION_RECOMMENDATION_STATUSES) {
      expect(DECISION_RECOMMENDATION_STATUS_TRANSITIONS[status]).not.toContain(status);
    }
  });
});
