import { describe, it, expect } from "vitest";
import { formatScaledDecimal, multiplyDecimalStrings } from "@/lib/lost-sales/validation";
import { resolveOriginalDemandFields } from "@/lib/lost-sales/resolve-fields";

/**
 * Milestone 4 (Lost-Sales Management). Pure, unconditional unit tests --
 * no @prisma/client import anywhere in lib/lost-sales/validation.ts or
 * lib/lost-sales/resolve-fields.ts, so these run in every environment,
 * exactly like tests/picking-validation.test.ts.
 *
 * Real Business Data Onboarding round (spec PART A): this file used to
 * also cover computeUndecidedQuantity, deriveUnfulfilledDemandStatus,
 * decisionTypeToBucket, validateDecisionQuantity,
 * computeLostSaleConsumption, validateLostSaleReason, and
 * resolveSubstituteFields -- every one of those spec-section-10 test
 * scenarios (4, 5, 6, 7, 8, 9, 11, 12, 13, 14) exercised decision-bucket
 * arithmetic that no longer exists now that a shortage is automatically
 * and fully cancelled/confirmed-lost in one step, with no decision step
 * to bucket a quantity into. Those functions and this file's tests for
 * them were removed outright, not left testing dead code -- see
 * lib/lost-sales/validation.ts's own module comment for the full list
 * and rationale. tests/lost-sales-db.integration.test.ts covers the
 * DB-backed automatic-creation scenarios (1, 2, 3, 15, 16, 17, 18, 20)
 * directly against the new behaviour.
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

describe("resolveOriginalDemandFields (mirrors resolve-line.ts's three-way fallback)", () => {
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
});
