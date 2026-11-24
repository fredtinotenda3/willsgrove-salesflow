import type { UnifiedLostSales, ReasonBreakdown } from "@/lib/lost-sales/unified-core";
import type { FulfilmentIntelligenceReport } from "@/lib/reporting/fulfilment-intelligence";
import type { CommunicationsMonitoringReport } from "@/lib/reporting/communications-monitoring";
import type { SalesPipelineReport } from "@/lib/reporting/sales-pipeline";
import type { FinancialExposureReport } from "@/lib/reporting/financial-exposure";
import type { LostSalesManagementReport, OutstandingOrderRow, ProductShortageBreakdownRow, DeliveryExceptionRow, CommunicationFailureRow } from "@/lib/reporting/management-reports";
import { INTELLIGENCE_THRESHOLDS as T } from "./thresholds";
import type {
  ClaimsExposureFacts,
  CommunicationFacts,
  DeliveryExceptionFacts,
  LostSalesFacts,
  OperationalFacts,
  OrderAgeFacts,
  QuotationFacts,
  ReasonFact,
  ShortageFacts,
} from "./rules";

/**
 * Pure mappers from the figures the existing reports already return to the
 * facts the rule builders read. No arithmetic here beyond counting and
 * grouping: every number a recommendation quotes is one the report shows.
 */

export function reasonFacts(reasons: ReasonBreakdown): ReasonFact[] {
  return reasons.rows.map((r) => ({ reasonCategory: r.reasonCategory, label: r.label, claimCount: r.claimCount, claimSharePercent: r.claimSharePercent, openClaimCount: r.openClaimCount }));
}

export function operationalFacts(data: { dateFrom: string; dateTo: string; fulfilment: FulfilmentIntelligenceReport; communications: CommunicationsMonitoringReport }): OperationalFacts {
  const { fulfilment, communications } = data;
  return {
    periodLabel: `${data.dateFrom} to ${data.dateTo}`,
    pickingAvailabilityRatePercent: fulfilment.rates.pickingAvailabilityRatePercent,
    pickingLineSampleSize: fulfilment.rates.pickingLineSampleSize,
    deliveryAcceptanceRatePercent: fulfilment.rates.deliveryAcceptanceRatePercent,
    deliveryLineSampleSize: fulfilment.rates.deliveryLineSampleSize,
    dispatchesOverdueToDepart: fulfilment.dispatchDelivery.dispatchesOverdueToDepart,
    ordersAwaitingPicking: fulfilment.orders.ordersAwaitingPicking,
    failedOutbound: communications.outbound.failed,
    ordersWithFailedOutbound: communications.exceptions.ordersWithFailedOutboundMessage,
    deliveryExceptionsWithNoSuccessfulNotification: communications.exceptions.deliveryExceptionsWithNoSuccessfulNotification,
  };
}

/**
 * `rows` must be the oldest-first page of the report (both order reports sort
 * ascending by date), so aged orders are always at the front and the count is
 * complete unless every examined row was aged and more rows exist.
 */
export function orderAgeFacts(
  report: { rows: OutstandingOrderRow[]; totalItems: number },
  breakdown: { byStatus: { status: string; count: number }[] },
  thresholdDays: number,
  criticalDays: number
): OrderAgeFacts {
  const aged = report.rows.filter((r) => r.daysOutstanding !== null && r.daysOutstanding > thresholdDays);
  const critical = aged.filter((r) => (r.daysOutstanding ?? 0) > criticalDays);
  const oldest = report.rows.reduce<OutstandingOrderRow | null>((best, r) => (r.daysOutstanding !== null && (best === null || r.daysOutstanding > (best.daysOutstanding ?? -1)) ? r : best), null);
  const top = breakdown.byStatus[0] ?? null;
  return {
    totalOrders: report.totalItems,
    rowsExamined: report.rows.length,
    agedCount: aged.length,
    criticalAgedCount: critical.length,
    oldestDays: oldest?.daysOutstanding ?? null,
    oldestReference: oldest?.reference ?? null,
    topStatus: top,
    agedCountIsMinimum: report.totalItems > report.rows.length && report.rows.length > 0 && aged.length === report.rows.length,
  };
}

export function outstandingOrderFacts(report: { rows: OutstandingOrderRow[]; totalItems: number }, breakdown: { byStatus: { status: string; count: number }[] }): OrderAgeFacts {
  return orderAgeFacts(report, breakdown, T.outstandingOrderAgeDays, T.outstandingOrderCriticalAgeDays);
}
export function awaitingFulfilmentFacts(report: { rows: OutstandingOrderRow[]; totalItems: number }, breakdown: { byStatus: { status: string; count: number }[] }): OrderAgeFacts {
  return orderAgeFacts(report, breakdown, T.awaitingFulfilmentAgeDays, T.awaitingFulfilmentCriticalAgeDays);
}

export function shortageFacts(breakdown: { topProducts: ProductShortageBreakdownRow[]; totalLines: number }): ShortageFacts {
  return { totalLines: breakdown.totalLines, topProducts: breakdown.topProducts };
}

export function deliveryExceptionFacts(report: { rows: DeliveryExceptionRow[]; totalItems: number }, breakdown: { byOutcome: { outcome: string; count: number }[] }): DeliveryExceptionFacts {
  const count = (outcome: string) => breakdown.byOutcome.find((b) => b.outcome === outcome)?.count ?? 0;
  const byCustomer = new Map<string, number>();
  for (const r of report.rows) byCustomer.set(r.customerName, (byCustomer.get(r.customerName) ?? 0) + 1);
  return {
    totalExceptions: report.totalItems,
    fullyRejected: count("FULLY_REJECTED"),
    partiallyRejected: count("PARTIALLY_REJECTED"),
    rowsExamined: report.rows.length,
    customers: [...byCustomer.entries()].map(([customerName, c]) => ({ customerName, count: c })).sort((a, b) => b.count - a.count || a.customerName.localeCompare(b.customerName)),
  };
}

function percent(n: number, d: number): number | null {
  return d === 0 ? null : Math.round((n / d) * 1000) / 10;
}

export function quotationFacts(data: { allTime: { issuedAwaitingResponse: number; dueForFollowUp: number }; period: { dateFrom: string; dateTo: string; funnel: SalesPipelineReport["funnel"] } }): QuotationFacts {
  const f = data.period.funnel;
  return {
    periodLabel: `${data.period.dateFrom} to ${data.period.dateTo}`,
    issuedInPeriod: f.quotationsIssued,
    acceptedInPeriod: f.quotationsAccepted,
    expiredInPeriod: f.quotationsExpired,
    acceptanceRatePercent: f.quotationAcceptanceRatePercent ?? percent(f.quotationsAccepted, f.quotationsIssued),
    acceptedInCohort: f.acceptedQuotationsInCohort,
    convertedInCohort: f.acceptedQuotationsConvertedToOrder,
    conversionRatePercent: f.quotationToOrderConversionRatePercent,
    dueForFollowUpNow: data.allTime.dueForFollowUp,
    awaitingResponseNow: data.allTime.issuedAwaitingResponse,
  };
}

export function lostSalesFacts(args: { periodLabel: string; summary: LostSalesManagementReport; unified: UnifiedLostSales; reasons: ReasonBreakdown }): LostSalesFacts {
  const { summary, unified, reasons } = args;
  return {
    periodLabel: args.periodLabel,
    unfulfilledDemandCount: unified.unfulfilled.demandCount,
    demandsWithoutPrice: unified.unfulfilled.demandsWithoutPrice,
    topUnavailableProducts: summary.topUnavailableProducts.slice(0, 3).map((p) => ({ description: p.productDescriptionSnapshot, totalQuantity: p.totalQuantity })),
    topShortageCustomers: summary.topShortageCustomers.map((c) => ({ customerName: c.customerName, demandCount: c.demandCount })),
    claimCount: unified.claimCount,
    openClaimCount: unified.openClaimCount,
    underDisputeByCurrency: unified.underDisputeByCurrency,
    rejectedAfterDeliveryByCurrency: unified.rejectedAfterDelivery.valueByCurrency,
    linesWithoutPrice: unified.rejectedAfterDelivery.linesWithoutPrice,
    reasons: reasonFacts(reasons),
  };
}

export function claimsExposureFacts(args: { financial: FinancialExposureReport; unified: UnifiedLostSales; reasons: ReasonBreakdown }): ClaimsExposureFacts {
  const { financial, unified, reasons } = args;
  return {
    claimCount: unified.claimCount,
    openClaimCount: unified.openClaimCount,
    underDisputeByCurrency: unified.underDisputeByCurrency,
    approvedNotYetCreditedByCurrency: unified.approvedNotYetCreditedByCurrency,
    unclassifiedConcludedByCurrency: unified.unclassifiedConcludedByCurrency,
    claimsWhereCreditExceedsDisputed: unified.claimsWhereCreditExceedsDisputed,
    creditNotesPendingCount: financial.returnsAndCreditNotes.creditNotesPendingCount,
    returnsAwaitingResolution: financial.returnsAndCreditNotes.returnsAwaitingResolution,
    averageResolutionDays: financial.claims.averageResolutionDays,
    repeatComplaintCustomers: financial.claims.repeatComplaintCustomers.map((c) => ({ customerName: c.customerName, claimCount: c.claimCount })),
    reasons: reasonFacts(reasons),
  };
}

export function communicationFacts(args: {
  report: { rows: CommunicationFailureRow[]; totalItems: number };
  breakdown: { byChannel: { key: string; count: number }[]; byType: { key: string; count: number }[] };
  communications: CommunicationsMonitoringReport;
}): CommunicationFacts {
  return {
    failedCount: args.report.totalItems,
    ordersWithFailedOutbound: args.communications.exceptions.ordersWithFailedOutboundMessage,
    deliveryExceptionsWithNoSuccessfulNotification: args.communications.exceptions.deliveryExceptionsWithNoSuccessfulNotification,
    topChannel: args.breakdown.byChannel[0] ?? null,
    topType: args.breakdown.byType[0] ?? null,
    repeatedlyRetried: args.report.rows.filter((r) => r.attemptCount > 1).length,
  };
}
