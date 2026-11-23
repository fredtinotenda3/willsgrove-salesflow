import { describe, expect, it } from "vitest";
import { computeOrderPricing, describePricingGaps, resolveVatRatePercent } from "@/lib/order-pricing";

describe("computeOrderPricing", () => {
  it("computes line totals, subtotal, configured tax and total", () => {
    const pricing = computeOrderPricing([
      { quantity: "10", unitPrice: "2.50", vatRatePercent: "15" },
      { quantity: "4", unitPrice: "1.25", vatRatePercent: "0" },
    ]);
    expect(pricing.lines[0]).toMatchObject({ subtotal: "25.0000", tax: "3.7500", total: "28.7500", priced: true, taxConfigured: true });
    expect(pricing.lines[1]).toMatchObject({ subtotal: "5.0000", tax: "0.0000", total: "5.0000", taxConfigured: true });
    expect(pricing.subtotal).toBe("30.0000");
    expect(pricing.taxTotal).toBe("3.7500");
    expect(pricing.total).toBe("33.7500");
    expect(pricing.isComplete).toBe(true);
    expect(describePricingGaps(pricing)).toBeNull();
  });

  it("never treats an unpriced line as zero", () => {
    const pricing = computeOrderPricing([
      { quantity: "3", unitPrice: "2", vatRatePercent: "10" },
      { quantity: "5", unitPrice: null, vatRatePercent: "10" },
    ]);
    expect(pricing.lines[1]).toMatchObject({ subtotal: null, tax: null, total: null, priced: false });
    expect(pricing.unpricedLineCount).toBe(1);
    expect(pricing.total).toBe("6.6000");
    expect(pricing.isComplete).toBe(false);
    expect(describePricingGaps(pricing)).toMatch(/no price yet/i);
  });

  it("returns null totals (not zero) when nothing is priced", () => {
    const pricing = computeOrderPricing([{ quantity: "2", unitPrice: null, vatRatePercent: null }]);
    expect(pricing.subtotal).toBeNull();
    expect(pricing.taxTotal).toBeNull();
    expect(pricing.total).toBeNull();
  });

  it("adds no tax where no rate is configured, and says so", () => {
    const pricing = computeOrderPricing([{ quantity: "2", unitPrice: "5", vatRatePercent: null }]);
    expect(pricing.lines[0]).toMatchObject({ subtotal: "10.0000", tax: null, total: "10.0000", taxConfigured: false });
    expect(pricing.taxUnconfiguredLineCount).toBe(1);
    expect(pricing.total).toBe("10.0000");
    expect(describePricingGaps(pricing)).toMatch(/no tax rate/i);
  });

  it("rounds each line half-up at 4dp and sums the rounded lines", () => {
    const pricing = computeOrderPricing([
      { quantity: "1", unitPrice: "0.33333", vatRatePercent: "15" },
      { quantity: "1", unitPrice: "0.33333", vatRatePercent: "15" },
    ]);
    const perLineTotal = pricing.lines[0].total;
    expect(pricing.lines[1].total).toBe(perLineTotal);
    expect(Number(pricing.total)).toBeCloseTo(Number(perLineTotal) * 2, 4);
  });
});

describe("resolveVatRatePercent", () => {
  const rates = new Map([["S15", "15"], ["Z0", "0"]]);
  it("returns the configured rate, including a valid 0", () => {
    expect(resolveVatRatePercent("S15", rates)).toBe("15");
    expect(resolveVatRatePercent("Z0", rates)).toBe("0");
  });
  it("returns null, never a default, for a missing or unknown code", () => {
    expect(resolveVatRatePercent(null, rates)).toBeNull();
    expect(resolveVatRatePercent("NOPE", rates)).toBeNull();
  });
});
