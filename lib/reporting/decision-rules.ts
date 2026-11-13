/**
 * Milestone 15 (Decision Intelligence). The deterministic, explainable
 * decision-recommendation rule catalogue (spec section 4).
 *
 * Every rule here is a pure function: it takes already-fetched, plain
 * (no Prisma/Decimal types) data and returns zero or more
 * RecommendationCandidate values. No rule queries the database, calls
 * an LLM, or invents a number not present in its input -- the entire
 * catalogue is unit-testable with hand-built fixtures and no mocking.
 * lib/reporting/decision-intelligence-queries.ts is the only module
 * that (a) fetches each rule's input by composing the EXISTING M12-M14
 * query functions named in each rule's own comment below, never
 * re-deriving their calculations, and (b) persists this module's output.
 *
 * Every rule explicitly documents: what evidence it reads, the
 * priority-classification logic, and the confidence-classification
 * logic and its basis -- spec section 4's own requirement. A rule that
 * cannot find enough data to support a classification returns
 * confidence INSUFFICIENT_DATA rather than guessing, and the
 * recommendation is never dropped silently in that case (spec section
 * 17: "do not fabricate recommendations not supported by real data --
 * omit the recommendation entirely, or clearly label it as insufficient
 * data" -- this catalogue always takes the label, never the omission,
 * because an insufficient-data case is itself useful executive
 * information, e.g. "this product has no SAP master record").
 *
 * Money inputs here are already-converted plain `number`s (the same
 * boundary decision lib/reporting/product-segmentation.ts's own
 * Rankable.value makes) -- fine for threshold comparisons and ranking,
 * never used to recompute an authoritative SAP figure. Every
 * authoritative amount shown to a user is the original formatted
 * decimal string, carried through unchanged into `evidence.metrics`.
 */
import { buildDedupeKey, classifyDeclinePriority, classifyRepeatedCountPriority, percentDecline } from "@/lib/reporting/decision-priority";
import type { DecisionEvidence, EvidenceSourceRecord, RecommendationCandidate } from "@/lib/reporting/decision-types";

type Period = { from: string; to: string };

function candidate(input: {
  ruleId: string;
  ruleVersion: number;
  primaryEntityKey: string;
  decisionCategory: RecommendationCandidate["decisionCategory"];
  priority: RecommendationCandidate["priority"];
  confidence: RecommendationCandidate["confidence"];
  title: string;
  explanation: string;
  metrics: DecisionEvidence["metrics"];
  sourceRecords: EvidenceSourceRecord[];
  confidenceBasis: string;
  recommendedNextAction: string;
  period: Period;
  customerId?: string | null;
  productId?: string | null;
  sapItemCode?: string | null;
  salespersonId?: string | null;
  quotationId?: string | null;
  customerOrderId?: string | null;
  currencyCode?: string | null;
}): RecommendationCandidate {
  return {
    dedupeKey: buildDedupeKey(input.ruleId, input.primaryEntityKey),
    ruleId: input.ruleId,
    ruleVersion: input.ruleVersion,
    decisionCategory: input.decisionCategory,
    priority: input.priority,
    confidence: input.confidence,
    title: input.title,
    explanation: input.explanation,
    evidence: { metrics: input.metrics, sourceRecords: input.sourceRecords, confidenceBasis: input.confidenceBasis },
    recommendedNextAction: input.recommendedNextAction,
    customerId: input.customerId ?? null,
    productId: input.productId ?? null,
    sapItemCode: input.sapItemCode ?? null,
    salespersonId: input.salespersonId ?? null,
    quotationId: input.quotationId ?? null,
    customerOrderId: input.customerOrderId ?? null,
    currencyCode: input.currencyCode ?? null,
    reportingPeriodFrom: input.period.from,
    reportingPeriodTo: input.period.to,
  };
}

// ---------------------------------------------------------------------------
// CUSTOMER category (reuses Milestone 13's customer-revenue/claims/
// quotations/recency source data).
// ---------------------------------------------------------------------------

/** A documented materiality floor (same currency units as the figure itself -- never converted). Below this, a decline is real but too small a base to classify with HIGH confidence. */
const CUSTOMER_REVENUE_MATERIALITY_FLOOR = 500;
const CUSTOMER_DECLINE_FIRE_THRESHOLD_PERCENT = 40;

export type CustomerRevenueDeclineInput = {
  customerId: string;
  customerName: string;
  currencyCode: string;
  currentRevenue: number;
  currentRevenueDisplay: string;
  previousRevenue: number;
  previousRevenueDisplay: string;
};

/**
 * CUSTOMER_DECLINING_VALUE v1. Fires once per (customer, currency) when
 * invoiced revenue fell by at least 40% versus the immediately
 * preceding period of equal length (lib/reporting/product-segmentation.
 * ts's computePreviousPeriod). Never fires when previousRevenue is 0 --
 * a customer with no prior-period revenue has no baseline to "decline"
 * from (that is new-customer activity, out of scope for this rule, and
 * never mislabelled as a decline). Never combines currencies (spec
 * section 7.2): a customer invoiced in two currencies produces up to
 * two separate candidates, one per currency.
 *
 * Priority: >=75% decline -> HIGH; 40-74.9% -> MEDIUM. Never CRITICAL
 * -- see decision-priority.ts's classifyDeclinePriority for why.
 * Confidence: HIGH when the prior-period revenue clears the documented
 * materiality floor (CUSTOMER_REVENUE_MATERIALITY_FLOOR); MEDIUM
 * otherwise (the decline is real, but calculated from a small base, so
 * the percentage is more sensitive to a single order).
 */
export function evaluateCustomerDecliningValue(input: CustomerRevenueDeclineInput, period: Period): RecommendationCandidate | null {
  const decline = percentDecline(input.currentRevenue, input.previousRevenue);
  if (decline === null || decline < CUSTOMER_DECLINE_FIRE_THRESHOLD_PERCENT) return null;

  const confidence = input.previousRevenue >= CUSTOMER_REVENUE_MATERIALITY_FLOOR ? "HIGH" : "MEDIUM";
  return candidate({
    ruleId: "CUSTOMER_DECLINING_VALUE",
    ruleVersion: 1,
    primaryEntityKey: `${input.customerId}:${input.currencyCode}`,
    decisionCategory: "CUSTOMER",
    priority: classifyDeclinePriority(decline),
    confidence,
    title: `Invoiced revenue from ${input.customerName} fell ${decline}% (${input.currencyCode})`,
    explanation: `${input.customerName}'s invoiced revenue in ${input.currencyCode} for the current period (${input.currentRevenueDisplay}) is ${decline}% below the immediately preceding period of equal length (${input.previousRevenueDisplay}).`,
    metrics: { currentRevenue: input.currentRevenueDisplay, previousRevenue: input.previousRevenueDisplay, declinePercent: decline },
    sourceRecords: [{ type: "Customer", id: input.customerId, label: input.customerName, href: `/reports/customers/${input.customerId}` }],
    confidenceBasis:
      confidence === "HIGH"
        ? `Prior-period revenue (${input.previousRevenueDisplay}) clears the ${CUSTOMER_REVENUE_MATERIALITY_FLOOR} ${input.currencyCode} materiality floor.`
        : `Prior-period revenue (${input.previousRevenueDisplay}) is below the ${CUSTOMER_REVENUE_MATERIALITY_FLOOR} ${input.currencyCode} materiality floor, so this percentage is more sensitive to a single order.`,
    recommendedNextAction: "Review this customer's recent order and quotation history for a cause before any commercial follow-up.",
    period,
    customerId: input.customerId,
    currencyCode: input.currencyCode,
  });
}

export type CustomerRepeatedClaimsReturnsInput = {
  customerId: string;
  customerName: string;
  claimCount: number;
  returnCount: number;
};

/**
 * CUSTOMER_REPEATED_CLAIMS_RETURNS v1. Fires when a customer has 2 or
 * more invoice claims OR 2 or more recorded returns in the period --
 * the same structural "repeated signal" cutoff of 2 Milestone 14 used
 * for its own product-level claims/returns dimension (never assumes a
 * single claim means anything; a pattern needs at least a second data
 * point). Deliberately neutral: never labels the customer "at risk" or
 * "problematic" -- only states the observed count and recommends a
 * human review, per spec section 3.4's "never invent churn" rule.
 *
 * Priority: >=4 of either -> HIGH; 2-3 -> MEDIUM. Confidence: HIGH --
 * both counts are directly observed, not estimated.
 */
export function evaluateCustomerRepeatedClaimsReturns(input: CustomerRepeatedClaimsReturnsInput, period: Period): RecommendationCandidate | null {
  if (input.claimCount < 2 && input.returnCount < 2) return null;
  const maxCount = Math.max(input.claimCount, input.returnCount);
  return candidate({
    ruleId: "CUSTOMER_REPEATED_CLAIMS_RETURNS",
    ruleVersion: 1,
    primaryEntityKey: input.customerId,
    decisionCategory: "CUSTOMER",
    priority: classifyRepeatedCountPriority(maxCount, 4),
    confidence: "HIGH",
    title: `Repeated claims/returns recorded for ${input.customerName}`,
    explanation: `${input.customerName} has ${input.claimCount} invoice claim(s) and ${input.returnCount} return(s) recorded in the selected period.`,
    metrics: { claimCount: input.claimCount, returnCount: input.returnCount },
    sourceRecords: [{ type: "Customer", id: input.customerId, label: input.customerName, href: `/reports/customers/${input.customerId}` }],
    confidenceBasis: "Both counts come directly from recorded InvoiceClaim and ClaimReturn rows, not an estimate.",
    recommendedNextAction: "Review this customer's claims and returns history for a recurring cause before assuming a quality or service issue.",
    period,
    customerId: input.customerId,
  });
}

export type CustomerUnresolvedQuotationsInput = {
  customerId: string;
  customerName: string;
  unresolvedCount: number;
};

/**
 * CUSTOMER_UNRESOLVED_QUOTATIONS v1. Fires when a customer has 1 or
 * more quotations in ISSUED status whose validUntil date has already
 * passed as of the as-of-date (Milestone 13's resolveAsOfDate), without
 * having been accepted, rejected, expired, or cancelled -- a single
 * stuck quotation is already a real, actionable commercial fact, so
 * unlike the count-based rules above this one fires at count >= 1.
 *
 * Priority: >=3 -> HIGH; 1-2 -> MEDIUM. Confidence: HIGH -- the status
 * and the validUntil date are both directly recorded fields, no
 * estimation involved.
 */
export function evaluateCustomerUnresolvedQuotations(input: CustomerUnresolvedQuotationsInput, period: Period): RecommendationCandidate | null {
  if (input.unresolvedCount < 1) return null;
  return candidate({
    ruleId: "CUSTOMER_UNRESOLVED_QUOTATIONS",
    ruleVersion: 1,
    primaryEntityKey: input.customerId,
    decisionCategory: "CUSTOMER",
    priority: classifyRepeatedCountPriority(input.unresolvedCount, 3),
    confidence: "HIGH",
    title: `${input.unresolvedCount} unresolved quotation(s) for ${input.customerName}`,
    explanation: `${input.customerName} has ${input.unresolvedCount} quotation(s) past their validity date with no acceptance, rejection, expiry, or cancellation recorded.`,
    metrics: { unresolvedCount: input.unresolvedCount },
    sourceRecords: [{ type: "Customer", id: input.customerId, label: input.customerName, href: `/reports/customers/${input.customerId}` }],
    confidenceBasis: "Quotation status and validUntil are both directly recorded fields.",
    recommendedNextAction: "Follow up with the customer or formally close out these quotations (accept, reject, or mark expired).",
    period,
    customerId: input.customerId,
  });
}

export type CustomerInsufficientRecentActivityInput = {
  customerId: string;
  customerName: string;
  daysSinceLastOrder: number | null;
  hasAnyOrderHistory: boolean;
  recencyThresholdDays: number;
};

/**
 * CUSTOMER_INSUFFICIENT_RECENT_ACTIVITY v1. Purely informational --
 * ALWAYS priority INFORMATIONAL, never a churn/risk label (spec section
 * 3.4: "never label a customer as lost/inactive without an explicit,
 * documented rule" -- this rule's explicit, documented position is
 * that recency alone is never sufficient grounds for such a label, so
 * it deliberately stops short of one). Fires when the customer's last
 * qualifying invoice (Milestone 13's recency calc) is more than
 * `recencyThresholdDays` before the as-of-date, or when there is no
 * order history at all.
 *
 * Confidence: INSUFFICIENT_DATA when the customer has no order history
 * to measure recency against at all (there is nothing to classify);
 * HIGH when a last-order date exists (a directly observed fact).
 */
export function evaluateCustomerInsufficientRecentActivity(input: CustomerInsufficientRecentActivityInput, period: Period): RecommendationCandidate | null {
  if (!input.hasAnyOrderHistory) {
    return candidate({
      ruleId: "CUSTOMER_INSUFFICIENT_RECENT_ACTIVITY",
      ruleVersion: 1,
      primaryEntityKey: input.customerId,
      decisionCategory: "CUSTOMER",
      priority: "INFORMATIONAL",
      confidence: "INSUFFICIENT_DATA",
      title: `No purchase history on record for ${input.customerName}`,
      explanation: `${input.customerName} has no qualifying invoice on record as of the selected date. This is an observation, not a churn or inactivity classification.`,
      metrics: {},
      sourceRecords: [{ type: "Customer", id: input.customerId, label: input.customerName, href: `/reports/customers/${input.customerId}` }],
      confidenceBasis: "There is no order history at all to measure recency against.",
      recommendedNextAction: "No action implied by this observation alone -- review the customer's onboarding status if this is unexpected.",
      period,
      customerId: input.customerId,
    });
  }
  if (input.daysSinceLastOrder === null || input.daysSinceLastOrder < input.recencyThresholdDays) return null;
  return candidate({
    ruleId: "CUSTOMER_INSUFFICIENT_RECENT_ACTIVITY",
    ruleVersion: 1,
    primaryEntityKey: input.customerId,
    decisionCategory: "CUSTOMER",
    priority: "INFORMATIONAL",
    confidence: "HIGH",
    title: `No recent purchasing activity recorded for ${input.customerName}`,
    explanation: `${input.customerName}'s last qualifying invoice was ${input.daysSinceLastOrder} day(s) before the selected as-of date (threshold: ${input.recencyThresholdDays} days). This is an observation, not a churn or inactivity classification.`,
    metrics: { daysSinceLastOrder: input.daysSinceLastOrder, recencyThresholdDays: input.recencyThresholdDays },
    sourceRecords: [{ type: "Customer", id: input.customerId, label: input.customerName, href: `/reports/customers/${input.customerId}` }],
    confidenceBasis: "The last-qualifying-invoice date is a directly recorded field.",
    recommendedNextAction: "No action implied by this observation alone -- a human review may confirm whether follow-up is warranted.",
    period,
    customerId: input.customerId,
  });
}

// ---------------------------------------------------------------------------
// PRODUCT category (reuses Milestone 14's product-revenue/claims-returns/
// lost-sales/delivery-rejection/master-data source data).
// ---------------------------------------------------------------------------

const PRODUCT_REVENUE_MATERIALITY_FLOOR = 300;
const PRODUCT_DECLINE_FIRE_THRESHOLD_PERCENT = 40;

export type ProductActivityDeclineInput = {
  sapItemCode: string;
  productId: string | null;
  itemName: string;
  currencyCode: string;
  currentRevenue: number;
  currentRevenueDisplay: string;
  previousRevenue: number;
  previousRevenueDisplay: string;
};

/**
 * PRODUCT_DECLINING_ACTIVITY v1. Mirrors CUSTOMER_DECLINING_VALUE
 * exactly but keyed by (sapItemCode, currency) rather than customer --
 * identity throughout is the SAP item code (Milestone 14's own
 * identity rule), never Product.id, since an item with no master
 * record must still be representable. Never combines currencies.
 */
export function evaluateProductDecliningActivity(input: ProductActivityDeclineInput, period: Period): RecommendationCandidate | null {
  const decline = percentDecline(input.currentRevenue, input.previousRevenue);
  if (decline === null || decline < PRODUCT_DECLINE_FIRE_THRESHOLD_PERCENT) return null;

  const confidence = input.previousRevenue >= PRODUCT_REVENUE_MATERIALITY_FLOOR ? "HIGH" : "MEDIUM";
  return candidate({
    ruleId: "PRODUCT_DECLINING_ACTIVITY",
    ruleVersion: 1,
    primaryEntityKey: `${input.sapItemCode}:${input.currencyCode}`,
    decisionCategory: "PRODUCT",
    priority: classifyDeclinePriority(decline),
    confidence,
    title: `Invoiced activity for ${input.itemName} fell ${decline}% (${input.currencyCode})`,
    explanation: `${input.itemName} (${input.sapItemCode})'s invoiced SAP line value in ${input.currencyCode} for the current period (${input.currentRevenueDisplay}) is ${decline}% below the immediately preceding period of equal length (${input.previousRevenueDisplay}).`,
    metrics: { currentRevenue: input.currentRevenueDisplay, previousRevenue: input.previousRevenueDisplay, declinePercent: decline },
    sourceRecords: [{ type: "Product", id: input.sapItemCode, label: input.itemName, href: `/reports/products/${encodeURIComponent(input.sapItemCode)}` }],
    confidenceBasis:
      confidence === "HIGH"
        ? `Prior-period value (${input.previousRevenueDisplay}) clears the ${PRODUCT_REVENUE_MATERIALITY_FLOOR} ${input.currencyCode} materiality floor.`
        : `Prior-period value (${input.previousRevenueDisplay}) is below the ${PRODUCT_REVENUE_MATERIALITY_FLOOR} ${input.currencyCode} materiality floor.`,
    recommendedNextAction: "Review this product's recent order and lost-sales activity for a cause before any demand-planning decision.",
    period,
    productId: input.productId,
    sapItemCode: input.sapItemCode,
    currencyCode: input.currencyCode,
  });
}

export type ProductRepeatedClaimsReturnsInput = {
  sapItemCode: string;
  productId: string | null;
  itemName: string;
  claimCount: number;
  returnCount: number;
};

/**
 * PRODUCT_REPEATED_CLAIMS_RETURNS v1. Same "repeated signal, cutoff of
 * 2" shape as the customer-level rule, grain switched to product. Never
 * assumes returns=defective or claims=quality issue (spec section 3.5).
 */
export function evaluateProductRepeatedClaimsReturns(input: ProductRepeatedClaimsReturnsInput, period: Period): RecommendationCandidate | null {
  if (input.claimCount < 2 && input.returnCount < 2) return null;
  const maxCount = Math.max(input.claimCount, input.returnCount);
  return candidate({
    ruleId: "PRODUCT_REPEATED_CLAIMS_RETURNS",
    ruleVersion: 1,
    primaryEntityKey: input.sapItemCode,
    decisionCategory: "PRODUCT",
    priority: classifyRepeatedCountPriority(maxCount, 4),
    confidence: "HIGH",
    title: `Repeated claims/returns recorded for ${input.itemName}`,
    explanation: `${input.itemName} (${input.sapItemCode}) has ${input.claimCount} invoice claim line(s) and ${input.returnCount} return(s) recorded in the selected period. This does not by itself indicate a product-quality issue.`,
    metrics: { claimCount: input.claimCount, returnCount: input.returnCount },
    sourceRecords: [{ type: "Product", id: input.sapItemCode, label: input.itemName, href: `/reports/products/${encodeURIComponent(input.sapItemCode)}` }],
    confidenceBasis: "Both counts come directly from recorded claim-line and return rows.",
    recommendedNextAction: "Review the claim/return reasons recorded for this product before concluding a quality cause.",
    period,
    productId: input.productId,
    sapItemCode: input.sapItemCode,
  });
}

export type ProductLostDemandInput = {
  sapItemCode: string;
  productId: string | null;
  itemName: string;
  confirmedLostSaleCount: number;
  confirmedLostQuantity: number;
  confirmedLostQuantityDisplay: string;
};

const PRODUCT_LOST_QUANTITY_FLOOR = 10;
const PRODUCT_LOST_QUANTITY_HIGH = 50;

/**
 * PRODUCT_SIGNIFICANT_LOST_DEMAND v1. Fires per product when confirmed
 * lost-sale quantity (lib/reporting/product-demand-queries.ts's
 * existing getProductLostSalesRanking -- Milestone 2's confirmed
 * LostSaleRecord figures, never the broader "unfulfilled demand"
 * count, and never an estimated monetary value: this milestone's own
 * product-level ranking has no estimated-value-by-currency figure to
 * reuse, and inventing a new one here would duplicate/extend a M12-M14
 * calculation rather than reuse it, so this rule is deliberately
 * quantity-only) meets a documented floor.
 *
 * Priority: >=50 confirmed lost units -> HIGH; 10-49 -> MEDIUM.
 * Confidence: HIGH -- a directly counted LostSaleRecord figure, not an
 * estimate.
 */
export function evaluateProductSignificantLostDemand(input: ProductLostDemandInput, period: Period): RecommendationCandidate | null {
  if (input.confirmedLostQuantity < PRODUCT_LOST_QUANTITY_FLOOR) return null;

  return candidate({
    ruleId: "PRODUCT_SIGNIFICANT_LOST_DEMAND",
    ruleVersion: 1,
    primaryEntityKey: input.sapItemCode,
    decisionCategory: "PRODUCT",
    priority: input.confirmedLostQuantity >= PRODUCT_LOST_QUANTITY_HIGH ? "HIGH" : "MEDIUM",
    confidence: "HIGH",
    title: `Significant lost demand recorded for ${input.itemName}`,
    explanation: `${input.itemName} (${input.sapItemCode}) has ${input.confirmedLostQuantityDisplay} confirmed lost-sale unit(s) across ${input.confirmedLostSaleCount} confirmed lost-sale record(s) in the selected period.`,
    metrics: { confirmedLostSaleCount: input.confirmedLostSaleCount, confirmedLostQuantity: input.confirmedLostQuantityDisplay },
    sourceRecords: [{ type: "Product", id: input.sapItemCode, label: input.itemName, href: `/reports/products/${encodeURIComponent(input.sapItemCode)}` }],
    confidenceBasis: "Confirmed lost-sale quantity is a directly counted LostSaleRecord figure, not an estimate.",
    recommendedNextAction: "Review stocking/substitution decisions for this product against the recorded lost-sale reasons.",
    period,
    productId: input.productId,
    sapItemCode: input.sapItemCode,
  });
}

export type ProductDeliveryRejectionsInput = {
  sapItemCode: string;
  productId: string | null;
  itemName: string;
  rejectionEventCount: number;
};

/**
 * PRODUCT_DELIVERY_REJECTIONS v1. Fires at the same "cutoff of 2"
 * repeated-signal floor. Explicitly never implies a product-quality
 * issue (spec section 3.7: "delivery failure is never automatically
 * equated with a product-quality issue") -- the explanation and next
 * action both say so directly.
 */
export function evaluateProductDeliveryRejections(input: ProductDeliveryRejectionsInput, period: Period): RecommendationCandidate | null {
  if (input.rejectionEventCount < 2) return null;
  return candidate({
    ruleId: "PRODUCT_DELIVERY_REJECTIONS",
    ruleVersion: 1,
    primaryEntityKey: input.sapItemCode,
    decisionCategory: "PRODUCT",
    priority: classifyRepeatedCountPriority(input.rejectionEventCount, 5),
    confidence: "HIGH",
    title: `Repeated delivery rejections recorded for ${input.itemName}`,
    explanation: `${input.itemName} (${input.sapItemCode}) has ${input.rejectionEventCount} delivery-line rejection event(s) recorded in the selected period. This does not by itself indicate a product-quality issue.`,
    metrics: { rejectionEventCount: input.rejectionEventCount },
    sourceRecords: [{ type: "Product", id: input.sapItemCode, label: input.itemName, href: `/reports/products/${encodeURIComponent(input.sapItemCode)}` }],
    confidenceBasis: "Directly counted from recorded DeliveryLine rejection rows.",
    recommendedNextAction: "Review delivery/fulfilment handling (picking, dispatch, transit) for this product rather than assuming a quality cause.",
    period,
    productId: input.productId,
    sapItemCode: input.sapItemCode,
  });
}

export type ProductInsufficientMasterDataInput = {
  sapItemCode: string;
  productId: string | null;
  itemNameOrFallback: string;
  missingFieldLabels: string[];
};

/**
 * PRODUCT_INSUFFICIENT_MASTER_DATA v1. Always INFORMATIONAL/
 * INSUFFICIENT_DATA by definition -- reuses Milestone 14's own data-
 * quality dimension (products with no master record, or a master
 * record missing SAP item-master-extension fields) rather than
 * re-deriving it.
 */
export function evaluateProductInsufficientMasterData(input: ProductInsufficientMasterDataInput, period: Period): RecommendationCandidate | null {
  if (input.missingFieldLabels.length === 0) return null;
  return candidate({
    ruleId: "PRODUCT_INSUFFICIENT_MASTER_DATA",
    ruleVersion: 1,
    primaryEntityKey: input.sapItemCode,
    decisionCategory: "PRODUCT",
    priority: "INFORMATIONAL",
    confidence: "INSUFFICIENT_DATA",
    title: `Missing SAP master data for ${input.itemNameOrFallback}`,
    explanation: `${input.itemNameOrFallback} (${input.sapItemCode}) is missing: ${input.missingFieldLabels.join(", ")}.`,
    metrics: { missingFields: input.missingFieldLabels.join(", ") },
    sourceRecords: [{ type: "Product", id: input.sapItemCode, label: input.itemNameOrFallback, href: `/reports/products/${encodeURIComponent(input.sapItemCode)}` }],
    confidenceBasis: "By definition: the underlying master data this recommendation is about is the data that is missing.",
    recommendedNextAction: "Import or correct this item's master data via the item-master-extension import.",
    period,
    productId: input.productId,
    sapItemCode: input.sapItemCode,
  });
}

// ---------------------------------------------------------------------------
// COMMERCIAL_EXPOSURE category (reuses Milestone 12/13's claim financial
// exposure-by-currency computation and the CreditNote model directly --
// kept structurally separate, never added together, per spec section 3.6).
// ---------------------------------------------------------------------------

const CLAIM_EXPOSURE_MEDIUM_FLOOR = 500;
const CLAIM_EXPOSURE_HIGH_FLOOR = 1000;
const CLAIM_EXPOSURE_CRITICAL_FLOOR = 5000;

export type CommercialClaimExposureInput = {
  currencyCode: string;
  claimCount: number;
  potentialCreditExposureDisplay: string;
  approvedCreditExposureDisplay: string;
  actualSapCreditedAmountDisplay: string;
  unresolvedExposure: number;
  unresolvedExposureDisplay: string;
};

/**
 * COMMERCIAL_CLAIM_EXPOSURE_BY_CURRENCY v1. One candidate per currency
 * bucket from lib/invoice-claims/financial.ts's computeExposureByCurrency
 * -- never re-derived. "Unresolved exposure" = potential minus actual
 * credited (never claim count + credit-note amount, spec section 3.6's
 * explicit anti-double-counting rule). This is the one rule in this
 * catalogue allowed to reach CRITICAL: a large, currently-unresolved
 * financial exposure is a legitimate executive-attention item in its
 * own right, unlike an activity/revenue decline.
 */
export function evaluateCommercialClaimExposure(input: CommercialClaimExposureInput, period: Period): RecommendationCandidate | null {
  if (input.unresolvedExposure < CLAIM_EXPOSURE_MEDIUM_FLOOR) return null;
  const priority = input.unresolvedExposure >= CLAIM_EXPOSURE_CRITICAL_FLOOR ? "CRITICAL" : input.unresolvedExposure >= CLAIM_EXPOSURE_HIGH_FLOOR ? "HIGH" : "MEDIUM";
  return candidate({
    ruleId: "COMMERCIAL_CLAIM_EXPOSURE_BY_CURRENCY",
    ruleVersion: 1,
    primaryEntityKey: input.currencyCode,
    decisionCategory: "COMMERCIAL_EXPOSURE",
    priority,
    confidence: "HIGH",
    title: `Unresolved claim exposure of ${input.unresolvedExposureDisplay} ${input.currencyCode}`,
    explanation: `Across ${input.claimCount} claim(s) in ${input.currencyCode}: potential credit exposure ${input.potentialCreditExposureDisplay}, approved ${input.approvedCreditExposureDisplay}, actually credited by SAP ${input.actualSapCreditedAmountDisplay}. Unresolved exposure (potential minus actual credited): ${input.unresolvedExposureDisplay}.`,
    metrics: {
      claimCount: input.claimCount,
      potentialCreditExposure: input.potentialCreditExposureDisplay,
      approvedCreditExposure: input.approvedCreditExposureDisplay,
      actualSapCreditedAmount: input.actualSapCreditedAmountDisplay,
      unresolvedExposure: input.unresolvedExposureDisplay,
    },
    sourceRecords: [{ type: "CurrencyExposure", id: input.currencyCode, label: `Claims in ${input.currencyCode}`, href: `/reports/financial-exposure?currency=${encodeURIComponent(input.currencyCode)}` }],
    confidenceBasis: "Computed directly from each claim's own SAP-sourced financial summary (lib/invoice-claims/financial.ts), never estimated.",
    recommendedNextAction: "Review open claims in this currency for overdue resolution or SAP credit-note issuance.",
    period,
    currencyCode: input.currencyCode,
  });
}

export type CommercialCreditNoteBacklogInput = {
  currencyCode: string;
  unmatchedCount: number;
  unmatchedAmount: number;
  unmatchedAmountDisplay: string;
};

const CREDIT_NOTE_BACKLOG_COUNT_FLOOR = 2;
const CREDIT_NOTE_BACKLOG_AMOUNT_FLOOR = 500;
const CREDIT_NOTE_BACKLOG_COUNT_HIGH = 5;

/**
 * COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY v1. A deliberately
 * separate figure from the claim-exposure rule above -- a CreditNote
 * with matchStatus UNMATCHED is never counted as an issued credit note
 * against a claim (spec section 3.6: "never count a claim as an issued
 * credit note"), and this rule never adds its amount to the claim-
 * exposure rule's figures.
 */
export function evaluateCommercialCreditNoteBacklog(input: CommercialCreditNoteBacklogInput, period: Period): RecommendationCandidate | null {
  if (input.unmatchedCount < CREDIT_NOTE_BACKLOG_COUNT_FLOOR && input.unmatchedAmount < CREDIT_NOTE_BACKLOG_AMOUNT_FLOOR) return null;
  const priority = input.unmatchedCount >= CREDIT_NOTE_BACKLOG_COUNT_HIGH ? "HIGH" : "MEDIUM";
  return candidate({
    ruleId: "COMMERCIAL_CREDIT_NOTE_BACKLOG_BY_CURRENCY",
    ruleVersion: 1,
    primaryEntityKey: input.currencyCode,
    decisionCategory: "COMMERCIAL_EXPOSURE",
    priority,
    confidence: "HIGH",
    title: `${input.unmatchedCount} unmatched credit note(s) in ${input.currencyCode}`,
    explanation: `${input.unmatchedCount} credit note(s) totalling ${input.unmatchedAmountDisplay} ${input.currencyCode} are recorded but not yet matched to a claim.`,
    metrics: { unmatchedCount: input.unmatchedCount, unmatchedAmount: input.unmatchedAmountDisplay },
    sourceRecords: [{ type: "CreditNoteBacklog", id: input.currencyCode, label: `Unmatched credit notes in ${input.currencyCode}`, href: `/returns-credits/credit-notes?matchStatus=UNMATCHED` }],
    confidenceBasis: "Directly counted from CreditNote rows with matchStatus UNMATCHED.",
    recommendedNextAction: "Reconcile these credit notes against their originating claims.",
    period,
    currencyCode: input.currencyCode,
  });
}

// ---------------------------------------------------------------------------
// SALES category (reuses Milestone 12's attribution-confidence model and
// sales-pipeline source data).
// ---------------------------------------------------------------------------

export type SalesUnverifiedAttributionInput = {
  salespersonId: string;
  salespersonName: string;
  totalOrders: number;
  unverifiedOrders: number;
};

const ATTRIBUTION_MIN_SAMPLE_SIZE = 5;
const ATTRIBUTION_UNVERIFIED_SHARE_FIRE_THRESHOLD = 50;
const ATTRIBUTION_UNVERIFIED_SHARE_HIGH_THRESHOLD = 80;

/**
 * SALES_UNVERIFIED_ATTRIBUTION_CONCENTRATION v1. A data-quality/process
 * flag, NOT a performance judgement -- reuses Milestone 12's
 * classifyOrderAttribution buckets (the caller supplies the already-
 * computed counts). Fires only with at least ATTRIBUTION_MIN_SAMPLE_SIZE
 * orders (below that, the share is too noisy to classify at all, so no
 * candidate is produced -- not even an INSUFFICIENT_DATA one, since a
 * salesperson with 1-4 orders in the period having unverified
 * attribution is not itself an executive-attention item).
 *
 * Confidence is capped at MEDIUM even though the unverified SHARE
 * itself is an exact fact: the recommendation's own claim -- "this
 * salesperson's attributed performance may not be verified" -- is
 * inherently a process-hygiene inference, never a HIGH-confidence
 * statement about actual sales performance (spec section 3.3: "never
 * treat unverified attribution as if it were verified"). Never
 * upgraded to HIGH regardless of how large the share is.
 */
export function evaluateSalesUnverifiedAttributionConcentration(input: SalesUnverifiedAttributionInput, period: Period): RecommendationCandidate | null {
  if (input.totalOrders < ATTRIBUTION_MIN_SAMPLE_SIZE) return null;
  const unverifiedSharePercent = Math.round((input.unverifiedOrders / input.totalOrders) * 1000) / 10;
  if (unverifiedSharePercent < ATTRIBUTION_UNVERIFIED_SHARE_FIRE_THRESHOLD) return null;

  return candidate({
    ruleId: "SALES_UNVERIFIED_ATTRIBUTION_CONCENTRATION",
    ruleVersion: 1,
    primaryEntityKey: input.salespersonId,
    decisionCategory: "SALES",
    priority: unverifiedSharePercent >= ATTRIBUTION_UNVERIFIED_SHARE_HIGH_THRESHOLD ? "HIGH" : "MEDIUM",
    confidence: "MEDIUM",
    title: `${unverifiedSharePercent}% of ${input.salespersonName}'s attributed orders are unverified`,
    explanation: `${input.unverifiedOrders} of ${input.totalOrders} orders currently attributed to ${input.salespersonName} fall into an unverified attribution bucket (Milestone 12's attribution-confidence model), rather than VERIFIED or QUOTATION_SOURCED_LEGACY.`,
    metrics: { totalOrders: input.totalOrders, unverifiedOrders: input.unverifiedOrders, unverifiedSharePercent },
    sourceRecords: [{ type: "Salesperson", id: input.salespersonId, label: input.salespersonName, href: `/reports/sales-performance?salespersonId=${input.salespersonId}` }],
    confidenceBasis: "The unverified share is an exact count, but whether it reflects a real performance issue (rather than a data/process gap) is a process-hygiene inference, so confidence is capped at MEDIUM regardless of the share's size.",
    recommendedNextAction: "Review order-salesperson assignment practices for this salesperson before using this period's figures for performance evaluation.",
    period,
    salespersonId: input.salespersonId,
  });
}

export type SalesUnresolvedQuotationsBacklogInput = {
  salespersonId: string;
  salespersonName: string;
  unresolvedCount: number;
};

const SALES_UNRESOLVED_QUOTATIONS_FIRE_FLOOR = 3;
const SALES_UNRESOLVED_QUOTATIONS_HIGH = 8;

/**
 * SALES_UNRESOLVED_QUOTATIONS_BACKLOG v1. Same underlying fact as
 * CUSTOMER_UNRESOLVED_QUOTATIONS (quotations past validUntil with no
 * resolution) grouped by salesperson instead of customer -- a
 * legitimately distinct decision (who should be chasing these down)
 * from a different evidentiary grain, not a duplicate calculation (the
 * queries layer computes both groupings from one query).
 */
export function evaluateSalesUnresolvedQuotationsBacklog(input: SalesUnresolvedQuotationsBacklogInput, period: Period): RecommendationCandidate | null {
  if (input.unresolvedCount < SALES_UNRESOLVED_QUOTATIONS_FIRE_FLOOR) return null;
  return candidate({
    ruleId: "SALES_UNRESOLVED_QUOTATIONS_BACKLOG",
    ruleVersion: 1,
    primaryEntityKey: input.salespersonId,
    decisionCategory: "SALES",
    priority: input.unresolvedCount >= SALES_UNRESOLVED_QUOTATIONS_HIGH ? "HIGH" : "MEDIUM",
    confidence: "HIGH",
    title: `${input.unresolvedCount} unresolved quotations assigned to ${input.salespersonName}`,
    explanation: `${input.salespersonName} has ${input.unresolvedCount} quotation(s) past their validity date with no acceptance, rejection, expiry, or cancellation recorded.`,
    metrics: { unresolvedCount: input.unresolvedCount },
    sourceRecords: [{ type: "Salesperson", id: input.salespersonId, label: input.salespersonName, href: `/reports/sales-performance?salespersonId=${input.salespersonId}` }],
    confidenceBasis: "Directly counted from Quotation rows' status and validUntil fields.",
    recommendedNextAction: "Have this salesperson close out or follow up on their outstanding quotation backlog.",
    period,
    salespersonId: input.salespersonId,
  });
}

// ---------------------------------------------------------------------------
// OPERATIONAL category (reuses the existing approvals overdue computation
// and the existing lost-sales/management-reports list functions).
// ---------------------------------------------------------------------------

export type OperationalApprovalBottleneckInput = { overdueCount: number };

const APPROVAL_OVERDUE_MEDIUM_FLOOR = 1;
const APPROVAL_OVERDUE_HIGH_FLOOR = 5;
const APPROVAL_OVERDUE_CRITICAL_FLOOR = 10;

/**
 * OPERATIONAL_APPROVAL_BOTTLENECK v1. One whole-business aggregate
 * candidate (not per-record), reusing lib/approvals/queries.ts's
 * existing getApprovalDashboard().overdueCount computation directly --
 * never reimplemented. Allowed to reach CRITICAL: a large backlog of
 * overdue approvals is a direct operational bottleneck blocking real
 * orders/quotations, a legitimate executive-attention item like
 * commercial exposure.
 */
export function evaluateOperationalApprovalBottleneck(input: OperationalApprovalBottleneckInput, period: Period): RecommendationCandidate | null {
  if (input.overdueCount < APPROVAL_OVERDUE_MEDIUM_FLOOR) return null;
  const priority = input.overdueCount >= APPROVAL_OVERDUE_CRITICAL_FLOOR ? "CRITICAL" : input.overdueCount >= APPROVAL_OVERDUE_HIGH_FLOOR ? "HIGH" : "MEDIUM";
  return candidate({
    ruleId: "OPERATIONAL_APPROVAL_BOTTLENECK",
    ruleVersion: 1,
    primaryEntityKey: "ALL",
    decisionCategory: "OPERATIONAL",
    priority,
    confidence: "HIGH",
    title: `${input.overdueCount} approval request(s) overdue`,
    explanation: `${input.overdueCount} pending approval request(s) have exceeded their policy's overdueAfterHours threshold.`,
    metrics: { overdueCount: input.overdueCount },
    sourceRecords: [{ type: "ApprovalDashboard", id: "ALL", label: "Approvals dashboard", href: "/approvals" }],
    confidenceBasis: "Reuses lib/approvals/queries.ts's existing overdue computation directly.",
    recommendedNextAction: "Escalate these approval requests to the required approver role.",
    period,
  });
}

export type OperationalUnfulfilledDemandBacklogInput = { openCount: number };

const UNFULFILLED_DEMAND_MEDIUM_FLOOR = 5;
const UNFULFILLED_DEMAND_HIGH_FLOOR = 20;

/**
 * OPERATIONAL_UNFULFILLED_DEMAND_BACKLOG v1. One aggregate candidate,
 * reusing lib/lost-sales/queries.ts's existing open-unfulfilled-demand
 * count -- distinct from a CONFIRMED lost sale (spec section 3.7: never
 * invents events; an open UnfulfilledDemand record is a real,
 * already-recorded fact, not inferred).
 */
export function evaluateOperationalUnfulfilledDemandBacklog(input: OperationalUnfulfilledDemandBacklogInput, period: Period): RecommendationCandidate | null {
  if (input.openCount < UNFULFILLED_DEMAND_MEDIUM_FLOOR) return null;
  return candidate({
    ruleId: "OPERATIONAL_UNFULFILLED_DEMAND_BACKLOG",
    ruleVersion: 1,
    primaryEntityKey: "ALL",
    decisionCategory: "OPERATIONAL",
    priority: input.openCount >= UNFULFILLED_DEMAND_HIGH_FLOOR ? "HIGH" : "MEDIUM",
    confidence: "HIGH",
    title: `${input.openCount} unfulfilled demand record(s) open`,
    explanation: `${input.openCount} UnfulfilledDemand record(s) are currently open (not yet resolved by substitution, backorder, or decline).`,
    metrics: { openCount: input.openCount },
    sourceRecords: [{ type: "UnfulfilledDemandBacklog", id: "ALL", label: "Lost sales / unfulfilled demand", href: "/lost-sales" }],
    confidenceBasis: "Directly counted from open UnfulfilledDemand records.",
    recommendedNextAction: "Review open unfulfilled demand records for substitution or backorder decisions.",
    period,
  });
}

export type OperationalOrdersAwaitingFulfilmentInput = { awaitingCount: number };

const ORDERS_AWAITING_MEDIUM_FLOOR = 5;
const ORDERS_AWAITING_HIGH_FLOOR = 20;

/**
 * OPERATIONAL_ORDERS_AWAITING_FULFILMENT v1. One aggregate candidate,
 * reusing lib/reporting/management-reports.ts's existing
 * listOrdersAwaitingFulfilment count -- never reimplemented.
 */
export function evaluateOperationalOrdersAwaitingFulfilment(input: OperationalOrdersAwaitingFulfilmentInput, period: Period): RecommendationCandidate | null {
  if (input.awaitingCount < ORDERS_AWAITING_MEDIUM_FLOOR) return null;
  return candidate({
    ruleId: "OPERATIONAL_ORDERS_AWAITING_FULFILMENT",
    ruleVersion: 1,
    primaryEntityKey: "ALL",
    decisionCategory: "OPERATIONAL",
    priority: input.awaitingCount >= ORDERS_AWAITING_HIGH_FLOOR ? "HIGH" : "MEDIUM",
    confidence: "HIGH",
    title: `${input.awaitingCount} order(s) awaiting fulfilment`,
    explanation: `${input.awaitingCount} confirmed order(s) are awaiting picking/dispatch.`,
    metrics: { awaitingCount: input.awaitingCount },
    sourceRecords: [{ type: "OrdersAwaitingFulfilment", id: "ALL", label: "Orders awaiting fulfilment", href: "/orders?status=APPROVED" }],
    confidenceBasis: "Directly counted from CustomerOrder rows via the existing management-reports list function.",
    recommendedNextAction: "Review picking/dispatch capacity against this backlog.",
    period,
  });
}
