import { describe, it, expect } from "vitest";
import {
  decimalStringSchema,
  recordPickedLineSchema,
  parseScaledDecimal,
  exceedsRequested,
  fullyAccountsFor,
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
