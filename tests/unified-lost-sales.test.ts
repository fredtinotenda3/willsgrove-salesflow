import { describe, expect, it } from "vitest";
import {
  aggregateUnifiedLostSales,
  buildReasonBreakdown,
  buildReasonTrend,
  chooseGranularity,
  classifyClaimOutcome,
  type ClaimFact,
  type ClaimLineFact,
  type DemandFact,
} from "@/lib/lost-sales/unified-core";

// The real example from the brief: invoice SF-INV-20261124-1F62F77E / claim CLM-20261124-1E25F29C
const claim: ClaimFact = { claimId: "c1", status: "OPEN", currency: "USD", customerId: "cust1", customerName: "Baobab Hotel & Conference Centre", creditedAmount: "0", approvedCreditAmount: "0", latestDecision: null };
const potatoes: ClaimLineFact = { claimId: "c1", claimLineId: "l1", claimDate: "2026-11-24", claimStatus: "OPEN", customerId: "cust1", customerName: "Baobab", productKey: "VEG-0003", sapItemCode: "VEG-0003", description: "Potatoes Washed", unit: "kg", reasonCategory: "OVERSUPPLY", disputeType: "QUANTITY", rejectedQuantity: "10", returnedQuantity: "0", value: "8.5", currency: "USD" };
const onions: ClaimLineFact = { ...potatoes, claimLineId: "l2", productKey: "VEG-0002", sapItemCode: "VEG-0002", description: "Onions Brown", reasonCategory: "DUPLICATE_ENTRY", rejectedQuantity: "5", value: "4.5" };

function demand(over: Partial<DemandFact> = {}): DemandFact {
  return { id: "d1", orderId: "o1", customerId: "cust1", customerName: "Baobab", productKey: "VEG-0003", sapItemCode: "VEG-0003", description: "Potatoes Washed", unit: "kg", unavailableQuantity: "20", confirmedLostQuantity: "20", estimatedUnitPrice: "0.85", estimatedValue: "17", ...over };
}

describe("unified lost sales - the Baobab example", () => {
  const u = aggregateUnifiedLostSales({ claimLines: [potatoes, onions], claims: [claim], returnLosses: [], demands: [] });
  it("counts 15 rejected across two products, in their own units, USD 13.00 disputed", () => {
    expect(u.rejectedAfterDelivery.quantityByUnit).toEqual([{ unit: "kg", quantity: "15" }]);
    expect(u.rejectedAfterDelivery.valueByCurrency).toEqual([{ currency: "USD", value: "13" }]);
    expect(u.disputedValueByCurrency).toEqual([{ currency: "USD", value: "13" }]);
  });
  it("is NOT a confirmed loss, not returned, not credited: it is under dispute", () => {
    expect(u.returned.quantityByUnit).toEqual([]);
    expect(u.confirmedLost.nonResalableReturns.quantityByUnit).toEqual([]);
    expect(u.creditedByCurrency).toEqual([]);
    expect(u.underDisputeByCurrency).toEqual([{ currency: "USD", value: "13" }]);
    expect(u.retainedByCurrency).toEqual([]);
    expect(u.openClaimCount).toBe(1);
  });
});

describe("claim outcome", () => {
  it("partially credited open claim: remaining is disputed minus actual credit", () => {
    const o = classifyClaimOutcome({ ...claim, status: "PARTIALLY_RESOLVED", creditedAmount: "5" }, BigInt(130000));
    expect(o.underDispute).toBe(BigInt(80000));
    expect(o.credited).toBe(BigInt(50000));
    expect(o.retained).toBe(BigInt(0));
  });
  it("shows approved-but-not-yet-credited separately from the disputed amount", () => {
    const o = classifyClaimOutcome({ ...claim, status: "APPROVED", approvedCreditAmount: "13", creditedAmount: "4" }, BigInt(130000));
    expect(o.approvedNotYetCredited).toBe(BigInt(90000));
    expect(o.underDispute).toBe(BigInt(90000));
  });
  it("a rejected claim retains the sale; a claim rejected after partial credit retains only the remainder", () => {
    expect(classifyClaimOutcome({ ...claim, status: "REJECTED" }, BigInt(130000)).retained).toBe(BigInt(130000));
    expect(classifyClaimOutcome({ ...claim, status: "REJECTED", creditedAmount: "3" }, BigInt(130000)).retained).toBe(BigInt(100000));
  });
  it.each(["NO_ACTION_REQUIRED", "CLAIM_REJECTED", "PRICING_CORRECTION_REQUIRED"])("resolved with %s is retained", (decision) => {
    expect(classifyClaimOutcome({ ...claim, status: "RESOLVED", latestDecision: decision }, BigInt(10000)).retained).toBe(BigInt(10000));
  });
  it("resolved by replacement is shown as replacement, not retained and not lost", () => {
    const o = classifyClaimOutcome({ ...claim, status: "RESOLVED", latestDecision: "REPLACEMENT_APPROVED" }, BigInt(10000));
    expect([o.replacement, o.retained]).toEqual([BigInt(10000), BigInt(0)]);
  });
  it("a concluded claim with no classifying decision is left unclassified, never guessed", () => {
    const closed = classifyClaimOutcome({ ...claim, status: "CLOSED", latestDecision: null }, BigInt(10000));
    expect(closed.unclassifiedConcluded).toBe(BigInt(10000));
    const credit = classifyClaimOutcome({ ...claim, status: "RESOLVED", latestDecision: "FULL_CREDIT_RECOMMENDED", creditedAmount: "1" }, BigInt(10000));
    expect(credit.unclassifiedConcluded).toBe(BigInt(0));
  });
  it("flags credit above disputed instead of clamping silently", () => {
    const o = classifyClaimOutcome({ ...claim, creditedAmount: "20" }, BigInt(130000));
    expect(o.creditExceedsDisputed).toBe(true);
    expect(o.underDispute).toBe(BigInt(0));
  });
});

describe("rejected vs physically returned, credit vs dispute", () => {
  it("keeps returned beside rejected and never above it", () => {
    const u = aggregateUnifiedLostSales({ claimLines: [{ ...potatoes, returnedQuantity: "4" }, { ...onions, returnedQuantity: "99" }], claims: [claim], returnLosses: [], demands: [] });
    expect(u.rejectedAfterDelivery.quantityByUnit[0].quantity).toBe("15");
    expect(u.returned.quantityByUnit[0].quantity).toBe("9"); // 4 + min(99, 5)
  });
  it("reports credit notes separately from the disputed amount", () => {
    const u = aggregateUnifiedLostSales({ claimLines: [potatoes, onions], claims: [{ ...claim, creditedAmount: "4.5" }], returnLosses: [], demands: [] });
    expect(u.disputedValueByCurrency[0].value).toBe("13");
    expect(u.creditedByCurrency[0].value).toBe("4.5");
    expect(u.underDisputeByCurrency[0].value).toBe("8.5");
  });
  it("confirmed loss from returns comes only from the provided non-resalable losses", () => {
    const u = aggregateUnifiedLostSales({ claimLines: [{ ...potatoes, returnedQuantity: "10" }], claims: [claim], returnLosses: [{ claimId: "c1", currency: "USD", unit: "kg", quantity: "6", value: "5.1" }], demands: [] });
    expect(u.returned.quantityByUnit[0].quantity).toBe("10");
    expect(u.confirmedLost.nonResalableReturns).toEqual({ quantityByUnit: [{ unit: "kg", quantity: "6" }], valueByCurrency: [{ currency: "USD", value: "5.1" }] });
  });
});

describe("combined without double counting", () => {
  it("keeps unfulfilled and rejected quantity as separate measures for the same product", () => {
    const u = aggregateUnifiedLostSales({ claimLines: [potatoes], claims: [claim], returnLosses: [], demands: [demand()] });
    expect(u.unfulfilled.quantityByUnit).toEqual([{ unit: "kg", quantity: "20" }]);
    expect(u.rejectedAfterDelivery.quantityByUnit).toEqual([{ unit: "kg", quantity: "10" }]);
    expect(u.unfulfilled.value).toEqual([{ currency: "USD", value: "17" }]);
  });
  it("a pricing dispute adds disputed value but no rejected quantity", () => {
    const price: ClaimLineFact = { ...potatoes, claimLineId: "l9", disputeType: "AMOUNT_ONLY", rejectedQuantity: null, value: "3", reasonCategory: "PRICING_DISPUTE" };
    const u = aggregateUnifiedLostSales({ claimLines: [potatoes, price], claims: [claim], returnLosses: [], demands: [] });
    expect(u.rejectedAfterDelivery.quantityByUnit[0].quantity).toBe("10");
    expect(u.rejectedAfterDelivery.claimLineCount).toBe(1);
    expect(u.disputedValueByCurrency[0].value).toBe("11.5");
  });
  it("keeps USD and ZWG apart everywhere", () => {
    const zwg: ClaimFact = { ...claim, claimId: "c2", currency: "ZWG" };
    const zl: ClaimLineFact = { ...potatoes, claimId: "c2", claimLineId: "z1", currency: "ZWG", value: "300" };
    const u = aggregateUnifiedLostSales({ claimLines: [potatoes, zl], claims: [claim, zwg], returnLosses: [], demands: [] });
    expect(u.disputedValueByCurrency.map((r) => r.currency).sort()).toEqual(["USD", "ZWG"]);
    expect(u.rejectedAfterDelivery.valueByCurrency).toHaveLength(2);
  });
  it("counts unpriced lines and demands instead of inventing a price", () => {
    const u = aggregateUnifiedLostSales({ claimLines: [{ ...potatoes, value: null }], claims: [claim], returnLosses: [], demands: [demand({ estimatedValue: null, estimatedUnitPrice: null })] });
    expect(u.rejectedAfterDelivery.linesWithoutPrice).toBe(1);
    expect(u.rejectedAfterDelivery.valueByCurrency).toEqual([]);
    expect(u.unfulfilled.demandsWithoutPrice).toBe(1);
    expect(u.confirmedLost.shortage.value).toEqual([]);
  });
  it("never adds quantities of different units", () => {
    const u = aggregateUnifiedLostSales({ claimLines: [potatoes, { ...onions, unit: "ctn" }], claims: [claim], returnLosses: [], demands: [] });
    expect(u.rejectedAfterDelivery.quantityByUnit).toHaveLength(2);
  });
});

describe("claims by standardised reason", () => {
  const lines = [potatoes, onions, { ...potatoes, claimId: "c2", claimLineId: "l3", claimDate: "2026-11-10", rejectedQuantity: "2", value: "1.7" }];
  const b = buildReasonBreakdown(lines);
  it("ranks reasons by distinct claims with share of total claims", () => {
    expect(b.totalClaims).toBe(2);
    expect(b.rows[0]).toMatchObject({ reasonCategory: "OVERSUPPLY", label: "OverSupply", claimCount: 2, claimSharePercent: 100 });
    expect(b.rows[1]).toMatchObject({ reasonCategory: "DUPLICATE_ENTRY", claimCount: 1, claimSharePercent: 50 });
  });
  it("sums exposure per currency and quantity per unit, rejected apart from returned", () => {
    expect(b.rows[0].exposureByCurrency).toEqual([{ currency: "USD", value: "10.2" }]);
    expect(b.rows[0].quantityByUnit).toEqual([{ unit: "kg", rejected: "12", returned: "0" }]);
  });
  it("uses only real reasons; unknown stored values go to a legacy row, missing reasons to a 'none' row", () => {
    const x = buildReasonBreakdown([{ ...potatoes, reasonCategory: "PRODUCT_NOT_ORDERED" }, { ...onions, reasonCategory: null }]);
    expect(x.rows.map((r) => r.reasonCategory).sort()).toEqual(["__LEGACY__", "__NONE__"]);
  });
  it("is empty (not invented) with no lines", () => {
    const e = buildReasonBreakdown([]);
    expect(e).toMatchObject({ totalClaims: 0, rows: [] });
    expect(e.trend.buckets).toEqual([]);
  });
});

describe("reason trend", () => {
  it("chooses day/week/month by span", () => {
    expect(chooseGranularity("2026-11-01", "2026-11-14")).toBe("day");
    expect(chooseGranularity("2026-09-01", "2026-11-14")).toBe("week");
    expect(chooseGranularity("2026-01-01", "2026-11-14")).toBe("month");
  });
  it("buckets by claim date, fills true zeros, counts distinct claims per reason", () => {
    const t = buildReasonTrend([potatoes, { ...potatoes, claimLineId: "dup" }, { ...onions, claimDate: "2026-11-26", claimId: "c3" }], { from: "2026-11-24", to: "2026-11-26" });
    expect(t.granularity).toBe("day");
    expect(t.buckets.map((b) => b.counts.OVERSUPPLY)).toEqual([1, 0, 0]);
    expect(t.buckets[2].counts.DUPLICATE_ENTRY).toBe(1);
  });
  it("ignores claims outside the requested range", () => {
    const t = buildReasonTrend([potatoes], { from: "2026-11-01", to: "2026-11-10" });
    expect(t.buckets.every((b) => Object.values(b.counts).every((n) => n === 0))).toBe(true);
  });
});
