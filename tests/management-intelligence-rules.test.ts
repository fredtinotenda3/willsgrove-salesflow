import { describe, expect, it } from "vitest";
import {
  buildAwaitingFulfilmentIntelligence,
  buildCommunicationFailuresIntelligence,
  buildDeliveryExceptionsIntelligence,
  buildInvoiceClaimsIntelligence,
  buildLostSalesIntelligence,
  buildOperationalSummaryIntelligence,
  buildOutstandingOrdersIntelligence,
  buildPickingShortagesIntelligence,
  buildQuotationsIntelligence,
  reasonFindings,
  type ClaimsExposureFacts,
  type LostSalesFacts,
  type OperationalFacts,
  type OrderAgeFacts,
  type QuotationFacts,
} from "@/lib/management-intelligence/rules";
import { INTELLIGENCE_THRESHOLDS as T } from "@/lib/management-intelligence/thresholds";
import { RESPONSIBLE_FUNCTIONS, TIMEFRAME_BY_PRIORITY, FINDING_PRIORITIES } from "@/lib/management-intelligence/types";

const operational = (over: Partial<OperationalFacts> = {}): OperationalFacts => ({
  periodLabel: "2026-11-01 to 2026-11-24",
  pickingAvailabilityRatePercent: 96,
  pickingLineSampleSize: 120,
  deliveryAcceptanceRatePercent: 99,
  deliveryLineSampleSize: 80,
  dispatchesOverdueToDepart: 0,
  ordersAwaitingPicking: 0,
  failedOutbound: 0,
  ordersWithFailedOutbound: 0,
  deliveryExceptionsWithNoSuccessfulNotification: 0,
  ...over,
});

const ages = (over: Partial<OrderAgeFacts> = {}): OrderAgeFacts => ({ totalOrders: 20, rowsExamined: 20, agedCount: 0, criticalAgedCount: 0, oldestDays: 4, oldestReference: "ORD-1", topStatus: { status: "Approved", count: 6 }, agedCountIsMinimum: false, ...over });

describe("every finding carries the full decision shape", () => {
  it("has finding, evidence, impact, action, function, priority, timeframe, outcome, measurement and a link", () => {
    const intel = buildOperationalSummaryIntelligence(operational({ pickingAvailabilityRatePercent: 70, dispatchesOverdueToDepart: 2, failedOutbound: 3 }));
    expect(intel.findings.length).toBe(3);
    for (const f of intel.findings) {
      expect(f.finding.length).toBeGreaterThan(10);
      expect(f.evidence.length).toBeGreaterThan(0);
      expect(f.businessImpact.length).toBeGreaterThan(10);
      expect(f.recommendedAction.length).toBeGreaterThan(10);
      expect(RESPONSIBLE_FUNCTIONS).toContain(f.responsibleFunction);
      expect(FINDING_PRIORITIES).toContain(f.priority);
      expect(f.timeframe).toBe(TIMEFRAME_BY_PRIORITY[f.priority]);
      expect(f.expectedOutcome.length).toBeGreaterThan(5);
      expect(f.measurement.length).toBeGreaterThan(5);
      expect(f.links.length).toBeGreaterThan(0);
      expect(f.links.every((l) => l.href.startsWith("/"))).toBe(true);
    }
  });

  it("sorts critical before high before medium", () => {
    const intel = buildOperationalSummaryIntelligence(operational({ pickingAvailabilityRatePercent: 60, dispatchesOverdueToDepart: 1, failedOutbound: 1 }));
    const ranks = intel.findings.map((f) => FINDING_PRIORITIES.indexOf(f.priority));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(intel.findings[0].priority).toBe("CRITICAL");
  });
});

describe("1. operational summary", () => {
  it("flags low picking availability to Purchasing, critical below the critical line", () => {
    const low = buildOperationalSummaryIntelligence(operational({ pickingAvailabilityRatePercent: 85 }));
    expect(low.findings.map((f) => f.key)).toEqual(["picking-availability-low"]);
    expect(low.findings[0].priority).toBe("HIGH");
    expect(low.findings[0].responsibleFunction).toBe("PURCHASING");
    const critical = buildOperationalSummaryIntelligence(operational({ pickingAvailabilityRatePercent: T.pickingAvailabilityCriticalPercent - 1 }));
    expect(critical.findings[0].priority).toBe("CRITICAL");
  });

  it("flags low delivery acceptance to Quality Control", () => {
    const intel = buildOperationalSummaryIntelligence(operational({ deliveryAcceptanceRatePercent: 90 }));
    expect(intel.findings[0].key).toBe("delivery-acceptance-low");
    expect(intel.findings[0].responsibleFunction).toBe("QUALITY_CONTROL");
  });

  it("says insufficient evidence, and gives no advice, when the sample is too small", () => {
    const intel = buildOperationalSummaryIntelligence(operational({ pickingAvailabilityRatePercent: 40, pickingLineSampleSize: T.minSample - 1 }));
    expect(intel.findings.find((f) => f.key === "picking-availability-low")).toBeUndefined();
    expect(intel.insufficientEvidence.some((n) => n.startsWith("Picking availability"))).toBe(true);
    expect(intel.noActionIndicated).toBe(false);
  });

  it("indicates no action when healthy with enough data", () => {
    const intel = buildOperationalSummaryIntelligence(operational());
    expect(intel.findings).toEqual([]);
    expect(intel.insufficientEvidence).toEqual([]);
    expect(intel.noActionIndicated).toBe(true);
  });

  it("does not invent a rate when none exists", () => {
    const intel = buildOperationalSummaryIntelligence(operational({ pickingAvailabilityRatePercent: null, pickingLineSampleSize: 0, deliveryAcceptanceRatePercent: null, deliveryLineSampleSize: 0 }));
    expect(intel.findings).toEqual([]);
    expect(intel.insufficientEvidence.length).toBe(2);
  });
});

describe("2 and 3. outstanding orders and awaiting fulfilment", () => {
  it("reports aged outstanding orders to Operations and escalates a critical age", () => {
    const some = buildOutstandingOrdersIntelligence(ages({ agedCount: 2, oldestDays: 20 }));
    expect(some.findings[0].key).toBe("aged-orders");
    expect(some.findings[0].priority).toBe("MEDIUM");
    expect(some.findings[0].responsibleFunction).toBe("OPERATIONS");
    const critical = buildOutstandingOrdersIntelligence(ages({ agedCount: 2, criticalAgedCount: 1, oldestDays: 45 }));
    expect(critical.findings[0].priority).toBe("CRITICAL");
    const many = buildOutstandingOrdersIntelligence(ages({ agedCount: T.minSample, oldestDays: 20 }));
    expect(many.findings[0].priority).toBe("HIGH");
  });

  it("states a minimum when the aged count may be truncated", () => {
    const intel = buildOutstandingOrdersIntelligence(ages({ totalOrders: 500, rowsExamined: 200, agedCount: 200, agedCountIsMinimum: true, oldestDays: 90, criticalAgedCount: 150 }));
    expect(intel.findings[0].finding).toContain("at least 200");
  });

  it("flags a stage holding most outstanding orders, but only with enough orders", () => {
    const hit = buildOutstandingOrdersIntelligence(ages({ totalOrders: 10, topStatus: { status: "Awaiting approval", count: 7 } }));
    expect(hit.findings.map((f) => f.key)).toContain("status-concentration");
    const thin = buildOutstandingOrdersIntelligence(ages({ totalOrders: 3, topStatus: { status: "Awaiting approval", count: 3 } }));
    expect(thin.findings).toEqual([]);
  });

  it("reports aged approved orders to the Warehouse using the shorter threshold", () => {
    const intel = buildAwaitingFulfilmentIntelligence(ages({ agedCount: 3, oldestDays: 6 }));
    expect(intel.findings[0].responsibleFunction).toBe("WAREHOUSE");
    expect(intel.findings[0].finding).toContain(`${T.awaitingFulfilmentAgeDays} days`);
    expect(intel.findings.find((f) => f.key === "status-concentration")).toBeUndefined();
  });

  it("indicates no action for an empty or healthy queue", () => {
    expect(buildOutstandingOrdersIntelligence(ages({ totalOrders: 0, topStatus: null })).noActionIndicated).toBe(true);
    expect(buildAwaitingFulfilmentIntelligence(ages()).noActionIndicated).toBe(true);
  });
});

describe("4. picking shortages", () => {
  const product = (productDescription: string, lineCount: number, linesWithoutPrice = 0) => ({ productDescription, lineCount, totalUnavailableQuantity: "42", totalUnavailableValue: "120.5", linesWithoutPrice });

  it("raises one finding per product with repeated shortages, owned by Purchasing", () => {
    const intel = buildPickingShortagesIntelligence({ totalLines: 30, topProducts: [product("Baby Marrow", 9), product("Carrots", 4), product("Onions", 2)] });
    expect(intel.findings.map((f) => f.key)).toEqual(["product-shortage:Baby Marrow", "product-shortage:Carrots"]);
    expect(intel.findings[0].priority).toBe("CRITICAL");
    expect(intel.findings[1].priority).toBe("HIGH");
    expect(intel.findings.every((f) => f.responsibleFunction === "PURCHASING" && f.tag === "shortage")).toBe(true);
  });

  it("never shows a value for lines that were never priced", () => {
    const intel = buildPickingShortagesIntelligence({ totalLines: 5, topProducts: [product("Tomatoes", 3, 3)] });
    const value = intel.findings[0].evidence.find((e) => e.label.startsWith("Value"));
    expect(value?.value).toBe("not priced");
  });

  it("reports unpriced lines as a count when some are priced", () => {
    const intel = buildPickingShortagesIntelligence({ totalLines: 8, topProducts: [product("Tomatoes", 5, 2)] });
    expect(intel.findings[0].evidence.some((e) => e.label.includes("without an approved price") && e.value === "2")).toBe(true);
  });

  it("explains a thin sample instead of advising", () => {
    const intel = buildPickingShortagesIntelligence({ totalLines: 2, topProducts: [product("Onions", 2)] });
    expect(intel.findings).toEqual([]);
    expect(intel.insufficientEvidence.length).toBe(1);
  });

  it("no shortages means no action", () => {
    expect(buildPickingShortagesIntelligence({ totalLines: 0, topProducts: [] }).noActionIndicated).toBe(true);
  });
});

describe("5. delivery exceptions", () => {
  it("escalates whole-delivery rejections and repeat customers", () => {
    const intel = buildDeliveryExceptionsIntelligence({ totalExceptions: 7, fullyRejected: 3, partiallyRejected: 4, rowsExamined: 7, customers: [{ customerName: "Baobab", count: 3 }, { customerName: "OK Mart", count: 1 }] });
    expect(intel.findings.map((f) => f.key)).toEqual(["fully-rejected", "customer-rejections:Baobab"]);
    expect(intel.findings[0].priority).toBe("CRITICAL");
    expect(intel.findings[0].responsibleFunction).toBe("QUALITY_CONTROL");
    expect(intel.findings[1].responsibleFunction).toBe("SALES");
    expect(intel.findings[1].tag).toBe("customer");
  });

  it("discloses when customer counts rest on a subset of rows", () => {
    const intel = buildDeliveryExceptionsIntelligence({ totalExceptions: 300, fullyRejected: 0, partiallyRejected: 300, rowsExamined: 200, customers: [{ customerName: "Baobab", count: 5 }] });
    expect(intel.findings[0].evidence.some((e) => e.label === "Based on" && e.value === "200 of 300 rows")).toBe(true);
  });

  it("no exceptions means no action", () => {
    expect(buildDeliveryExceptionsIntelligence({ totalExceptions: 0, fullyRejected: 0, partiallyRejected: 0, rowsExamined: 0, customers: [] }).noActionIndicated).toBe(true);
  });
});

describe("6. quotations performance", () => {
  const q = (over: Partial<QuotationFacts> = {}): QuotationFacts => ({ periodLabel: "2026-11-01 to 2026-11-24", issuedInPeriod: 40, acceptedInPeriod: 24, expiredInPeriod: 4, acceptanceRatePercent: 60, acceptedInCohort: 24, convertedInCohort: 22, conversionRatePercent: 91.7, dueForFollowUpNow: 0, awaitingResponseNow: 6, ...over });

  it("flags low acceptance, high expiry and low conversion for Sales", () => {
    const intel = buildQuotationsIntelligence(q({ acceptanceRatePercent: 20, acceptedInPeriod: 8, expiredInPeriod: 14, conversionRatePercent: 50, convertedInCohort: 12 }));
    expect(intel.findings.map((f) => f.key).sort()).toEqual(["acceptance-low", "conversion-low", "expired-share-high"]);
    expect(intel.findings.every((f) => f.responsibleFunction === "SALES")).toBe(true);
  });

  it("flags quotations due for follow-up even when the sample is small", () => {
    const intel = buildQuotationsIntelligence(q({ issuedInPeriod: 2, acceptanceRatePercent: 0, acceptedInCohort: 0, conversionRatePercent: null, dueForFollowUpNow: 3 }));
    expect(intel.findings.map((f) => f.key)).toEqual(["followups-due"]);
    expect(intel.insufficientEvidence.length).toBe(2);
  });

  it("does not act on a rate from fewer than the minimum records", () => {
    const intel = buildQuotationsIntelligence(q({ issuedInPeriod: 3, acceptanceRatePercent: 0, expiredInPeriod: 3, acceptedInCohort: 1, conversionRatePercent: 0 }));
    expect(intel.findings).toEqual([]);
    expect(intel.noActionIndicated).toBe(false);
  });

  it("indicates no action when healthy", () => {
    expect(buildQuotationsIntelligence(q()).noActionIndicated).toBe(true);
  });
});

describe("7. lost sales", () => {
  const ls = (over: Partial<LostSalesFacts> = {}): LostSalesFacts => ({
    periodLabel: "all dates",
    unfulfilledDemandCount: 12,
    demandsWithoutPrice: 0,
    topUnavailableProducts: [{ description: "Baby Marrow", totalQuantity: "180" }],
    topShortageCustomers: [{ customerName: "Baobab", demandCount: 4 }],
    claimCount: 8,
    openClaimCount: 6,
    underDisputeByCurrency: [{ currency: "USD", value: "135.5" }, { currency: "ZWG", value: "900" }],
    rejectedAfterDeliveryByCurrency: [{ currency: "USD", value: "200" }],
    linesWithoutPrice: 0,
    reasons: [
      { reasonCategory: "QUALITY_ISSUE", label: "Poor Quality Product", claimCount: 5, claimSharePercent: 62.5, openClaimCount: 4 },
      { reasonCategory: "SHORT_DELIVERY", label: "Short Delivered", claimCount: 3, claimSharePercent: 37.5, openClaimCount: 2 },
    ],
    ...over,
  });

  it("builds findings from the unified figures and keeps currencies apart", () => {
    const intel = buildLostSalesIntelligence(ls());
    const keys = intel.findings.map((f) => f.key);
    expect(keys).toContain("top-unavailable:Baby Marrow");
    expect(keys).toContain("customer-shortage:Baobab");
    expect(keys).toContain("under-dispute");
    expect(keys).toContain("claim-reason:QUALITY_ISSUE");
    const dispute = intel.findings.find((f) => f.key === "under-dispute")!;
    expect(dispute.evidence.map((e) => e.label)).toEqual(expect.arrayContaining(["Under dispute (USD)", "Under dispute (ZWG)"]));
    expect(dispute.evidence.filter((e) => e.label.startsWith("Under dispute")).length).toBe(2);
    expect(dispute.priority).toBe("HIGH");
  });

  it("assigns a claim reason to the function that can fix it", () => {
    const intel = buildLostSalesIntelligence(ls());
    expect(intel.findings.find((f) => f.key === "claim-reason:QUALITY_ISSUE")!.responsibleFunction).toBe("QUALITY_CONTROL");
  });

  it("does not call one reason a pattern on too few claims", () => {
    const intel = buildLostSalesIntelligence(ls({ claimCount: 3, openClaimCount: 0, underDisputeByCurrency: [] }));
    expect(intel.findings.find((f) => f.key.startsWith("claim-reason"))).toBeUndefined();
    expect(intel.insufficientEvidence.some((n) => n.startsWith("Claim reasons"))).toBe(true);
  });

  it("reports records that cannot be valued rather than hiding them", () => {
    const intel = buildLostSalesIntelligence(ls({ demandsWithoutPrice: 3, linesWithoutPrice: 2 }));
    const f = intel.findings.find((x) => x.key === "unpriced-records")!;
    expect(f.priority).toBe("LOW");
    expect(f.evidence.map((e) => e.value)).toEqual(["3", "2"]);
  });

  it("an open claim is under dispute, never described as a loss", () => {
    const intel = buildLostSalesIntelligence(ls());
    const dispute = intel.findings.find((f) => f.key === "under-dispute")!;
    expect(dispute.finding).not.toMatch(/lost sales? of/i);
    expect(dispute.finding).toContain("neither lost nor recovered");
  });

  it("indicates no action when there is nothing recorded", () => {
    expect(buildLostSalesIntelligence(ls({ unfulfilledDemandCount: 0, claimCount: 0, topUnavailableProducts: [], topShortageCustomers: [], underDisputeByCurrency: [], openClaimCount: 0, reasons: [] })).noActionIndicated).toBe(true);
  });
});

describe("8. invoice claims and exposure", () => {
  const c = (over: Partial<ClaimsExposureFacts> = {}): ClaimsExposureFacts => ({
    claimCount: 10,
    openClaimCount: 4,
    underDisputeByCurrency: [{ currency: "USD", value: "55" }],
    approvedNotYetCreditedByCurrency: [{ currency: "USD", value: "20" }],
    unclassifiedConcludedByCurrency: [],
    claimsWhereCreditExceedsDisputed: 0,
    creditNotesPendingCount: 0,
    returnsAwaitingResolution: 0,
    averageResolutionDays: 5,
    repeatComplaintCustomers: [],
    reasons: [],
    ...over,
  });

  it("covers pending credit notes, over-crediting, unclassified conclusions, returns, slow resolution and repeat customers", () => {
    const intel = buildInvoiceClaimsIntelligence(
      c({
        creditNotesPendingCount: 2,
        claimsWhereCreditExceedsDisputed: 1,
        unclassifiedConcludedByCurrency: [{ currency: "ZWG", value: "300" }],
        returnsAwaitingResolution: 3,
        averageResolutionDays: 21,
        repeatComplaintCustomers: [{ customerName: "Baobab", claimCount: 4 }, { customerName: "Small Shop", claimCount: 1 }],
      })
    );
    expect(intel.findings.map((f) => f.key).sort()).toEqual(["concluded-unclassified", "credit-exceeds-disputed", "credit-notes-pending", "customer-claims:Baobab", "returns-awaiting", "slow-resolution"]);
    const credit = intel.findings.find((f) => f.key === "credit-notes-pending")!;
    expect(credit.responsibleFunction).toBe("FINANCE");
    expect(credit.evidence.some((e) => e.label.includes("USD"))).toBe(true);
    expect(intel.findings.find((f) => f.key === "returns-awaiting")!.responsibleFunction).toBe("WAREHOUSE");
  });

  it("does not call average resolution slow on a tiny sample", () => {
    const intel = buildInvoiceClaimsIntelligence(c({ claimCount: 3, averageResolutionDays: 40 }));
    expect(intel.findings.find((f) => f.key === "slow-resolution")).toBeUndefined();
  });

  it("indicates no action when nothing needs attention", () => {
    expect(buildInvoiceClaimsIntelligence(c()).noActionIndicated).toBe(true);
    expect(buildInvoiceClaimsIntelligence(c({ claimCount: 0 })).noActionIndicated).toBe(true);
  });
});

describe("9. communication failures", () => {
  it("escalates failed messages and customers who were not told", () => {
    const intel = buildCommunicationFailuresIntelligence({ failedCount: 12, ordersWithFailedOutbound: 7, deliveryExceptionsWithNoSuccessfulNotification: 2, topChannel: { key: "WHATSAPP", count: 9 }, topType: { key: "ORDER_CONFIRMATION", count: 8 }, repeatedlyRetried: 4 });
    expect(intel.findings.map((f) => f.key).sort()).toEqual(["exceptions-not-notified", "failed-messages"]);
    const failed = intel.findings.find((f) => f.key === "failed-messages")!;
    expect(failed.priority).toBe("HIGH");
    expect(failed.recommendedAction).toContain("WHATSAPP");
    expect(failed.evidence.some((e) => e.label.startsWith("Messages already retried"))).toBe(true);
    expect(intel.findings.find((f) => f.key === "exceptions-not-notified")!.responsibleFunction).toBe("SALES");
  });

  it("a few failures with no exceptions is medium", () => {
    const intel = buildCommunicationFailuresIntelligence({ failedCount: 2, ordersWithFailedOutbound: 2, deliveryExceptionsWithNoSuccessfulNotification: 0, topChannel: { key: "EMAIL", count: 2 }, topType: null, repeatedlyRetried: 0 });
    expect(intel.findings[0].priority).toBe("MEDIUM");
    expect(intel.findings[0].recommendedAction).not.toContain("EMAIL");
  });

  it("nothing failed means no action", () => {
    expect(buildCommunicationFailuresIntelligence({ failedCount: 0, ordersWithFailedOutbound: 0, deliveryExceptionsWithNoSuccessfulNotification: 0, topChannel: null, topType: null, repeatedlyRetried: 0 }).noActionIndicated).toBe(true);
  });
});

describe("one topic across reports is identical, so the Action Centre can show it once", () => {
  it("failed-messages raised from the operational summary and the communication report share a topic and figures", () => {
    const a = buildOperationalSummaryIntelligence(operational({ failedOutbound: 5, ordersWithFailedOutbound: 3, deliveryExceptionsWithNoSuccessfulNotification: 1 })).findings.find((f) => f.key === "failed-messages")!;
    const b = buildCommunicationFailuresIntelligence({ failedCount: 5, ordersWithFailedOutbound: 3, deliveryExceptionsWithNoSuccessfulNotification: 1, topChannel: null, topType: null, repeatedlyRetried: 0 }).findings.find((f) => f.key === "failed-messages")!;
    expect(a.topic).toBe(b.topic);
    expect(a.finding).toBe(b.finding);
    expect(a.priority).toBe(b.priority);
  });

  it("claim reasons are identical whichever report raises them", () => {
    const reasons = [{ reasonCategory: "PRICING_DISPUTE", label: "Price Claim", claimCount: 5, claimSharePercent: 50, openClaimCount: 1 }];
    const a = reasonFindings("lost-sales", reasons, 10).findings[0];
    const b = reasonFindings("invoice-claims-exposure", reasons, 10).findings[0];
    expect(a.topic).toBe(b.topic);
    expect(a.responsibleFunction).toBe("SALES");
    expect(a.finding).toBe(b.finding);
  });
});
