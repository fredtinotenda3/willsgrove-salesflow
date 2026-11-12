import { describe, it, expect } from "vitest";
import { sumDecimalStrings, formatScaledDecimal, clampedDifference } from "@/lib/fulfilment/decimal";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Unit tests for
 * lib/fulfilment/decimal.ts's pure bigint-scaled decimal arithmetic --
 * unconditional (no @prisma/client dependency anywhere in this file's or
 * decimal.ts's import graph), same convention as
 * tests/picking-validation.test.ts.
 */

describe("sumDecimalStrings", () => {
  it("sums exactly, with no floating-point drift", () => {
    expect(sumDecimalStrings(["0.1", "0.2"])).toBe(BigInt(3_000)); // 0.3 scaled
    expect(sumDecimalStrings(["10", "20.5", "0.0001"])).toBe(BigInt(305_001));
  });

  it("returns zero for an empty list", () => {
    expect(sumDecimalStrings([])).toBe(BigInt(0));
  });

  it("handles a single value", () => {
    expect(sumDecimalStrings(["7.5"])).toBe(BigInt(75_000));
  });

  it("throws on a malformed value -- a should-never-happen guard, not a validation path", () => {
    expect(() => sumDecimalStrings(["10", "not-a-number"])).toThrow();
    expect(() => sumDecimalStrings(["-1"])).toThrow();
  });
});

describe("formatScaledDecimal", () => {
  it("round-trips whole numbers with no trailing decimal point", () => {
    expect(formatScaledDecimal(BigInt(200_000))).toBe("20");
    expect(formatScaledDecimal(BigInt(0))).toBe("0");
  });

  it("trims trailing zero fractional digits", () => {
    expect(formatScaledDecimal(BigInt(123_450))).toBe("12.345");
    expect(formatScaledDecimal(BigInt(100_000))).toBe("10");
  });

  it("preserves full 4-decimal-place precision when non-zero", () => {
    expect(formatScaledDecimal(BigInt(1))).toBe("0.0001");
    expect(formatScaledDecimal(BigInt(123_456_789))).toBe("12345.6789");
  });

  it("renders a negative scaled value with a leading minus sign", () => {
    expect(formatScaledDecimal(BigInt(-50_000))).toBe("-5");
    expect(formatScaledDecimal(BigInt(-1))).toBe("-0.0001");
  });

  it("round-trips sumDecimalStrings' own output back to the original decimal text", () => {
    expect(formatScaledDecimal(sumDecimalStrings(["0.1", "0.2"]))).toBe("0.3");
  });
});

describe("clampedDifference", () => {
  it("returns the plain difference when available exceeds used", () => {
    expect(clampedDifference(BigInt(100_000), BigInt(30_000))).toBe(BigInt(70_000));
  });

  it("clamps at zero rather than going negative when used exceeds available", () => {
    expect(clampedDifference(BigInt(30_000), BigInt(100_000))).toBe(BigInt(0));
  });

  it("is zero when available equals used exactly", () => {
    expect(clampedDifference(BigInt(50_000), BigInt(50_000))).toBe(BigInt(0));
  });

  it("handles zero on both sides", () => {
    expect(clampedDifference(BigInt(0), BigInt(0))).toBe(BigInt(0));
  });
});
