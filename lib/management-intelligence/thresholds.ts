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

/** Widened to number so administrator-configured values (lib/admin/settings-registry.ts) can be passed to the rule builders. */
export type IntelligenceThresholds = { -readonly [K in keyof typeof INTELLIGENCE_THRESHOLDS]: number };

/** Rule parameters shown on the page so a manager can see what flagged a finding. */
export function describeThresholds(t: IntelligenceThresholds = INTELLIGENCE_THRESHOLDS): { label: string; value: string }[] {
  return [
    { label: "Minimum records before a rate is acted on", value: String(t.minSample) },
    { label: "Picking availability flagged below", value: `${t.pickingAvailabilityLowPercent}% (critical below ${t.pickingAvailabilityCriticalPercent}%)` },
    { label: "Delivery acceptance flagged below", value: `${t.deliveryAcceptanceLowPercent}% (critical below ${t.deliveryAcceptanceCriticalPercent}%)` },
    { label: "Outstanding order flagged after", value: `${t.outstandingOrderAgeDays} days (critical after ${t.outstandingOrderCriticalAgeDays})` },
    { label: "Awaiting fulfilment flagged after", value: `${t.awaitingFulfilmentAgeDays} days (critical after ${t.awaitingFulfilmentCriticalAgeDays})` },
    { label: "Repeated product shortage", value: `${t.repeatShortageLines}+ lines (critical at ${t.repeatShortageCriticalLines}+)` },
    { label: "Repeated customer rejections", value: `${t.repeatCustomerRejections}+ in the period` },
    { label: "Repeat claims from one customer", value: `${t.repeatCustomerClaims}+ claims` },
    { label: "Quotation acceptance flagged below", value: `${t.quotationAcceptanceLowPercent}%` },
    { label: "Quotation to order conversion flagged below", value: `${t.quotationConversionLowPercent}%` },
    { label: "One claim reason flagged above", value: `${t.reasonConcentrationPercent}% of claims` },
    { label: "Average claim resolution flagged above", value: `${t.slowClaimResolutionDays} days` },
  ];
}
