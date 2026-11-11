import { describe, it, expect } from "vitest";
import {
  validateClaimStatusTransition,
  isApprovalWeightStatus,
  isConcludedStatus,
  resolutionDecisionToClaimStatus,
  resolutionDecisionRequiresDetail,
  claimCategoryRequiresDetail,
  validateClaimLineQuantities,
  validateDisputedAmount,
  CLAIM_STATUSES,
  RESOLUTION_DECISIONS,
} from "@/lib/invoice-claims/validation";

/**
 * Milestone 6A (Invoice Claims Management). Pure, unconditional tests for
 * lib/invoice-claims/validation.ts -- no @prisma/client import anywhere in
 * that module, so these run in every environment, same as
 * tests/invoice-reconciliation.test.ts and tests/picking-validation.test.ts.
 */

describe("Milestone 6A: claim status transition graph", () => {
  it("allows the plain investigation-workflow moves without requiring approval", () => {
    expect(validateClaimStatusTransition("OPEN", "UNDER_INVESTIGATION")).toEqual({ ok: true, requiresApproval: false });
    expect(validateClaimStatusTransition("OPEN", "AWAITING_CUSTOMER")).toEqual({ ok: true, requiresApproval: false });
    expect(validateClaimStatusTransition("UNDER_INVESTIGATION", "AWAITING_INTERNAL_ACTION")).toEqual({ ok: true, requiresApproval: false });
    expect(validateClaimStatusTransition("AWAITING_CUSTOMER", "UNDER_INVESTIGATION")).toEqual({ ok: true, requiresApproval: false });
  });

  it("flags every approval-weight transition as requiring approval", () => {
    const result = validateClaimStatusTransition("AWAITING_INTERNAL_ACTION", "APPROVED");
    expect(result).toEqual({ ok: true, requiresApproval: true });
    for (const target of ["APPROVED", "PARTIALLY_RESOLVED", "RESOLVED", "REJECTED", "CLOSED"] as const) {
      expect(isApprovalWeightStatus(target)).toBe(true);
    }
    for (const target of ["OPEN", "UNDER_INVESTIGATION", "AWAITING_CUSTOMER", "AWAITING_INTERNAL_ACTION"] as const) {
      expect(isApprovalWeightStatus(target)).toBe(false);
    }
  });

  it("rejects a transition not on the graph (cannot skip investigation/approval steps)", () => {
    const result = validateClaimStatusTransition("OPEN", "RESOLVED");
    expect(result.ok).toBe(false);
  });

  it("rejects a no-op transition (same status to itself)", () => {
    const result = validateClaimStatusTransition("OPEN", "OPEN");
    expect(result.ok).toBe(false);
  });

  it("treats CLOSED as terminal -- no outgoing transitions at all", () => {
    for (const target of CLAIM_STATUSES) {
      if (target === "CLOSED") continue;
      expect(validateClaimStatusTransition("CLOSED", target).ok).toBe(false);
    }
  });

  it("every status has a defined (possibly empty) set of allowed transitions", () => {
    // Exhaustiveness is enforced by the TypeScript Record<ClaimStatus, ...>
    // type at compile time; this just confirms every status is reachable
    // as a FROM state without throwing.
    for (const status of CLAIM_STATUSES) {
      expect(() => validateClaimStatusTransition(status, status)).not.toThrow();
    }
  });
});

describe("Milestone 6A: isConcludedStatus", () => {
  it("is true for every status that counts toward average-resolution-time reporting", () => {
    expect(isConcludedStatus("RESOLVED")).toBe(true);
    expect(isConcludedStatus("PARTIALLY_RESOLVED")).toBe(true);
    expect(isConcludedStatus("REJECTED")).toBe(true);
    expect(isConcludedStatus("CLOSED")).toBe(true);
  });

  it("is false for every in-progress status, including APPROVED (a recommendation approved but not yet fully resolved)", () => {
    expect(isConcludedStatus("OPEN")).toBe(false);
    expect(isConcludedStatus("UNDER_INVESTIGATION")).toBe(false);
    expect(isConcludedStatus("AWAITING_CUSTOMER")).toBe(false);
    expect(isConcludedStatus("AWAITING_INTERNAL_ACTION")).toBe(false);
    expect(isConcludedStatus("APPROVED")).toBe(false);
  });
});

describe("Milestone 6A: resolutionDecisionToClaimStatus (structural, exhaustive)", () => {
  it("maps every decision to exactly one status, and every mapping is a VALID transition from AWAITING_INTERNAL_ACTION", () => {
    for (const decision of RESOLUTION_DECISIONS) {
      const target = resolutionDecisionToClaimStatus(decision);
      expect(CLAIM_STATUSES).toContain(target);
      const transition = validateClaimStatusTransition("AWAITING_INTERNAL_ACTION", target);
      expect(transition.ok).toBe(true);
    }
  });

  it("DELIVERY_INVESTIGATION_REQUIRED sends the claim back to investigation, not forward to an approval-weight status", () => {
    expect(resolutionDecisionToClaimStatus("DELIVERY_INVESTIGATION_REQUIRED")).toBe("UNDER_INVESTIGATION");
  });

  it("CLAIM_REJECTED maps to REJECTED and NO_ACTION_REQUIRED maps to RESOLVED", () => {
    expect(resolutionDecisionToClaimStatus("CLAIM_REJECTED")).toBe("REJECTED");
    expect(resolutionDecisionToClaimStatus("NO_ACTION_REQUIRED")).toBe("RESOLVED");
  });

  it("every credit/return/pricing/replacement decision maps to APPROVED -- the claim still needs a further explicit move to RESOLVED/PARTIALLY_RESOLVED", () => {
    for (const decision of ["REPLACEMENT_APPROVED", "PHYSICAL_RETURN_REQUIRED", "PARTIAL_CREDIT_RECOMMENDED", "FULL_CREDIT_RECOMMENDED", "PRICING_CORRECTION_REQUIRED", "OTHER"] as const) {
      expect(resolutionDecisionToClaimStatus(decision)).toBe("APPROVED");
    }
  });
});

describe("Milestone 6A: 'Other requires detail'", () => {
  it("only OTHER requires a decision detail", () => {
    expect(resolutionDecisionRequiresDetail("OTHER")).toBe(true);
    expect(resolutionDecisionRequiresDetail("CLAIM_REJECTED")).toBe(false);
  });

  it("only OTHER requires a category detail", () => {
    expect(claimCategoryRequiresDetail("OTHER")).toBe(true);
    expect(claimCategoryRequiresDetail("QUALITY_ISSUE")).toBe(false);
  });
});

describe("Milestone 6A: claim-line quantity validation (spec worked example: 100 invoiced, 15 disputed -> 85 accepted / 15 rejected)", () => {
  it("accepts the worked example exactly", () => {
    const result = validateClaimLineQuantities("100.0000", "0.0000", "85.0000", "15.0000");
    expect(result.ok).toBe(true);
  });

  it("rejects accepted + rejected exceeding the invoiced quantity", () => {
    const result = validateClaimLineQuantities("100.0000", "0.0000", "90.0000", "15.0000");
    expect(result.ok).toBe(false);
  });

  it("accounts for quantity already claimed by an EARLIER claim against the same invoice line (live aggregate, not just within one claim)", () => {
    // 100 invoiced, 20 already claimed (accepted+rejected) by an earlier
    // claim -> only 80 remains. A new claim disputing 85 must fail even
    // though 85 alone would have been fine against the full 100.
    const result = validateClaimLineQuantities("100.0000", "20.0000", "0.0000", "85.0000");
    expect(result.ok).toBe(false);
  });

  it("allows a second claim that fits within what remains after an earlier claim", () => {
    const result = validateClaimLineQuantities("100.0000", "20.0000", "0.0000", "80.0000");
    expect(result.ok).toBe(true);
  });

  it("rejects a line where neither accepted nor rejected is greater than zero", () => {
    const result = validateClaimLineQuantities("100.0000", "0.0000", "0.0000", "0.0000");
    expect(result.ok).toBe(false);
  });

  it("rejects a malformed decimal string", () => {
    const result = validateClaimLineQuantities("100.0000", "0.0000", "abc", "0.0000");
    expect(result.ok).toBe(false);
  });

  it("supports full rejection (0 accepted, full quantity rejected)", () => {
    const result = validateClaimLineQuantities("50.0000", "0.0000", "0.0000", "50.0000");
    expect(result.ok).toBe(true);
  });

  it("supports partial acceptance (both accepted and rejected greater than zero, summing to exactly the invoiced quantity)", () => {
    const result = validateClaimLineQuantities("50.0000", "0.0000", "30.0000", "20.0000");
    expect(result.ok).toBe(true);
  });
});

describe("Milestone 6A: amount-only dispute validation", () => {
  it("accepts a positive disputed amount with no line total to check against (SAP export didn't provide one)", () => {
    const result = validateDisputedAmount("25.0000", null);
    expect(result.ok).toBe(true);
  });

  it("rejects a zero disputed amount", () => {
    const result = validateDisputedAmount("0.0000", "100.0000");
    expect(result.ok).toBe(false);
  });

  it("rejects a disputed amount exceeding the invoice line's own total", () => {
    const result = validateDisputedAmount("150.0000", "100.0000");
    expect(result.ok).toBe(false);
  });

  it("accepts a disputed amount within the invoice line's own total", () => {
    const result = validateDisputedAmount("99.9999", "100.0000");
    expect(result.ok).toBe(true);
  });
});
