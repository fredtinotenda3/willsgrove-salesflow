import { describe, expect, it } from "vitest";
import { currencyPrefix, formatCompactMoney, formatCount, formatMoney, formatPercent, formatQuantity, percentChange } from "@/lib/format/analytics";

describe("formatMoney", () => {
  it("prefixes USD with a dollar sign and always shows two decimals", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney("0")).toBe("$0.00");
    expect(formatMoney("1234567.891")).toBe("$1,234,567.89");
  });
  it("puts the sign before the symbol", () => {
    expect(formatMoney(-12)).toBe("-$12.00");
  });
  it("uses the ISO code for non-USD currencies instead of guessing a symbol", () => {
    expect(formatMoney(10, "ZWG")).toBe("ZWG 10.00");
    expect(formatMoney(10, "zwg")).toBe("ZWG 10.00");
    expect(currencyPrefix(null)).toBe("$");
  });
  it("returns an em dash for missing or non-numeric values rather than 0", () => {
    expect(formatMoney(null)).toBe("—");
    expect(formatMoney(undefined)).toBe("—");
    expect(formatMoney("abc")).toBe("—");
    expect(formatMoney("")).toBe("—");
  });
});

describe("formatCompactMoney", () => {
  it("abbreviates thousands and millions for axis ticks", () => {
    expect(formatCompactMoney(850)).toBe("$850");
    expect(formatCompactMoney(1200)).toBe("$1.2K");
    expect(formatCompactMoney(3_400_000)).toBe("$3.4M");
    expect(formatCompactMoney(-2500)).toBe("-$2.5K");
  });
});

describe("formatQuantity / formatPercent / formatCount", () => {
  it("keeps the unit with the quantity", () => {
    expect(formatQuantity("1234.5", "KG")).toBe("1,234.5 KG");
    expect(formatQuantity(3)).toBe("3");
    expect(formatQuantity(null, "KG")).toBe("—");
  });
  it("formats percentages and handles null", () => {
    expect(formatPercent(12.345)).toBe("12.3%");
    expect(formatPercent(null)).toBe("—");
  });
  it("formats counts", () => {
    expect(formatCount(12345)).toBe("12,345");
    expect(formatCount(null)).toBe("—");
  });
});

describe("percentChange", () => {
  it("computes the change against the previous period", () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(50, 100)).toBe(-50);
  });
  it("is null when there is no reliable baseline", () => {
    expect(percentChange(10, 0)).toBeNull();
    expect(percentChange(10, null)).toBeNull();
    expect(percentChange(null, 10)).toBeNull();
    expect(percentChange(Number.NaN, 10)).toBeNull();
  });
});
