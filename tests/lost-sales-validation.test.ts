import { describe, it, expect } from "vitest";
import {
  computeLostSaleConsumption,
  computeUndecidedQuantity,
  decisionTypeToBucket,
  deriveUnfulfilledDemandStatus,
  formatScaledDecimal,
  multiplyDecimalStrings,
  validateDecisionQuantity,
  validateLostSaleReason,
  customerDecisionTypeValues,
  WHOLE_REMAINDER_DECISION_TYPES,
} from "@/lib/lost-sales/validation";
import { resolveOriginalDemandFields, resolveSubstituteFields } from "@/lib/lost-sales/resolve-fields";

/**
 * Milestone 4 (Lost-Sales Management). Pure, unconditional unit tests --
 * no @prisma/client import anywhere in lib/lost-sales/validation.ts or
 * lib/lost-sales/resolve-fields.ts, so these run in every environment,
 * exactly like tests/picking-validation.test.ts.
 *
 * Covers spec section 10 test scenarios 4, 5, 6, 7, 8, 9, 11, 12, 13, 14,
 * 19 at the pure-logic level; tests/lost-sales-db.integration.test.ts
 * covers the DB-backed scenarios (1, 2, 3, 10, 15, 16, 17, 18, 20).
 */

describe("formatScaledDecimal / multiplyDecimalStrings", () => {
  it("round-trips an integer and a fractional scaled value", () => {
    expect(formatScaledDecimal(BigInt(0))).toBe("0.0000");
    expect(formatScaledDecimal(BigInt(120000))).toBe("12.0000");
    expect(formatScaledDecimal(BigInt(10001))).toBe("1.0001");
  });

  it("refuses to format a negative scaled quantity", () => {
    expect(() => formatScaledDecimal(BigInt(-1))).toThrow();
  });

  it("multiplies two decimal strings exactly (scenario 19: decimal precision)", () => {
    expect(multiplyDecimalStrings("2.5000", "3")).toBe("7.5000");
    expect(multiplyDecimalStrings("0.1000", "0.2000")).toBe("0.0200");
  });

  it("truncates (never rounds up) past 4 fractional digits -- documented, acceptable for an ESTIMATE only", () => {
    // 1.0001 * 1.0001 = 1.00020001 exactly -> truncated to 4 places = 1.0002
    expect(multiplyDecimalStrings("1.0001", "1.0001")).toBe("1.0002");
  });

  it("returns null for malformed input", () => {
    expect(multiplyDecimalStrings("abc", "1")).toBeNull();
  });
});

describe("computeUndecidedQuantity", () => {
  it("subtracts every decided bucket from the unavailable total", () => {
    expect(computeUndecidedQuantity("8.0000", "0.0000", "0.0000", "0.0000")).toBe("8.0000");
    expect(computeUndecidedQuantity("8.0000", "3.0000", "2.0000", "1.0000")).toBe("2.0000");
    expect(computeUndecidedQuantity("8.0000", "0.0000", "8.0000", "0.0000")).toBe("0.0000");
  });

  it("returns null rather than a negative number if the buckets somehow over-account", () => {
    expect(computeUndecidedQuantity("8.0000", "5.0000", "5.0000", "0.0000")).toBeNull();
  });

  it("returns null for malformed input", () => {
    expect(computeUndecidedQuantity("x", "0", "0", "0")).toBeNull();
  });
});

describe("deriveUnfulfilledDemandStatus (spec section 6's six states, zero overlap)", () => {
  const base = {
    unavailableQuantity: "8.0000",
    outstandingQuantity: "0.0000",
    cancelledQuantity: "0.0000",
    substitutedQuantity: "0.0000",
    confirmedLostQuantity: "0.0000",
  };

  it("RESOLVED when there was never anything unavailable", () => {
    expect(deriveUnfulfilledDemandStatus({ ...base, unavailableQuantity: "0.0000" })).toBe("RESOLVED");
  });

  it("PENDING_DECISION whenever any remainder is still undecided (scenario 4: never auto-classified as lost)", () => {
    expect(deriveUnfulfilledDemandStatus(base)).toBe("PENDING_DECISION");
    expect(deriveUnfulfilledDemandStatus({ ...base, cancelledQuantity: "3.0000" })).toBe("PENDING_DECISION");
  });

  it("AWAITING_SUPPLY once fully decided with outstanding > 0 (scenario 6)", () => {
    expect(deriveUnfulfilledDemandStatus({ ...base, outstandingQuantity: "8.0000" })).toBe("AWAITING_SUPPLY");
  });

  it("AWAITING_SUPPLY takes priority even if part of the cancelled bucket is already confirmed lost", () => {
    expect(
      deriveUnfulfilledDemandStatus({
        ...base,
        outstandingQuantity: "3.0000",
        cancelledQuantity: "5.0000",
        confirmedLostQuantity: "5.0000",
      })
    ).toBe("AWAITING_SUPPLY");
  });

  it("PARTIALLY_CANCELLED when 0 < cancelled < unavailable and nothing outstanding (mixed cancel/substitute)", () => {
    expect(deriveUnfulfilledDemandStatus({ ...base, cancelledQuantity: "3.0000", substitutedQuantity: "5.0000" })).toBe(
      "PARTIALLY_CANCELLED"
    );
  });

  it("FULLY_CANCELLED when cancelled == unavailable but not yet all confirmed lost (scenario 5/7/8's un-confirmed state)", () => {
    expect(deriveUnfulfilledDemandStatus({ ...base, cancelledQuantity: "8.0000" })).toBe("FULLY_CANCELLED");
    expect(deriveUnfulfilledDemandStatus({ ...base, cancelledQuantity: "8.0000", confirmedLostQuantity: "3.0000" })).toBe(
      "FULLY_CANCELLED"
    );
  });

  it("CONFIRMED_LOST only once confirmedLost == cancelled == unavailable", () => {
    expect(
      deriveUnfulfilledDemandStatus({ ...base, cancelledQuantity: "8.0000", confirmedLostQuantity: "8.0000" })
    ).toBe("CONFIRMED_LOST");
  });

  it("RESOLVED when fully decided via substitution only (scenario 10)", () => {
    expect(deriveUnfulfilledDemandStatus({ ...base, substitutedQuantity: "8.0000" })).toBe("RESOLVED");
  });
});

describe("validateDecisionQuantity (scenario 13: duplicate classification / scenario 14: exceeding the original quantity)", () => {
  it("rejects zero or negative quantities", () => {
    expect(validateDecisionQuantity("0.0000", "8.0000").ok).toBe(false);
    expect(validateDecisionQuantity("-1.0000", "8.0000").ok).toBe(false);
  });

  it("rejects a quantity exceeding what's still undecided", () => {
    const result = validateDecisionQuantity("5.0000", "3.0000");
    expect(result.ok).toBe(false);
  });

  it("rejects a SECOND decision that would re-classify quantity already assigned elsewhere", () => {
    // First decision consumes 5 of 8; undecided remainder is now 3.
    const remaining = computeUndecidedQuantity("8.0000", "5.0000", "0.0000", "0.0000");
    expect(remaining).toBe("3.0000");
    // Attempting to record another 5 against the same record must fail --
    // those 5 units were already assigned (to "outstanding") and cannot
    // simultaneously become part of a second bucket.
    expect(validateDecisionQuantity("5.0000", remaining!).ok).toBe(false);
  });

  it("accepts a quantity within the undecided remainder, exactly at the boundary", () => {
    expect(validateDecisionQuantity("3.0000", "3.0000").ok).toBe(true);
  });
});

describe("computeLostSaleConsumption (scenario 12: outstanding -> confirmed lost conversion)", () => {
  it("draws entirely from cancelled-but-not-yet-confirmed quantity when enough is available", () => {
    const result = computeLostSaleConsumption("8.0000", "8.0000", "0.0000", "0.0000");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newCancelledQuantity).toBe("8.0000");
      expect(result.newConfirmedLostQuantity).toBe("8.0000");
      expect(result.newOutstandingQuantity).toBe("0.0000");
    }
  });

  it("converts a shortfall out of outstanding quantity into cancelled, preserving confirmedLost <= cancelled", () => {
    // 3 already cancelled (none yet confirmed lost), 5 still outstanding.
    // Confirming 6 as lost: 3 from cancelled, 3 more drawn from outstanding.
    const result = computeLostSaleConsumption("6.0000", "3.0000", "0.0000", "5.0000");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newCancelledQuantity).toBe("6.0000");
      expect(result.newConfirmedLostQuantity).toBe("6.0000");
      expect(result.newOutstandingQuantity).toBe("2.0000");
    }
  });

  it("refuses when the requested quantity exceeds both sources combined", () => {
    const result = computeLostSaleConsumption("10.0000", "3.0000", "0.0000", "5.0000");
    expect(result.ok).toBe(false);
  });

  it("refuses a zero or negative quantity", () => {
    expect(computeLostSaleConsumption("0.0000", "8.0000", "0.0000", "0.0000").ok).toBe(false);
  });

  it("handles decimal precision exactly (scenario 19)", () => {
    const result = computeLostSaleConsumption("0.0003", "0.0005", "0.0002", "0.0000");
    expect(result.ok).toBe(true);
    if (result.ok) {
      // available-from-cancelled = 0.0005 - 0.0002 = 0.0003, exactly enough.
      expect(result.newCancelledQuantity).toBe("0.0005");
      expect(result.newConfirmedLostQuantity).toBe("0.0005");
      expect(result.newOutstandingQuantity).toBe("0.0000");
    }
  });
});

describe("decisionTypeToBucket (every decision type maps to exactly one bucket)", () => {
  it("covers all 7 recordable decision types with no gaps", () => {
    for (const value of customerDecisionTypeValues) {
      expect(["outstanding", "cancelled", "substituted"]).toContain(decisionTypeToBucket(value));
    }
  });

  it("ACCEPT_PARTIAL_CANCEL_REMAINDER, ENTIRE_LINE_CANCELLED, ENTIRE_ORDER_CANCELLED all consume the whole remainder into 'cancelled'", () => {
    expect(decisionTypeToBucket("ACCEPT_PARTIAL_CANCEL_REMAINDER")).toBe("cancelled");
    expect(decisionTypeToBucket("ENTIRE_LINE_CANCELLED")).toBe("cancelled");
    expect(decisionTypeToBucket("ENTIRE_ORDER_CANCELLED")).toBe("cancelled");
    for (const value of ["ACCEPT_PARTIAL_CANCEL_REMAINDER", "ENTIRE_LINE_CANCELLED", "ENTIRE_ORDER_CANCELLED"] as const) {
      expect(WHOLE_REMAINDER_DECISION_TYPES.has(value)).toBe(true);
    }
  });

  it("AWAIT_REMAINING_QUANTITY and SCHEDULE_LATER_SUPPLY both map to 'outstanding' (scenario 6/11)", () => {
    expect(decisionTypeToBucket("AWAIT_REMAINING_QUANTITY")).toBe("outstanding");
    expect(decisionTypeToBucket("SCHEDULE_LATER_SUPPLY")).toBe("outstanding");
  });

  it("SUBSTITUTE_ACCEPTED maps to 'substituted'", () => {
    expect(decisionTypeToBucket("SUBSTITUTE_ACCEPTED")).toBe("substituted");
  });

  it("PARTIAL_CANCELLATION maps to 'cancelled' and is NOT a whole-remainder type", () => {
    expect(decisionTypeToBucket("PARTIAL_CANCELLATION")).toBe("cancelled");
    expect(WHOLE_REMAINDER_DECISION_TYPES.has("PARTIAL_CANCELLATION")).toBe(false);
  });
});

describe("validateLostSaleReason", () => {
  it("requires a detail when the reason is OTHER", () => {
    expect(validateLostSaleReason("OTHER", undefined).ok).toBe(false);
    expect(validateLostSaleReason("OTHER", "   ").ok).toBe(false);
    expect(validateLostSaleReason("OTHER", "Customer found a cheaper local supplier.").ok).toBe(true);
  });

  it("never requires a detail for any other reason", () => {
    expect(validateLostSaleReason("PRODUCT_UNAVAILABLE", undefined).ok).toBe(true);
  });
});

describe("resolveOriginalDemandFields / resolveSubstituteFields (mirrors resolve-line.ts's three-way fallback)", () => {
  it("prefers the live product match over every snapshot", () => {
    const result = resolveOriginalDemandFields({
      originalProductDescription: "Customer's own wording",
      sapItemCodeSnapshot: "OLD-CODE",
      productSapItemCode: "LIVE-CODE",
      officialProductDescription: "Live Official Name",
    });
    expect(result).toEqual({ sapItemCodeSnapshot: "LIVE-CODE", productDescriptionSnapshot: "Live Official Name" });
  });

  it("falls back to the order-time snapshot when there is no live product", () => {
    const result = resolveOriginalDemandFields({
      originalProductDescription: "Customer's own wording",
      sapItemCodeSnapshot: "OLD-CODE",
      productSapItemCode: null,
      officialProductDescription: null,
    });
    expect(result).toEqual({ sapItemCodeSnapshot: "OLD-CODE", productDescriptionSnapshot: "Customer's own wording" });
  });

  it("falls back to the customer's own wording when nothing resolved at all", () => {
    const result = resolveOriginalDemandFields({
      originalProductDescription: "Customer's own wording",
      sapItemCodeSnapshot: null,
      productSapItemCode: null,
      officialProductDescription: null,
    });
    expect(result).toEqual({ sapItemCodeSnapshot: null, productDescriptionSnapshot: "Customer's own wording" });
  });

  it("resolves a substitute's fields directly from the live product (no customer-wording fallback)", () => {
    const result = resolveSubstituteFields({ substituteSapItemCode: "SUB-1", substituteItemName: "Substitute Product" });
    expect(result).toEqual({ substituteSapItemCodeSnapshot: "SUB-1", substituteProductDescriptionSnapshot: "Substitute Product" });
  });
});
