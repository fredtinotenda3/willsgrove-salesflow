import { describe, it, expect } from "vitest";
import { generateProductInsightsForProduct, generateProductInsights, hasDeclineSimple, type ProductInsightMetrics } from "@/lib/reporting/product-insights";

/**
 * Milestone 14 (Product Intelligence), spec section 7. Unconditional unit
 * tests for lib/reporting/product-insights.ts -- pure, deterministic
 * insight generation (no @prisma/client import, no randomness, no LLM
 * call), runnable in this sandbox without RUN_DB_INTEGRATION_TESTS.
 */

const BASE_METRICS: ProductInsightMetrics = {
  sapItemCode: "ITEM-1",
  productId: "product-1",
  periodFrom: "2026-02-01",
  periodTo: "2026-02-28",
  previousPeriodFrom: "2026-01-04",
  previousPeriodTo: "2026-01-31",
  currentPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "100" }],
  previousPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "100" }],
  distinctCustomerCountCurrentPeriod: 1,
  claimCountInPeriod: 0,
  returnCountInPeriod: 0,
  creditNoteValueByCurrencyInPeriod: [],
  confirmedLostSaleCountInPeriod: 0,
  deliveryRejectionCountInPeriod: 0,
  totalQualifyingInvoiceCountAllTime: 5,
};

describe("generateProductInsightsForProduct: insufficient-data priority", () => {
  it("reports ONLY insufficient-data, and skips every other rule, when fewer than two qualifying invoices exist all-time", () => {
    const metrics: ProductInsightMetrics = { ...BASE_METRICS, totalQualifyingInvoiceCountAllTime: 1, claimCountInPeriod: 5 };
    const insights = generateProductInsightsForProduct(metrics);
    expect(insights).toHaveLength(1);
    expect(insights[0].category).toBe("insufficient-data");
    expect(insights[0].dataLimitations).toBeDefined();
  });

  it("does not report insufficient-data once two or more qualifying invoices exist all-time", () => {
    const metrics: ProductInsightMetrics = { ...BASE_METRICS, totalQualifyingInvoiceCountAllTime: 2 };
    const insights = generateProductInsightsForProduct(metrics);
    expect(insights.some((i) => i.category === "insufficient-data")).toBe(false);
  });
});

describe("generateProductInsightsForProduct: repeated claims (structural cutoff, count >= 2)", () => {
  it("does NOT report a claims insight for exactly one claim (one-off, not 'repeated')", () => {
    const metrics: ProductInsightMetrics = { ...BASE_METRICS, claimCountInPeriod: 1 };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "activity-with-repeated-claims")).toBe(false);
  });

  it("reports a claims insight once claimCountInPeriod reaches 2", () => {
    const metrics: ProductInsightMetrics = { ...BASE_METRICS, claimCountInPeriod: 2, returnCountInPeriod: 1 };
    const insight = generateProductInsightsForProduct(metrics).find((i) => i.category === "activity-with-repeated-claims");
    expect(insight).toBeDefined();
    expect(insight!.supportingMetrics.claimCountInPeriod).toBe(2);
    expect(insight!.sapItemCode).toBe("ITEM-1");
    expect(insight!.productId).toBe("product-1");
  });
});

describe("generateProductInsightsForProduct: repeated unfulfilled demand (confirmed lost sales only)", () => {
  it("does NOT report for a single confirmed lost sale", () => {
    const metrics: ProductInsightMetrics = { ...BASE_METRICS, confirmedLostSaleCountInPeriod: 1 };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "demand-with-repeated-unfulfilled-quantities")).toBe(false);
  });

  it("reports once confirmedLostSaleCountInPeriod reaches 2, and documents the CONFIRMED-only limitation", () => {
    const metrics: ProductInsightMetrics = { ...BASE_METRICS, confirmedLostSaleCountInPeriod: 2 };
    const insight = generateProductInsightsForProduct(metrics).find((i) => i.category === "demand-with-repeated-unfulfilled-quantities");
    expect(insight).toBeDefined();
    expect(insight!.dataLimitations).toMatch(/CONFIRMED/);
  });
});

describe("generateProductInsightsForProduct: repeated delivery rejections", () => {
  it("does NOT report for a single rejection", () => {
    const metrics: ProductInsightMetrics = { ...BASE_METRICS, deliveryRejectionCountInPeriod: 1 };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "repeated-delivery-rejections")).toBe(false);
  });

  it("reports once deliveryRejectionCountInPeriod reaches 2", () => {
    const metrics: ProductInsightMetrics = { ...BASE_METRICS, deliveryRejectionCountInPeriod: 2 };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "repeated-delivery-rejections")).toBe(true);
  });
});

describe("generateProductInsightsForProduct: credit notes reach or exceed invoiced value (self-justifying 100% bar)", () => {
  it("does NOT report when the credit-note value is strictly less than the invoiced value in the same currency", () => {
    const metrics: ProductInsightMetrics = {
      ...BASE_METRICS,
      currentPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "100" }],
      creditNoteValueByCurrencyInPeriod: [{ currency: "USD", total: "99" }],
    };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "credit-notes-reach-or-exceed-invoiced-value")).toBe(false);
  });

  it("reports when the credit-note value equals the invoiced value in the same currency", () => {
    const metrics: ProductInsightMetrics = {
      ...BASE_METRICS,
      currentPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "100" }],
      creditNoteValueByCurrencyInPeriod: [{ currency: "USD", total: "100" }],
    };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "credit-notes-reach-or-exceed-invoiced-value")).toBe(true);
  });

  it("reports when credit notes exist in a currency with ZERO invoiced value in the same period (no division, treated as invoicedValue=0)", () => {
    const metrics: ProductInsightMetrics = {
      ...BASE_METRICS,
      currentPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "50" }],
      creditNoteValueByCurrencyInPeriod: [{ currency: "ZWG", total: "10" }],
    };
    const insight = generateProductInsightsForProduct(metrics).find((i) => i.category === "credit-notes-reach-or-exceed-invoiced-value");
    expect(insight).toBeDefined();
    expect(insight!.supportingMetrics.currency).toBe("ZWG");
  });

  it("never reports for a zero-value credit note row", () => {
    const metrics: ProductInsightMetrics = {
      ...BASE_METRICS,
      currentPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "0" }],
      creditNoteValueByCurrencyInPeriod: [{ currency: "USD", total: "0" }],
    };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "credit-notes-reach-or-exceed-invoiced-value")).toBe(false);
  });

  it("evaluates each currency independently -- never a cross-currency composite", () => {
    const metrics: ProductInsightMetrics = {
      ...BASE_METRICS,
      currentPeriodInvoiceValueByCurrency: [
        { currency: "USD", total: "100" },
        { currency: "ZWG", total: "500" },
      ],
      creditNoteValueByCurrencyInPeriod: [
        { currency: "USD", total: "100" }, // reaches
        { currency: "ZWG", total: "10" }, // does not reach
      ],
    };
    const insights = generateProductInsightsForProduct(metrics).filter((i) => i.category === "credit-notes-reach-or-exceed-invoiced-value");
    expect(insights).toHaveLength(1);
    expect(insights[0].supportingMetrics.currency).toBe("USD");
  });
});

describe("generateProductInsightsForProduct: broad-customer-base declining activity", () => {
  it("does NOT report when there is no decline (current >= previous)", () => {
    const metrics: ProductInsightMetrics = {
      ...BASE_METRICS,
      distinctCustomerCountCurrentPeriod: 5,
      currentPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "150" }],
      previousPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "100" }],
    };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "broad-customer-base-declining-activity")).toBe(false);
  });

  it("does NOT report a decline for a narrow customer base (fewer than 2 distinct customers), even with a real decline", () => {
    const metrics: ProductInsightMetrics = {
      ...BASE_METRICS,
      distinctCustomerCountCurrentPeriod: 1,
      currentPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "50" }],
      previousPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "100" }],
    };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "broad-customer-base-declining-activity")).toBe(false);
  });

  it("reports a decline for a broad customer base (>= 2 distinct customers) with a real, same-currency decline", () => {
    const metrics: ProductInsightMetrics = {
      ...BASE_METRICS,
      distinctCustomerCountCurrentPeriod: 3,
      currentPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "50" }],
      previousPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "100" }],
    };
    const insight = generateProductInsightsForProduct(metrics).find((i) => i.category === "broad-customer-base-declining-activity");
    expect(insight).toBeDefined();
    expect(insight!.supportingMetrics.currentPeriodValue).toBe("50");
    expect(insight!.supportingMetrics.previousPeriodValue).toBe("100");
  });

  it("never computes a decline when the previous period could not be determined (both previousPeriodFrom/To are null)", () => {
    const metrics: ProductInsightMetrics = {
      ...BASE_METRICS,
      previousPeriodFrom: null,
      previousPeriodTo: null,
      distinctCustomerCountCurrentPeriod: 5,
      currentPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "0" }],
      previousPeriodInvoiceValueByCurrency: [{ currency: "USD", total: "1000" }],
    };
    expect(generateProductInsightsForProduct(metrics).some((i) => i.category === "broad-customer-base-declining-activity")).toBe(false);
  });
});

describe("generateProductInsightsForProduct: a product can surface more than one insight at once", () => {
  it("reports repeated claims AND repeated delivery rejections together, as separate rows -- never merged into one narrative", () => {
    const metrics: ProductInsightMetrics = { ...BASE_METRICS, claimCountInPeriod: 3, deliveryRejectionCountInPeriod: 4 };
    const insights = generateProductInsightsForProduct(metrics);
    expect(insights.map((i) => i.category).sort()).toEqual(["activity-with-repeated-claims", "repeated-delivery-rejections"].sort());
  });
});

describe("hasDeclineSimple", () => {
  it("returns the decline for the first currency where current < previous", () => {
    const result = hasDeclineSimple([{ currency: "USD", total: "40" }], [{ currency: "USD", total: "100" }]);
    expect(result).toEqual({ currency: "USD", currentValue: "40", previousValue: "100" });
  });

  it("treats a currency missing from the current period as zero (no division, no fabricated 100% figure)", () => {
    const result = hasDeclineSimple([], [{ currency: "USD", total: "50" }]);
    expect(result).toEqual({ currency: "USD", currentValue: "0", previousValue: "50" });
  });

  it("returns null when there is no decline in any previous-period currency", () => {
    expect(hasDeclineSimple([{ currency: "USD", total: "150" }], [{ currency: "USD", total: "100" }])).toBeNull();
  });

  it("returns null when the previous period has no currencies at all", () => {
    expect(hasDeclineSimple([{ currency: "USD", total: "0" }], [])).toBeNull();
  });
});

describe("generateProductInsights (multi-product batch)", () => {
  it("flat-maps insights across several products independently, never mixing one product's metrics into another's insight", () => {
    const metricsA: ProductInsightMetrics = { ...BASE_METRICS, sapItemCode: "A", productId: "pa", claimCountInPeriod: 3 };
    const metricsB: ProductInsightMetrics = { ...BASE_METRICS, sapItemCode: "B", productId: "pb", claimCountInPeriod: 0 };
    const insights = generateProductInsights([metricsA, metricsB]);
    const aInsights = insights.filter((i) => i.sapItemCode === "A");
    const bInsights = insights.filter((i) => i.sapItemCode === "B");
    expect(aInsights.some((i) => i.category === "activity-with-repeated-claims")).toBe(true);
    expect(bInsights.some((i) => i.category === "activity-with-repeated-claims")).toBe(false);
  });

  it("returns an empty array for no products at all", () => {
    expect(generateProductInsights([])).toEqual([]);
  });
});
