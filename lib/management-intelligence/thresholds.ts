/**
 * Named rule parameters for the management recommendations.
 *
 * These are NOT targets or benchmarks the business has agreed. They are
 * the points at which a figure is flagged for a human to look at, shown
 * next to each recommendation so nobody mistakes them for a goal. Change
 * them here (one place) and every report and the Action Centre follow.
 */
export const INTELLIGENCE_THRESHOLDS = {
  /** Below this many records a rate or share is too thin to act on. */
  minSample: 5,

  pickingAvailabilityLowPercent: 90,
  pickingAvailabilityCriticalPercent: 75,
  deliveryAcceptanceLowPercent: 95,
  deliveryAcceptanceCriticalPercent: 85,

  outstandingOrderAgeDays: 14,
  outstandingOrderCriticalAgeDays: 30,
  awaitingFulfilmentAgeDays: 3,
  awaitingFulfilmentCriticalAgeDays: 7,
  statusConcentrationPercent: 50,

  repeatShortageLines: 3,
  repeatShortageCriticalLines: 8,
  repeatCustomerRejections: 2,
  repeatCustomerClaims: 3,

  quotationAcceptanceLowPercent: 30,
  quotationConversionLowPercent: 70,
  quotationExpiredSharePercent: 25,

  reasonConcentrationPercent: 40,
  slowClaimResolutionDays: 14,

  failedMessagesCritical: 10,
} as const;

export type IntelligenceThresholds = typeof INTELLIGENCE_THRESHOLDS;

/** Rule parameters shown on the page so a manager can see what flagged a finding. */
export const THRESHOLD_DESCRIPTIONS: { label: string; value: string }[] = [
  { label: "Minimum records before a rate is acted on", value: String(INTELLIGENCE_THRESHOLDS.minSample) },
  { label: "Picking availability flagged below", value: `${INTELLIGENCE_THRESHOLDS.pickingAvailabilityLowPercent}% (critical below ${INTELLIGENCE_THRESHOLDS.pickingAvailabilityCriticalPercent}%)` },
  { label: "Delivery acceptance flagged below", value: `${INTELLIGENCE_THRESHOLDS.deliveryAcceptanceLowPercent}% (critical below ${INTELLIGENCE_THRESHOLDS.deliveryAcceptanceCriticalPercent}%)` },
  { label: "Outstanding order flagged after", value: `${INTELLIGENCE_THRESHOLDS.outstandingOrderAgeDays} days (critical after ${INTELLIGENCE_THRESHOLDS.outstandingOrderCriticalAgeDays})` },
  { label: "Awaiting fulfilment flagged after", value: `${INTELLIGENCE_THRESHOLDS.awaitingFulfilmentAgeDays} days (critical after ${INTELLIGENCE_THRESHOLDS.awaitingFulfilmentCriticalAgeDays})` },
  { label: "Repeated product shortage", value: `${INTELLIGENCE_THRESHOLDS.repeatShortageLines}+ lines (critical at ${INTELLIGENCE_THRESHOLDS.repeatShortageCriticalLines}+)` },
  { label: "Repeated customer rejections", value: `${INTELLIGENCE_THRESHOLDS.repeatCustomerRejections}+ in the period` },
  { label: "Repeat claims from one customer", value: `${INTELLIGENCE_THRESHOLDS.repeatCustomerClaims}+ claims` },
  { label: "Quotation acceptance flagged below", value: `${INTELLIGENCE_THRESHOLDS.quotationAcceptanceLowPercent}%` },
  { label: "Quotation to order conversion flagged below", value: `${INTELLIGENCE_THRESHOLDS.quotationConversionLowPercent}%` },
  { label: "One claim reason flagged above", value: `${INTELLIGENCE_THRESHOLDS.reasonConcentrationPercent}% of claims` },
  { label: "Average claim resolution flagged above", value: `${INTELLIGENCE_THRESHOLDS.slowClaimResolutionDays} days` },
];
