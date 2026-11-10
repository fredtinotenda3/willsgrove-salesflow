import { describe, it, expect } from "vitest";
import {
  decimalStringSchema,
  recordPickedLineSchema,
  parseScaledDecimal,
  exceedsRequested,
  fullyAccountsFor,
  classifyAvailability,
} from "@/lib/picking/validation";

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 * Unit tests for lib/picking/validation.ts's pure decimal arithmetic and
 * zod schemas -- unconditional (no @prisma/client dependency anywhere in
 * this file's or validation.ts's import graph), same convention as
 * tests/handover-format-rows.test.ts.
 */

describe("decimalStringSchema", () => {
  it("accepts whole numbers, decimals up to 4 places, and zero", () => {
    for (const value of ["0", "10", "10.0000", "0.1", "0.0001", "123456.7890"]) {
      expect(decimalStringSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects negatives, more than 4 decimal places, and non-numeric text", () => {
    for (const value of ["-1", "-0.5", "1.23456", "abc", "", "1,000", "1e5"]) {
      expect(decimalStringSchema.safeParse(value).success).toBe(false);
    }
  });
});

describe("recordPickedLineSchema", () => {
  it("accepts a valid body with optional notes omitted", () => {
    const parsed = recordPickedLineSchema.safeParse({ foundQuantity: "10.0000", unavailableQuantity: "5.0000" });
    expect(parsed.success).toBe(true);
  });

  it("accepts notes when provided and rejects an overly long one", () => {
    expect(
      recordPickedLineSchema.safeParse({ foundQuantity: "1", unavailableQuantity: "0", notes: "short note" }).success
    ).toBe(true);
    expect(
      recordPickedLineSchema.safeParse({ foundQuantity: "1", unavailableQuantity: "0", notes: "x".repeat(2001) })
        .success
    ).toBe(false);
  });

  it("rejects a missing or invalid quantity", () => {
    expect(recordPickedLineSchema.safeParse({ unavailableQuantity: "0" }).success).toBe(false);
    expect(recordPickedLineSchema.safeParse({ foundQuantity: "-1", unavailableQuantity: "0" }).success).toBe(false);
  });
});

describe("parseScaledDecimal", () => {
  it("scales by 10,000 exactly, with no floating-point drift", () => {
    expect(parseScaledDecimal("10")).toBe(BigInt(100_000));
    expect(parseScaledDecimal("10.0000")).toBe(BigInt(100_000));
    expect(parseScaledDecimal("0.1")).toBe(BigInt(1_000));
    expect(parseScaledDecimal("0.0001")).toBe(BigInt(1));
    expect(parseScaledDecimal("0")).toBe(BigInt(0));
  });

  it("returns null for anything that doesn't match the pattern", () => {
    expect(parseScaledDecimal("-1")).toBeNull();
    expect(parseScaledDecimal("1.23456")).toBeNull();
    expect(parseScaledDecimal("abc")).toBeNull();
  });
});

describe("exceedsRequested", () => {
  it("is false when found + unavailable is less than or equal to requested", () => {
    expect(exceedsRequested("10", "5", "15")).toBe(false); // exact match
    expect(exceedsRequested("10", "0", "15")).toBe(false); // partial, still room
  });

  it("is true the moment found + unavailable exceeds requested, by any amount", () => {
    expect(exceedsRequested("10", "5.0001", "15")).toBe(true);
    expect(exceedsRequested("20", "0", "15")).toBe(true);
  });

  it("returns false (never throws) for malformed input -- shape validation is a separate concern", () => {
    expect(exceedsRequested("not-a-number", "0", "15")).toBe(false);
  });
});

describe("fullyAccountsFor", () => {
  it("matches the spec's worked example exactly: 20/20/0, 15/10/5, 30/25/5", () => {
    expect(fullyAccountsFor("20", "0", "20")).toBe(true);
    expect(fullyAccountsFor("10", "5", "15")).toBe(true);
    expect(fullyAccountsFor("25", "5", "30")).toBe(true);
  });

  it("is false for a partial accounting (not yet fully entered)", () => {
    expect(fullyAccountsFor("10", "0", "15")).toBe(false);
  });

  it("is false for overcounting", () => {
    expect(fullyAccountsFor("10", "10", "15")).toBe(false);
  });

  it("holds exactly at sub-unit precision with no rounding error", () => {
    expect(fullyAccountsFor("0.1", "0.2", "0.3")).toBe(true);
    expect(fullyAccountsFor("0.1", "0.2", "0.3001")).toBe(false);
  });
});

/**
 * Milestone 3 completion (Warehouse Assembly Form & Partial Availability).
 * Exercises the spec's three outcomes with its own worked examples
 * (section 3, Examples A/B/C) plus the fourth, explicit "not recorded
 * yet" case this codebase's PickingLine.foundQuantity/unavailableQuantity
 * nullability requires.
 */
describe("classifyAvailability", () => {
  it("Example A -- fully available: requested 20, found 20, unavailable 0", () => {
    expect(classifyAvailability("20", "0", "20")).toBe("FULLY_AVAILABLE");
  });

  it("Example B -- partially available: requested 20, found 12, unavailable 8", () => {
    expect(classifyAvailability("12", "8", "20")).toBe("PARTIALLY_AVAILABLE");
  });

  it("Example C -- completely unavailable: requested 20, found 0, unavailable 20", () => {
    expect(classifyAvailability("0", "20", "20")).toBe("COMPLETELY_UNAVAILABLE");
  });

  it("is PENDING when either quantity hasn't been recorded yet", () => {
    expect(classifyAvailability(null, null, "20")).toBe("PENDING");
    expect(classifyAvailability("5", null, "20")).toBe("PENDING");
    expect(classifyAvailability(null, "5", "20")).toBe("PENDING");
  });

  it("holds at sub-unit decimal precision, matching fullyAccountsFor's own precision guarantee", () => {
    expect(classifyAvailability("0.3", "0", "0.3")).toBe("FULLY_AVAILABLE");
    expect(classifyAvailability("0.1", "0.2", "0.3")).toBe("PARTIALLY_AVAILABLE");
    expect(classifyAvailability("0", "0.3", "0.3")).toBe("COMPLETELY_UNAVAILABLE");
  });

  it("is PENDING (never a false classification) for malformed input", () => {
    expect(classifyAvailability("not-a-number", "0", "20")).toBe("PENDING");
  });
});
