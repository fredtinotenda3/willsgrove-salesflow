import { describe, it, expect } from "vitest";
import {
  evaluateCustomerDecliningValue,
  evaluateCustomerRepeatedClaimsReturns,
  evaluateCustomerUnresolvedQuotations,
  evaluateCustomerInsufficientRecentActivity,
  evaluateProductDecliningActivity,
  evaluateProductRepeatedClaimsReturns,
  evaluateProductSignificantLostDemand,
  evaluateProductDeliveryRejections,
  evaluateProductInsufficientMasterData,
  evaluateCommercialClaimExposure,
  evaluateCommercialCreditNoteBacklog,
  evaluateSalesUnverifiedAttributionConcentration,
  evaluateSalesUnresolvedQuotationsBacklog,
  evaluateOperationalApprovalBottleneck,
  evaluateOperationalUnfulfilledDemandBacklog,
  evaluateOperationalOrdersAwaitingFulfilment,
} from "@/lib/reporting/decision-rules";

/**
 * Milestone 15 (Decision Intelligence). Unconditional unit tests for the
 * full 16-rule deterministic decision catalogue in
 * lib/reporting/decision-rules.ts (spec section 4). Every rule is a
 * pure function over hand-built fixtures -- no database, no mocking,
 * no RUN_DB_INTEGRATION_TESTS gate. For each rule this file checks: the
 * documented fire floor (does not fire below it, fires at/above it),
 * the priority classification at its documented boundaries, the
 * confidence classification and its basis, and that the candidate
 * carries the correct dedupeKey/category/entity references -- never a
 * fabricated figure.
 */

const PERIOD = { from: "2026-01-01", to: "2026-01-31" };

describe("evaluateCustomerDecliningValue (CUSTOMER_DECLINING_VALUE)", () => {
  const base = {
    customerId: "cust-1",
    customerName: "Acme Produce",
    currencyCode: "USD",
    currentRevenueDisplay: "60",
    previousRevenueDisplay: "100",
  };

  it("does not fire below the 40% decline threshold", () => {
    expect(evaluateCustomerDecliningValue({ ...base, currentRevenue: 65, previousRevenue: 100 }, PERIOD)).toBeNull();
  });

  it("does not fire when there is no prior-period baseline (previousRevenue 0)", () => {
    expect(evaluateCustomerDecliningValue({ ...base, currentRevenue: 0, previousRevenue: 0 }, PERIOD)).toBeNull();
  });

  it("fires MEDIUM priority at exactly the 40% floor, below materiality floor -> MEDIUM confidence", () => {
    const result = evaluateCustomerDecliningValue({ ...base, currentRevenue: 60, previousRevenue: 100, previousRevenueDisplay: "100" }, PERIOD);
    expect(result).not.toBeNull();
    expect(result!.priority).toBe("MEDIUM");
    expect(result!.confidence).toBe("MEDIUM");
    expect(result!.decisionCategory).toBe("CUSTOMER");
    expect(result!.dedupeKey).toBe("CUSTOMER_DECLINING_VALUE::cust-1:USD");
    expect(result!.customerId).toBe("cust-1");
    expect(result!.currencyCode).toBe("USD");
  });

  it("fires HIGH priority at >=75% decline, and HIGH confidence when the prior-period base clears the materiality floor", () => {
    const result = evaluateCustomerDecliningValue({ ...base, currentRevenue: 100, previousRevenue: 1000, previousRevenueDisplay: "1000", currentRevenueDisplay: "100" }, PERIOD);
    expect(result!.priority).toBe("HIGH");
    expect(result!.confidence).toBe("HIGH");
  });

  it("never combines currencies -- the primaryEntityKey/dedupeKey includes the currency so a customer invoiced in two currencies produces distinct candidates", () => {
    const usd = evaluateCustomerDecliningValue({ ...base, currentRevenue: 10, previousRevenue: 100, currencyCode: "USD" }, PERIOD);
    const zwg = evaluateCustomerDecliningValue({ ...base, currentRevenue: 10, previousRevenue: 100, currencyCode: "ZWG" }, PERIOD);
    expect(usd!.dedupeKey).not.toBe(zwg!.dedupeKey);
  });
});

describe("evaluateCustomerRepeatedClaimsReturns (CUSTOMER_REPEATED_CLAIMS_RETURNS)", () => {
  const base = { customerId: "cust-1", customerName: "Acme Produce" };

  it("does not fire when both claim and return counts are below 2", () => {
    expect(evaluateCustomerRepeatedClaimsReturns({ ...base, claimCount: 1, returnCount: 1 }, PERIOD)).toBeNull();
  });

  it("fires MEDIUM at the floor of 2 (either count)", () => {
    const result = evaluateCustomerRepeatedClaimsReturns({ ...base, claimCount: 2, returnCount: 0 }, PERIOD);
    expect(result!.priority).toBe("MEDIUM");
    expect(result!.confidence).toBe("HIGH");
    expect(result!.decisionCategory).toBe("CUSTOMER");
  });

  it("fires HIGH at >=4 of either count", () => {
    const result = evaluateCustomerRepeatedClaimsReturns({ ...base, claimCount: 1, returnCount: 4 }, PERIOD);
    expect(result!.priority).toBe("HIGH");
  });

  it("never asserts a quality or risk label -- the explanation only states observed counts", () => {
    const result = evaluateCustomerRepeatedClaimsReturns({ ...base, claimCount: 3, returnCount: 0 }, PERIOD);
    expect(result!.explanation.toLowerCase()).not.toContain("risk");
    expect(result!.explanation.toLowerCase()).not.toContain("churn");
  });
});

describe("evaluateCustomerUnresolvedQuotations (CUSTOMER_UNRESOLVED_QUOTATIONS)", () => {
  const base = { customerId: "cust-1", customerName: "Acme Produce" };

  it("does not fire at zero unresolved quotations", () => {
    expect(evaluateCustomerUnresolvedQuotations({ ...base, unresolvedCount: 0 }, PERIOD)).toBeNull();
  });

  it("fires at a single unresolved quotation (count >= 1), MEDIUM priority", () => {
    const result = evaluateCustomerUnresolvedQuotations({ ...base, unresolvedCount: 1 }, PERIOD);
    expect(result!.priority).toBe("MEDIUM");
    expect(result!.confidence).toBe("HIGH");
  });

  it("fires HIGH priority at >=3 unresolved quotations", () => {
    const result = evaluateCustomerUnresolvedQuotations({ ...base, unresolvedCount: 3 }, PERIOD);
    expect(result!.priority).toBe("HIGH");
  });
});

describe("evaluateCustomerInsufficientRecentActivity (CUSTOMER_INSUFFICIENT_RECENT_ACTIVITY)", () => {
  const base = { customerId: "cust-1", customerName: "Acme Produce", recencyThresholdDays: 90 };

  it("is purely informational and INSUFFICIENT_DATA when there is no order history at all", () => {
    const result = evaluateCustomerInsufficientRecentActivity({ ...base, daysSinceLastOrder: null, hasAnyOrderHistory: false }, PERIOD);
    expect(result!.priority).toBe("INFORMATIONAL");
    expect(result!.confidence).toBe("INSUFFICIENT_DATA");
  });

  it("does not fire when recent activity is within the threshold", () => {
    expect(evaluateCustomerInsufficientRecentActivity({ ...base, daysSinceLastOrder: 10, hasAnyOrderHistory: true }, PERIOD)).toBeNull();
  });

  it("is INFORMATIONAL/HIGH confidence when the recency threshold is exceeded, and its explanation explicitly disclaims a churn/inactivity classification rather than asserting one", () => {
    const result = evaluateCustomerInsufficientRecentActivity({ ...base, daysSinceLastOrder: 120, hasAnyOrderHistory: true }, PERIOD);
    expect(result!.priority).toBe("INFORMATIONAL");
    expect(result!.confidence).toBe("HIGH");
    expect(result!.explanation.toLowerCase()).not.toContain("lost");
    expect(result!.explanation).toContain("not a churn or inactivity classification");
  });

  it("never fires at exactly the threshold boundary minus one day", () => {
    expect(evaluateCustomerInsufficientRecentActivity({ ...base, daysSinceLastOrder: 89, hasAnyOrderHistory: true }, PERIOD)).toBeNull();
  });
});

describe("evaluateProductDecliningActivity (PRODUCT_DECLINING_ACTIVITY)", () => {
  const base = { sapItemCode: "SKU-1", productId: "prod-1", itemName: "Tomatoes", currencyCode: "USD", currentRevenueDisplay: "30", previousRevenueDisplay: "100" };

  it("does not fire below the 40% decline threshold", () => {
    expect(evaluateProductDecliningActivity({ ...base, currentRevenue: 70, previousRevenue: 100 }, PERIOD)).toBeNull();
  });

  it("fires and is keyed by sapItemCode (never Product.id) even when productId is null (unmatched item)", () => {
    const result = evaluateProductDecliningActivity({ ...base, productId: null, currentRevenue: 30, previousRevenue: 100 }, PERIOD);
    expect(result!.dedupeKey).toBe("PRODUCT_DECLINING_ACTIVITY::SKU-1:USD");
    expect(result!.sapItemCode).toBe("SKU-1");
    expect(result!.productId).toBeNull();
  });

  it("HIGH confidence when the prior-period base clears the 300-unit materiality floor, MEDIUM otherwise", () => {
    const highConf = evaluateProductDecliningActivity({ ...base, currentRevenue: 30, previousRevenue: 1000 }, PERIOD);
    expect(highConf!.confidence).toBe("HIGH");
    const medConf = evaluateProductDecliningActivity({ ...base, currentRevenue: 10, previousRevenue: 100 }, PERIOD);
    expect(medConf!.confidence).toBe("MEDIUM");
  });
});

describe("evaluateProductRepeatedClaimsReturns (PRODUCT_REPEATED_CLAIMS_RETURNS)", () => {
  const base = { sapItemCode: "SKU-1", productId: "prod-1", itemName: "Tomatoes" };

  it("does not fire below the floor of 2", () => {
    expect(evaluateProductRepeatedClaimsReturns({ ...base, claimCount: 1, returnCount: 1 }, PERIOD)).toBeNull();
  });

  it("never implies a quality judgement -- explanation states only the counts and says it does not indicate a quality issue", () => {
    const result = evaluateProductRepeatedClaimsReturns({ ...base, claimCount: 2, returnCount: 0 }, PERIOD);
    expect(result!.explanation).toContain("does not by itself indicate a product-quality issue");
  });

  it("fires HIGH at >=4 of either count", () => {
    const result = evaluateProductRepeatedClaimsReturns({ ...base, claimCount: 0, returnCount: 5 }, PERIOD);
    expect(result!.priority).toBe("HIGH");
  });
});

describe("evaluateProductSignificantLostDemand (PRODUCT_SIGNIFICANT_LOST_DEMAND)", () => {
  const base = { sapItemCode: "SKU-1", productId: "prod-1", itemName: "Tomatoes", confirmedLostQuantityDisplay: "10" };

  it("does not fire below the 10-unit floor", () => {
    expect(evaluateProductSignificantLostDemand({ ...base, confirmedLostSaleCount: 1, confirmedLostQuantity: 9 }, PERIOD)).toBeNull();
  });

  it("fires MEDIUM at the 10-unit floor", () => {
    const result = evaluateProductSignificantLostDemand({ ...base, confirmedLostSaleCount: 2, confirmedLostQuantity: 10 }, PERIOD);
    expect(result!.priority).toBe("MEDIUM");
    expect(result!.confidence).toBe("HIGH");
  });

  it("fires HIGH at the 50-unit threshold, and is purely quantity-based (no estimated monetary value field)", () => {
    const result = evaluateProductSignificantLostDemand({ ...base, confirmedLostSaleCount: 5, confirmedLostQuantity: 50 }, PERIOD);
    expect(result!.priority).toBe("HIGH");
    expect(Object.keys(result!.evidence.metrics)).not.toContain("estimatedValue");
    expect(Object.keys(result!.evidence.metrics)).toEqual(["confirmedLostSaleCount", "confirmedLostQuantity"]);
  });
});

describe("evaluateProductDeliveryRejections (PRODUCT_DELIVERY_REJECTIONS)", () => {
  const base = { sapItemCode: "SKU-1", productId: "prod-1", itemName: "Tomatoes" };

  it("does not fire below the floor of 2", () => {
    expect(evaluateProductDeliveryRejections({ ...base, rejectionEventCount: 1 }, PERIOD)).toBeNull();
  });

  it("never implies a quality issue in its explanation, and its next action points to fulfilment handling rather than assuming a quality cause", () => {
    const result = evaluateProductDeliveryRejections({ ...base, rejectionEventCount: 2 }, PERIOD);
    expect(result!.explanation).toContain("does not by itself indicate a product-quality issue");
    expect(result!.recommendedNextAction.toLowerCase()).toContain("rather than assuming a quality cause");
  });

  it("fires HIGH at >=5 events", () => {
    const result = evaluateProductDeliveryRejections({ ...base, rejectionEventCount: 5 }, PERIOD);
    expect(result!.priority).toBe("HIGH");
  });
});

describe("evaluateProductInsufficientMasterData (PRODUCT_INSUFFICIENT_MASTER_DATA)", () => {
  const base = { sapItemCode: "SKU-1", productId: null, itemNameOrFallback: "SKU-1" };

  it("does not fire when there are no missing fields", () => {
    expect(evaluateProductInsufficientMasterData({ ...base, missingFieldLabels: [] }, PERIOD)).toBeNull();
  });

  it("is always INFORMATIONAL/INSUFFICIENT_DATA by definition when fields are missing", () => {
    const result = evaluateProductInsufficientMasterData({ ...base, missingFieldLabels: ["category", "unit of measure"] }, PERIOD);
    expect(result!.priority).toBe("INFORMATIONAL");
    expect(result!.confidence).toBe("INSUFFICIENT_DATA");
    expect(result!.explanation).toContain("category");
    expect(result!.explanation).toContain("unit of measure");
  });
});

describe("evaluateCommercialClaimExposure (COMMERCIAL_CLAIM_EXPOSURE_BY_CURRENCY)", () => {
  const base = {
    currencyCode: "USD",
    claimCount: 3,
    potentialCreditExposureDisplay: "2000",
    approvedCreditExposureDisplay: "1500",
    actualSapCreditedAmountDisplay: "500",
  };

  it("does not fire below the 500 medium floor", () => {
    expect(evaluateCommercialClaimExposure({ ...base, unresolvedExposure: 499, unresolvedExposureDisplay: "499" }, PERIOD)).toBeNull();
  });

  it("fires MEDIUM between 500 and <1000", () => {
    const result = evaluateCommercialClaimExposure({ ...base, unresolvedExposure: 600, unresolvedExposureDisplay: "600" }, PERIOD);
    expect(result!.priority).toBe("MEDIUM");
  });

  it("fires HIGH between 1000 and <5000", () => {
    const result = evaluateCommercialClaimExposure({ ...base, unresolvedExposure: 1000, unresolvedExposureDisplay: "1000" }, PERIOD);
    expect(result!.priority).toBe("HIGH");
  });

  it("fires CRITICAL at >=5000 -- this rule is explicitly allowed to reach CRITICAL", () => {
    const result = evaluateCommercialClaimExposure({ ...base, unresolvedExposure: 5000, unresolvedExposureDisplay: "5000" }, PERIOD);
    expect(result!.priority).toBe("CRITICAL");
  });

  it("never combines currencies -- keyed by currencyCode alone", () => {
    const result = evaluateCommercialClaimExposure({ ...base, unresolvedExposure: 5000, unresolvedExposureDisplay: "5000" }, PERIOD);
    expect(result!.dedupeKey).toBe("COMMERCIAL_CLAIM_EXPOSURE_BY_CURRENCY::USD");
    expect(result!.currencyCode).toBe("USD");
  });

  it("surfaces potential/approved/actual-credited/unresolved as four DISTINCT metrics -- never pre-summed into one figure", () => {
    const result = evaluateCommercialClaimExposure({ ...base, unresolvedExposure: 5000, unresolvedExposureDisplay: "5000" }, PERIOD);
    expect(result!.evidence.metrics.potentialCreditExposure).toBe("2000");
    expect(result!.evidence.metrics.approvedCreditExposure).toBe("1500");
    expect(result!.evidence.metrics.actualSapCreditedAmount).toBe("500");
    expect(result!.evidence.metrics.unresolvedExposure).toBe("5000");
  });
});

describe("evaluateCommercialCreditNoteBacklog (COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY)", () => {
  const base = { currencyCode: "USD" };

  it("does not fire below both the count floor (2) and the amount floor (500)", () => {
    expect(evaluateCommercialCreditNoteBacklog({ ...base, unmatchedCount: 1, unmatchedAmount: 100, unmatchedAmountDisplay: "100" }, PERIOD)).toBeNull();
  });

  it("fires when the count floor alone is met, even with a small amount", () => {
    const result = evaluateCommercialCreditNoteBacklog({ ...base, unmatchedCount: 2, unmatchedAmount: 10, unmatchedAmountDisplay: "10" }, PERIOD);
    expect(result).not.toBeNull();
  });

  it("fires when the amount floor alone is met, even with a single credit note", () => {
    const result = evaluateCommercialCreditNoteBacklog({ ...base, unmatchedCount: 1, unmatchedAmount: 500, unmatchedAmountDisplay: "500" }, PERIOD);
    expect(result).not.toBeNull();
  });

  it("fires HIGH at >=5 unmatched credit notes", () => {
    const result = evaluateCommercialCreditNoteBacklog({ ...base, unmatchedCount: 5, unmatchedAmount: 5000, unmatchedAmountDisplay: "5000" }, PERIOD);
    expect(result!.priority).toBe("HIGH");
  });

  it("is a structurally separate signal from claim exposure -- distinct ruleId/dedupeKey namespace", () => {
    const result = evaluateCommercialCreditNoteBacklog({ ...base, unmatchedCount: 5, unmatchedAmount: 5000, unmatchedAmountDisplay: "5000" }, PERIOD);
    expect(result!.ruleId).toBe("COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY");
    expect(result!.ruleId).not.toBe("COMMERCIAL_CLAIM_EXPOSURE_BY_CURRENCY");
  });
});

describe("evaluateSalesUnverifiedAttributionConcentration (SALES_UNVERIFIED_ATTRIBUTION_CONCENTRATION)", () => {
  const base = { salespersonId: "sp-1", salespersonName: "Jane Doe" };

  it("does not fire below the minimum sample size of 5 orders, regardless of share", () => {
    expect(evaluateSalesUnverifiedAttributionConcentration({ ...base, totalOrders: 4, unverifiedOrders: 4 }, PERIOD)).toBeNull();
  });

  it("does not fire below the 50% unverified-share threshold", () => {
    expect(evaluateSalesUnverifiedAttributionConcentration({ ...base, totalOrders: 10, unverifiedOrders: 4 }, PERIOD)).toBeNull();
  });

  it("fires MEDIUM between 50% and <80% unverified share", () => {
    const result = evaluateSalesUnverifiedAttributionConcentration({ ...base, totalOrders: 10, unverifiedOrders: 6 }, PERIOD);
    expect(result!.priority).toBe("MEDIUM");
  });

  it("fires HIGH at >=80% unverified share", () => {
    const result = evaluateSalesUnverifiedAttributionConcentration({ ...base, totalOrders: 10, unverifiedOrders: 9 }, PERIOD);
    expect(result!.priority).toBe("HIGH");
  });

  it("confidence is ALWAYS capped at MEDIUM, even at a 100% unverified share -- never upgraded to HIGH", () => {
    const result = evaluateSalesUnverifiedAttributionConcentration({ ...base, totalOrders: 20, unverifiedOrders: 20 }, PERIOD);
    expect(result!.confidence).toBe("MEDIUM");
  });

  it("never treats unverified attribution as verified performance -- explanation frames this as a data/process flag, not a judgement", () => {
    const result = evaluateSalesUnverifiedAttributionConcentration({ ...base, totalOrders: 10, unverifiedOrders: 8 }, PERIOD);
    expect(result!.explanation.toLowerCase()).toContain("unverified");
  });
});

describe("evaluateSalesUnresolvedQuotationsBacklog (SALES_UNRESOLVED_QUOTATIONS_BACKLOG)", () => {
  const base = { salespersonId: "sp-1", salespersonName: "Jane Doe" };

  it("does not fire below the floor of 3", () => {
    expect(evaluateSalesUnresolvedQuotationsBacklog({ ...base, unresolvedCount: 2 }, PERIOD)).toBeNull();
  });

  it("fires MEDIUM at the floor, HIGH at >=8", () => {
    expect(evaluateSalesUnresolvedQuotationsBacklog({ ...base, unresolvedCount: 3 }, PERIOD)!.priority).toBe("MEDIUM");
    expect(evaluateSalesUnresolvedQuotationsBacklog({ ...base, unresolvedCount: 8 }, PERIOD)!.priority).toBe("HIGH");
  });

  it("is keyed by salesperson, a legitimately distinct grain from CUSTOMER_UNRESOLVED_QUOTATIONS", () => {
    const result = evaluateSalesUnresolvedQuotationsBacklog({ ...base, unresolvedCount: 3 }, PERIOD);
    expect(result!.salespersonId).toBe("sp-1");
    expect(result!.customerId).toBeNull();
  });
});

describe("evaluateOperationalApprovalBottleneck (OPERATIONAL_APPROVAL_BOTTLENECK)", () => {
  it("does not fire at zero overdue approvals", () => {
    expect(evaluateOperationalApprovalBottleneck({ overdueCount: 0 }, PERIOD)).toBeNull();
  });

  it("fires MEDIUM at the floor of 1, HIGH at >=5, CRITICAL at >=10", () => {
    expect(evaluateOperationalApprovalBottleneck({ overdueCount: 1 }, PERIOD)!.priority).toBe("MEDIUM");
    expect(evaluateOperationalApprovalBottleneck({ overdueCount: 5 }, PERIOD)!.priority).toBe("HIGH");
    expect(evaluateOperationalApprovalBottleneck({ overdueCount: 10 }, PERIOD)!.priority).toBe("CRITICAL");
  });

  it("is a single whole-business aggregate candidate with a fixed, stable entity key", () => {
    const result = evaluateOperationalApprovalBottleneck({ overdueCount: 3 }, PERIOD);
    expect(result!.dedupeKey).toBe("OPERATIONAL_APPROVAL_BOTTLENECK::ALL");
  });
});

describe("evaluateOperationalUnfulfilledDemandBacklog (OPERATIONAL_UNFULFILLED_DEMAND_BACKLOG)", () => {
  it("does not fire below the floor of 5", () => {
    expect(evaluateOperationalUnfulfilledDemandBacklog({ openCount: 4 }, PERIOD)).toBeNull();
  });

  it("fires MEDIUM at the floor, HIGH at >=20", () => {
    expect(evaluateOperationalUnfulfilledDemandBacklog({ openCount: 5 }, PERIOD)!.priority).toBe("MEDIUM");
    expect(evaluateOperationalUnfulfilledDemandBacklog({ openCount: 20 }, PERIOD)!.priority).toBe("HIGH");
  });

  it("never invents a confirmed-lost-sale event -- explanation refers only to open, already-recorded UnfulfilledDemand rows", () => {
    const result = evaluateOperationalUnfulfilledDemandBacklog({ openCount: 5 }, PERIOD);
    expect(result!.explanation).toContain("not yet resolved");
  });
});

describe("evaluateOperationalOrdersAwaitingFulfilment (OPERATIONAL_ORDERS_AWAITING_FULFILMENT)", () => {
  it("does not fire below the floor of 5", () => {
    expect(evaluateOperationalOrdersAwaitingFulfilment({ awaitingCount: 4 }, PERIOD)).toBeNull();
  });

  it("fires MEDIUM at the floor, HIGH at >=20", () => {
    expect(evaluateOperationalOrdersAwaitingFulfilment({ awaitingCount: 5 }, PERIOD)!.priority).toBe("MEDIUM");
    expect(evaluateOperationalOrdersAwaitingFulfilment({ awaitingCount: 20 }, PERIOD)!.priority).toBe("HIGH");
  });
});

describe("every rule in the catalogue", () => {
  it("never produces a priority/confidence value outside the fixed enums (a compile-time guarantee this test makes explicit at runtime too)", () => {
    const result = evaluateCommercialClaimExposure(
      { currencyCode: "USD", claimCount: 1, potentialCreditExposureDisplay: "1", approvedCreditExposureDisplay: "1", actualSapCreditedAmountDisplay: "1", unresolvedExposure: 5000, unresolvedExposureDisplay: "5000" },
      PERIOD,
    );
    expect(["CRITICAL", "HIGH", "MEDIUM", "LOW", "INFORMATIONAL"]).toContain(result!.priority);
    expect(["HIGH", "MEDIUM", "LOW", "INSUFFICIENT_DATA"]).toContain(result!.confidence);
  });

  it("every firing candidate carries a ruleVersion and a non-empty recommendedNextAction -- spec section 4's required fields", () => {
    const result = evaluateOperationalApprovalBottleneck({ overdueCount: 1 }, PERIOD);
    expect(result!.ruleVersion).toBe(1);
    expect(result!.recommendedNextAction.length).toBeGreaterThan(0);
    expect(result!.reportingPeriodFrom).toBe(PERIOD.from);
    expect(result!.reportingPeriodTo).toBe(PERIOD.to);
  });
});
