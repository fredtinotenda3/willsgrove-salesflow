import { formatMoney } from "@/lib/format/analytics";
import { INTELLIGENCE_THRESHOLDS as T } from "./thresholds";
import {
  finishIntelligence,
  makeFinding,
  type EvidenceItem,
  type FindingLink,
  type ManagementFinding,
  type ManagementIntelligence,
  type ResponsibleFunction,
} from "./types";

/**
 * The nine report builders. Each takes plain "facts" already read from the
 * report's own data (see facts.ts) and returns findings. Pure and
 * deterministic: no I/O, no clock, no invented numbers. A builder that does
 * not have enough data says so in `insufficientEvidence` and gives no
 * advice for that point.
 */

const link = (label: string, href: string): FindingLink => ({ label, href });
const pct = (v: number) => `${v.toFixed(1)}%`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ev = (label: string, value: string): EvidenceItem => ({ label, value });

// ---------------------------------------------------------------------------
// 1. Operational summary
// ---------------------------------------------------------------------------
export type OperationalFacts = {
  periodLabel: string;
  pickingAvailabilityRatePercent: number | null;
  pickingLineSampleSize: number;
  deliveryAcceptanceRatePercent: number | null;
  deliveryLineSampleSize: number;
  dispatchesOverdueToDepart: number;
  ordersAwaitingPicking: number;
  failedOutbound: number;
  ordersWithFailedOutbound: number;
  deliveryExceptionsWithNoSuccessfulNotification: number;
};

export function buildOperationalSummaryIntelligence(f: OperationalFacts): ManagementIntelligence {
  const id = "operational-summary";
  const out: ManagementFinding[] = [];
  const gaps: string[] = [];
  let checked = false;

  if (f.pickingAvailabilityRatePercent === null || f.pickingLineSampleSize < T.minSample) {
    gaps.push(`Picking availability: only ${plural(f.pickingLineSampleSize, "picked line")} in ${f.periodLabel}; at least ${T.minSample} are needed before a rate is acted on.`);
  } else {
    checked = true;
    if (f.pickingAvailabilityRatePercent < T.pickingAvailabilityLowPercent) {
      const critical = f.pickingAvailabilityRatePercent < T.pickingAvailabilityCriticalPercent;
      out.push(
        makeFinding(id, {
          key: "picking-availability-low",
          topic: "picking-availability-low",
          tag: "shortage",
          title: "Picking availability is below the review line",
          finding: `Only ${pct(f.pickingAvailabilityRatePercent)} of requested quantity was found at picking in ${f.periodLabel}.`,
          evidence: [ev("Availability rate", pct(f.pickingAvailabilityRatePercent)), ev("Picked lines", String(f.pickingLineSampleSize)), ev("Rule parameter", `flag below ${T.pickingAvailabilityLowPercent}%`)],
          businessImpact: "Each shortfall is a sale that is delayed or lost and a customer who sees a short delivery.",
          recommendedAction: "Review the products that fall short most often and compare their order cover with real demand. Raise purchase quantities or confirm substitutes before the next order cycle.",
          responsibleFunction: "PURCHASING",
          priority: critical ? "CRITICAL" : "HIGH",
          expectedOutcome: "Fewer short-picked lines on the products reviewed.",
          measurement: "Picking availability rate for the same period length, compared with this figure.",
          links: [link("Picking shortages report", "/reports/management/picking-shortages")],
        })
      );
    }
  }

  if (f.deliveryAcceptanceRatePercent === null || f.deliveryLineSampleSize < T.minSample) {
    gaps.push(`Delivery acceptance: only ${plural(f.deliveryLineSampleSize, "delivered line")} in ${f.periodLabel}; at least ${T.minSample} are needed.`);
  } else {
    checked = true;
    if (f.deliveryAcceptanceRatePercent < T.deliveryAcceptanceLowPercent) {
      const critical = f.deliveryAcceptanceRatePercent < T.deliveryAcceptanceCriticalPercent;
      out.push(
        makeFinding(id, {
          key: "delivery-acceptance-low",
          topic: "delivery-acceptance-low",
          tag: "product-rejection",
          title: "Customers are rejecting more deliveries than the review line allows",
          finding: `${pct(f.deliveryAcceptanceRatePercent)} of delivered quantity was accepted in ${f.periodLabel}.`,
          evidence: [ev("Acceptance rate", pct(f.deliveryAcceptanceRatePercent)), ev("Delivered lines", String(f.deliveryLineSampleSize)), ev("Rule parameter", `flag below ${T.deliveryAcceptanceLowPercent}%`)],
          businessImpact: "Rejected goods become claims, returns and credit notes, and cost goodwill with the customer.",
          recommendedAction: "Open the rejected deliveries, group them by product and reason, and agree a check at dispatch for the products that recur.",
          responsibleFunction: "QUALITY_CONTROL",
          priority: critical ? "CRITICAL" : "HIGH",
          expectedOutcome: "A higher share of delivered quantity accepted in full.",
          measurement: "Delivery acceptance rate and the number of rejected deliveries for the same period length.",
          links: [link("Delivery exceptions report", "/reports/management/delivery-exceptions"), link("Invoice claims dashboard", "/invoice-claims/dashboard")],
        })
      );
    }
  }

  if (f.dispatchesOverdueToDepart > 0) {
    checked = true;
    out.push(
      makeFinding(id, {
        key: "dispatches-overdue",
        topic: "dispatches-overdue",
        tag: "operational",
        title: "Dispatches are past their planned departure",
        finding: `${plural(f.dispatchesOverdueToDepart, "dispatch")} should already have left but ${f.dispatchesOverdueToDepart === 1 ? "has" : "have"} not.`,
        evidence: [ev("Overdue dispatches", String(f.dispatchesOverdueToDepart)), ev("Orders awaiting picking", String(f.ordersAwaitingPicking))],
        businessImpact: "Late departures push delivery dates and raise the chance of fresh produce arriving past its best.",
        recommendedAction: "Confirm for each overdue dispatch whether goods, vehicle or driver is the blocker, and re-plan or release it today.",
        responsibleFunction: "OPERATIONS",
        priority: "HIGH",
        expectedOutcome: "No dispatch left past its planned departure without a recorded reason.",
        measurement: "Overdue-to-depart dispatch count at the next daily review.",
        links: [link("Orders awaiting fulfilment", "/reports/management/awaiting-fulfilment")],
      })
    );
  } else {
    checked = true;
  }

  if (f.failedOutbound > 0) {
    out.push(failedMessagesFinding(id, f.failedOutbound, f.ordersWithFailedOutbound, f.deliveryExceptionsWithNoSuccessfulNotification));
  }

  return finishIntelligence(id, out, gaps, checked && gaps.length === 0);
}

function failedMessagesFinding(reportId: string, failed: number, orders: number, exceptionsNotNotified: number): ManagementFinding {
  return makeFinding(reportId, {
    key: "failed-messages",
    topic: "failed-messages",
    tag: "communication",
    title: "Outbound customer messages are failing",
    finding: `${plural(failed, "outbound message")} failed to send${orders > 0 ? `, touching ${plural(orders, "order")}` : ""}.`,
    evidence: [ev("Failed messages", String(failed)), ev("Orders affected", String(orders)), ev("Delivery exceptions with no successful notification", String(exceptionsNotNotified))],
    businessImpact: "Customers may not have been told about their order or a delivery problem, which invites avoidable complaints.",
    recommendedAction: "Work through the failed messages, fix the cause (address, channel or service) and resend or phone the customer where the message matters.",
    responsibleFunction: "OPERATIONS",
    priority: failed >= T.failedMessagesCritical || exceptionsNotNotified > 0 ? "HIGH" : "MEDIUM",
    expectedOutcome: "No customer-facing message left in a failed state without follow-up.",
    measurement: "Failed outbound message count for the same period length.",
    links: [link("Communication failures report", "/reports/management/communication-failures")],
  });
}

// ---------------------------------------------------------------------------
// 2 and 3. Outstanding orders / orders awaiting fulfilment
// ---------------------------------------------------------------------------
export type OrderAgeFacts = {
  totalOrders: number;
  rowsExamined: number;
  /** Oldest first. Orders older than the report's own threshold are counted from these rows. */
  agedCount: number;
  criticalAgedCount: number;
  oldestDays: number | null;
  oldestReference: string | null;
  topStatus: { status: string; count: number } | null;
  /** true when every examined row was aged and more rows exist than were examined. */
  agedCountIsMinimum: boolean;
};

function orderAgeIntelligence(id: "outstanding-orders" | "awaiting-fulfilment", f: OrderAgeFacts, cfg: { thresholdDays: number; criticalDays: number; noun: string; owner: ResponsibleFunction; action: string; impact: string }): ManagementIntelligence {
  const out: ManagementFinding[] = [];
  const gaps: string[] = [];
  if (f.totalOrders === 0) return finishIntelligence(id, [], [], true);

  if (f.agedCount > 0) {
    const atLeast = f.agedCountIsMinimum ? "at least " : "";
    out.push(
      makeFinding(id, {
        key: "aged-orders",
        topic: `aged-${id}`,
        tag: "operational",
        title: `${cfg.noun} orders have been waiting too long`,
        finding: `${atLeast}${plural(f.agedCount, "order")} ${f.agedCount === 1 ? "has" : "have"} been waiting more than ${cfg.thresholdDays} days${f.oldestDays !== null ? `; the oldest (${f.oldestReference ?? "unreferenced"}) has waited ${f.oldestDays} days` : ""}.`,
        evidence: [ev("Aged orders", `${atLeast}${f.agedCount}`), ev("Of total", String(f.totalOrders)), ev("Oldest", f.oldestDays === null ? "n/a" : `${f.oldestDays} days`), ev("Rule parameter", `flag after ${cfg.thresholdDays} days`)],
        businessImpact: cfg.impact,
        recommendedAction: cfg.action,
        responsibleFunction: cfg.owner,
        priority: f.criticalAgedCount > 0 ? "CRITICAL" : f.agedCount >= T.minSample ? "HIGH" : "MEDIUM",
        expectedOutcome: "Aged orders are either moved forward or closed with a recorded reason.",
        measurement: `Number of orders older than ${cfg.thresholdDays} days at the next weekly review.`,
        links: [link(`${cfg.noun} orders report`, `/reports/management/${id}`)],
      })
    );
  }

  if (f.topStatus && f.totalOrders >= T.minSample && (f.topStatus.count / f.totalOrders) * 100 >= T.statusConcentrationPercent && id === "outstanding-orders") {
    const share = (f.topStatus.count / f.totalOrders) * 100;
    out.push(
      makeFinding(id, {
        key: "status-concentration",
        topic: "status-concentration",
        tag: "operational",
        title: "Most outstanding orders are stuck at one stage",
        finding: `${pct(share)} of outstanding orders are at "${f.topStatus.status}".`,
        evidence: [ev("Stage", f.topStatus.status), ev("Orders at that stage", `${f.topStatus.count} of ${f.totalOrders}`), ev("Rule parameter", `flag at ${T.statusConcentrationPercent}% or more`)],
        businessImpact: "A queue building at a single stage points to a bottleneck rather than isolated delays.",
        recommendedAction: "Find who owns that stage, check for a blocker common to these orders and clear the queue.",
        responsibleFunction: "OPERATIONS",
        priority: "MEDIUM",
        expectedOutcome: "Orders flow past that stage instead of accumulating.",
        measurement: "Share of outstanding orders at that stage.",
        links: [link("Outstanding orders report", "/reports/management/outstanding-orders")],
      })
    );
  }

  return finishIntelligence(id, out, gaps, true);
}

export function buildOutstandingOrdersIntelligence(f: OrderAgeFacts): ManagementIntelligence {
  return orderAgeIntelligence("outstanding-orders", f, {
    thresholdDays: T.outstandingOrderAgeDays,
    criticalDays: T.outstandingOrderCriticalAgeDays,
    noun: "Outstanding",
    owner: "OPERATIONS",
    action: "Go through the oldest orders one by one. Confirm with the customer whether each is still wanted, then fulfil, amend or cancel it and record why.",
    impact: "Orders that sit for weeks tie up stock and attention, and the customer may already have bought elsewhere.",
  });
}

export function buildAwaitingFulfilmentIntelligence(f: OrderAgeFacts): ManagementIntelligence {
  return orderAgeIntelligence("awaiting-fulfilment", f, {
    thresholdDays: T.awaitingFulfilmentAgeDays,
    criticalDays: T.awaitingFulfilmentCriticalAgeDays,
    noun: "Awaiting-fulfilment",
    owner: "WAREHOUSE",
    action: "Start picking the oldest approved orders first, and where stock is short decide today whether to part-ship or contact the customer.",
    impact: "Approved orders that are not picked miss their delivery promise and raise the chance of cancellation.",
  });
}

// ---------------------------------------------------------------------------
// 4. Picking shortages
// ---------------------------------------------------------------------------
export type ShortageFacts = {
  totalLines: number;
  topProducts: { productDescription: string; lineCount: number; totalUnavailableQuantity: string; totalUnavailableValue: string; linesWithoutPrice: number }[];
};

export function buildPickingShortagesIntelligence(f: ShortageFacts): ManagementIntelligence {
  const id = "picking-shortages";
  if (f.totalLines === 0) return finishIntelligence(id, [], [], true);
  const out: ManagementFinding[] = [];
  const gaps: string[] = [];
  for (const p of f.topProducts) {
    if (p.lineCount < T.repeatShortageLines) continue;
    const priced = p.linesWithoutPrice < p.lineCount;
    out.push(
      makeFinding(id, {
        key: `product-shortage:${p.productDescription}`,
        topic: `shortage-product:${p.productDescription}`,
        tag: "shortage",
        title: `Repeated shortage: ${p.productDescription}`,
        finding: `${p.productDescription} fell short on ${plural(p.lineCount, "order line")}, ${p.totalUnavailableQuantity} not available in total.`,
        evidence: [
          ev("Short lines", String(p.lineCount)),
          ev("Quantity not available", p.totalUnavailableQuantity),
          ev("Value at approved line prices", priced ? p.totalUnavailableValue : "not priced"),
          ...(p.linesWithoutPrice > 0 ? [ev("Lines without an approved price (no value)", String(p.linesWithoutPrice))] : []),
          ev("Rule parameter", `flag at ${T.repeatShortageLines}+ lines`),
        ],
        businessImpact: "A product that keeps running short loses sales every cycle and trains customers to order it elsewhere.",
        recommendedAction: "Check supplier availability and order cover for this product, raise the standing order quantity or line up a second source.",
        responsibleFunction: "PURCHASING",
        priority: p.lineCount >= T.repeatShortageCriticalLines ? "CRITICAL" : "HIGH",
        expectedOutcome: "Fewer short lines for this product in the next period.",
        measurement: "Short line count and quantity not available for this product, same period length.",
        links: [link("Picking shortages report", "/reports/management/picking-shortages"), link("Lost sales analytics", "/lost-sales/analytics")],
      })
    );
  }
  if (out.length === 0 && f.totalLines < T.minSample) {
    gaps.push(`Only ${plural(f.totalLines, "short line")} in the period; a product needs ${T.repeatShortageLines}+ before a repeated shortage is reported.`);
  }
  return finishIntelligence(id, out, gaps, out.length === 0 && gaps.length === 0);
}

// ---------------------------------------------------------------------------
// 5. Delivery exceptions
// ---------------------------------------------------------------------------
export type DeliveryExceptionFacts = {
  totalExceptions: number;
  fullyRejected: number;
  partiallyRejected: number;
  rowsExamined: number;
  customers: { customerName: string; count: number }[];
};

export function buildDeliveryExceptionsIntelligence(f: DeliveryExceptionFacts): ManagementIntelligence {
  const id = "delivery-exceptions";
  if (f.totalExceptions === 0) return finishIntelligence(id, [], [], true);
  const out: ManagementFinding[] = [];

  if (f.fullyRejected > 0) {
    out.push(
      makeFinding(id, {
        key: "fully-rejected",
        topic: "deliveries-fully-rejected",
        tag: "product-rejection",
        title: "Whole deliveries were rejected",
        finding: `${plural(f.fullyRejected, "delivery", "deliveries")} ${f.fullyRejected === 1 ? "was" : "were"} rejected in full.`,
        evidence: [ev("Fully rejected", String(f.fullyRejected)), ev("Partially rejected", String(f.partiallyRejected)), ev("All exceptions", String(f.totalExceptions))],
        businessImpact: "A fully rejected delivery earns no revenue and costs the transport, handling and goods.",
        recommendedAction: "Review each fully rejected delivery with the customer, record the reason, and decide whether the goods can be resold, returned or written off.",
        responsibleFunction: "QUALITY_CONTROL",
        priority: f.fullyRejected >= 3 ? "CRITICAL" : "HIGH",
        expectedOutcome: "Every full rejection has a recorded cause and a decision on the goods.",
        measurement: "Fully rejected deliveries in the next period of the same length.",
        links: [link("Delivery exceptions report", "/reports/management/delivery-exceptions"), link("Invoice claims", "/invoice-claims")],
      })
    );
  }

  for (const c of f.customers) {
    if (c.count < T.repeatCustomerRejections) continue;
    out.push(
      makeFinding(id, {
        key: `customer-rejections:${c.customerName}`,
        topic: `customer-rejections:${c.customerName}`,
        tag: "customer",
        title: `Repeated rejections: ${c.customerName}`,
        finding: `${c.customerName} rejected ${plural(c.count, "delivery", "deliveries")} (in full or part) in the period.`,
        evidence: [ev("Customer", c.customerName), ev("Rejected deliveries", String(c.count)), ev("Rule parameter", `flag at ${T.repeatCustomerRejections}+`), ...(f.rowsExamined < f.totalExceptions ? [ev("Based on", `${f.rowsExamined} of ${f.totalExceptions} rows`)] : [])],
        businessImpact: "A customer who keeps rejecting deliveries is at risk of leaving and is costing repeat handling.",
        recommendedAction: "Speak to the customer about what they are seeing, agree what they will accept, and brief dispatch on it.",
        responsibleFunction: "SALES",
        priority: c.count >= T.repeatCustomerClaims ? "HIGH" : "MEDIUM",
        expectedOutcome: "The customer's rejections fall or the cause is documented and agreed.",
        measurement: "Rejected deliveries for this customer in the next period of the same length.",
        links: [link("Delivery exceptions report", "/reports/management/delivery-exceptions")],
      })
    );
  }
  return finishIntelligence(id, out, [], out.length === 0);
}

// ---------------------------------------------------------------------------
// 6. Quotations performance
// ---------------------------------------------------------------------------
export type QuotationFacts = {
  periodLabel: string;
  issuedInPeriod: number;
  acceptedInPeriod: number;
  expiredInPeriod: number;
  acceptanceRatePercent: number | null;
  acceptedInCohort: number;
  convertedInCohort: number;
  conversionRatePercent: number | null;
  dueForFollowUpNow: number;
  awaitingResponseNow: number;
};

export function buildQuotationsIntelligence(f: QuotationFacts): ManagementIntelligence {
  const id = "quotations-performance";
  const out: ManagementFinding[] = [];
  const gaps: string[] = [];
  let checked = false;

  if (f.dueForFollowUpNow > 0) {
    checked = true;
    out.push(
      makeFinding(id, {
        key: "followups-due",
        topic: "quotation-followups-due",
        tag: "commercial",
        title: "Quotations are due for follow-up",
        finding: `${plural(f.dueForFollowUpNow, "issued quotation")} ${f.dueForFollowUpNow === 1 ? "has" : "have"} reached ${f.dueForFollowUpNow === 1 ? "its" : "their"} follow-up date with no response.`,
        evidence: [ev("Due for follow-up", String(f.dueForFollowUpNow)), ev("Awaiting a response in total", String(f.awaitingResponseNow))],
        businessImpact: "An unanswered quotation that is not chased usually expires and the sale goes elsewhere.",
        recommendedAction: "Call or message each customer, record the answer, and extend or close the quotation.",
        responsibleFunction: "SALES",
        priority: "HIGH",
        expectedOutcome: "Every due quotation has a recorded response or a new follow-up date.",
        measurement: "Quotations due for follow-up at the next daily review.",
        links: [link("Quotations", "/quotations")],
      })
    );
  }

  if (f.issuedInPeriod < T.minSample || f.acceptanceRatePercent === null) {
    gaps.push(`Acceptance rate: only ${plural(f.issuedInPeriod, "quotation")} issued in ${f.periodLabel}; at least ${T.minSample} are needed before the rate is acted on.`);
  } else {
    checked = true;
    if (f.acceptanceRatePercent < T.quotationAcceptanceLowPercent) {
      out.push(
        makeFinding(id, {
          key: "acceptance-low",
          topic: "quotation-acceptance-low",
          tag: "commercial",
          title: "Few quotations are being accepted",
          finding: `${pct(f.acceptanceRatePercent)} of quotations issued in ${f.periodLabel} were accepted.`,
          evidence: [ev("Issued", String(f.issuedInPeriod)), ev("Accepted", String(f.acceptedInPeriod)), ev("Acceptance rate", pct(f.acceptanceRatePercent)), ev("Rule parameter", `flag below ${T.quotationAcceptanceLowPercent}%`)],
          businessImpact: "Quoting effort is not turning into orders, which points to price, speed or follow-up.",
          recommendedAction: "Sample the rejected and expired quotations, note the reasons given, and compare price and response time with the accepted ones.",
          responsibleFunction: "SALES",
          priority: "MEDIUM",
          expectedOutcome: "A clear reason for lost quotations and a higher acceptance rate.",
          measurement: "Acceptance rate for the same period length.",
          links: [link("Quotations", "/quotations")],
        })
      );
    }
    const expiredShare = (f.expiredInPeriod / f.issuedInPeriod) * 100;
    if (expiredShare >= T.quotationExpiredSharePercent) {
      out.push(
        makeFinding(id, {
          key: "expired-share-high",
          topic: "quotation-expired-share",
          tag: "commercial",
          title: "Many quotations are expiring unanswered",
          finding: `${pct(expiredShare)} of quotations issued in ${f.periodLabel} expired.`,
          evidence: [ev("Issued", String(f.issuedInPeriod)), ev("Expired", String(f.expiredInPeriod)), ev("Rule parameter", `flag at ${T.quotationExpiredSharePercent}% or more`)],
          businessImpact: "Expiry means no decision was reached, so the opportunity was neither won nor understood.",
          recommendedAction: "Set a follow-up date on every issued quotation and review the ones about to expire each week.",
          responsibleFunction: "SALES",
          priority: "MEDIUM",
          expectedOutcome: "Fewer quotations expiring without a recorded answer.",
          measurement: "Expired share of issued quotations for the same period length.",
          links: [link("Quotations", "/quotations")],
        })
      );
    }
  }

  if (f.conversionRatePercent === null || f.acceptedInCohort < T.minSample) {
    gaps.push(`Conversion to order: only ${plural(f.acceptedInCohort, "accepted quotation")} in the cohort; at least ${T.minSample} are needed.`);
  } else {
    checked = true;
    if (f.conversionRatePercent < T.quotationConversionLowPercent) {
      out.push(
        makeFinding(id, {
          key: "conversion-low",
          topic: "quotation-conversion-low",
          tag: "commercial",
          title: "Accepted quotations are not all becoming orders",
          finding: `Only ${pct(f.conversionRatePercent)} of accepted quotations in ${f.periodLabel} were converted to an order.`,
          evidence: [ev("Accepted", String(f.acceptedInCohort)), ev("Converted", String(f.convertedInCohort)), ev("Conversion", pct(f.conversionRatePercent)), ev("Rule parameter", `flag below ${T.quotationConversionLowPercent}%`)],
          businessImpact: "A customer who accepted but has no order is a sale waiting to be lost.",
          recommendedAction: "List the accepted quotations with no order and ask each customer for their purchase order.",
          responsibleFunction: "SALES",
          priority: "HIGH",
          expectedOutcome: "Accepted quotations are converted or closed with a reason.",
          measurement: "Conversion rate for the same period length.",
          links: [link("Quotations", "/quotations")],
        })
      );
    }
  }
  return finishIntelligence(id, out, gaps, checked && gaps.length === 0);
}

// ---------------------------------------------------------------------------
// 7. Lost sales (uses the unified six measures)
// ---------------------------------------------------------------------------
export type ReasonFact = { reasonCategory: string; label: string; claimCount: number; claimSharePercent: number | null; openClaimCount: number };

export const REASON_OWNER: Record<string, ResponsibleFunction> = {
  PRICING_DISPUTE: "SALES",
  QUALITY_ISSUE: "QUALITY_CONTROL",
  SHORT_DELIVERY: "WAREHOUSE",
  OVERSUPPLY: "WAREHOUSE",
  EXPIRED_PRODUCT: "QUALITY_CONTROL",
  NO_BARCODE: "PURCHASING",
  BARCODE_SCANNING_ISSUE: "OPERATIONS",
  DUPLICATE_ENTRY: "FINANCE",
};

const REASON_ACTION: Record<string, string> = {
  PRICING_DISPUTE: "Compare the disputed prices with the price list and quotation for each claim and correct the source of the mismatch.",
  QUALITY_ISSUE: "Inspect the affected products and suppliers, and tighten the check at goods-in and dispatch.",
  SHORT_DELIVERY: "Check the picking and loading records for the affected deliveries and add a count check before the vehicle leaves.",
  OVERSUPPLY: "Check the invoiced and delivered quantities for the affected orders and correct the picking or invoicing step.",
  EXPIRED_PRODUCT: "Check stock rotation and shelf-life checks for the affected products before dispatch.",
  NO_BARCODE: "Raise the missing barcodes with the supplier or packer and add a barcode check at goods-in.",
  BARCODE_SCANNING_ISSUE: "Check the label quality and the customer's scanning requirements for the affected products.",
  DUPLICATE_ENTRY: "Find where the duplicate invoice lines are created and add a duplicate check before posting.",
};

export function reasonFindings(reportId: string, reasons: ReasonFact[], totalClaims: number): { findings: ManagementFinding[]; gap: string | null } {
  if (totalClaims < T.minSample) {
    return { findings: [], gap: totalClaims === 0 ? null : `Claim reasons: only ${plural(totalClaims, "claim")} in the period; at least ${T.minSample} are needed before one reason is called a pattern.` };
  }
  const top = reasons.find((r) => r.claimSharePercent !== null && r.claimSharePercent >= T.reasonConcentrationPercent && r.claimCount >= 2);
  if (!top || top.claimSharePercent === null) return { findings: [], gap: null };
  const owner = REASON_OWNER[top.reasonCategory] ?? "MANAGEMENT";
  return {
    gap: null,
    findings: [
      makeFinding(reportId, {
        key: `claim-reason:${top.reasonCategory}`,
        topic: `claim-reason:${top.reasonCategory}`,
        tag: "product-rejection",
        title: `One claim reason dominates: ${top.label}`,
        finding: `${top.label} accounts for ${pct(top.claimSharePercent)} of claims in the period.`,
        evidence: [ev("Reason", top.label), ev("Claims", `${top.claimCount} of ${totalClaims}`), ev("Still open", String(top.openClaimCount)), ev("Rule parameter", `flag at ${T.reasonConcentrationPercent}% or more`)],
        businessImpact: "When most claims share one cause, fixing that cause removes more disputes than handling each claim.",
        recommendedAction: REASON_ACTION[top.reasonCategory] ?? "Review the claims with this reason and agree a single corrective action.",
        responsibleFunction: owner,
        priority: top.openClaimCount >= T.minSample ? "HIGH" : "MEDIUM",
        expectedOutcome: "A lower share of claims under this reason.",
        measurement: "Claims under this reason, and its share of all claims, for the same period length.",
        links: [link("Claims by reason", "/invoice-claims/dashboard"), link("Lost sales analytics", "/lost-sales/analytics")],
      }),
    ],
  };
}

export type LostSalesFacts = {
  periodLabel: string;
  unfulfilledDemandCount: number;
  demandsWithoutPrice: number;
  topUnavailableProducts: { description: string; totalQuantity: string }[];
  topShortageCustomers: { customerName: string; demandCount: number }[];
  claimCount: number;
  openClaimCount: number;
  underDisputeByCurrency: { currency: string; value: string }[];
  rejectedAfterDeliveryByCurrency: { currency: string; value: string }[];
  linesWithoutPrice: number;
  reasons: ReasonFact[];
};

export function buildLostSalesIntelligence(f: LostSalesFacts): ManagementIntelligence {
  const id = "lost-sales";
  const out: ManagementFinding[] = [];
  const gaps: string[] = [];
  const nothing = f.unfulfilledDemandCount === 0 && f.claimCount === 0;
  if (nothing) return finishIntelligence(id, [], [], true);

  const topProduct = f.topUnavailableProducts[0];
  if (topProduct) {
    out.push(
      makeFinding(id, {
        key: `top-unavailable:${topProduct.description}`,
        topic: `shortage-product:${topProduct.description}`,
        tag: "shortage",
        title: `Most unfulfilled demand: ${topProduct.description}`,
        finding: `${topProduct.description} has the largest unavailable quantity (${topProduct.totalQuantity}) across ${plural(f.unfulfilledDemandCount, "unfulfilled demand record")}.`,
        evidence: [ev("Product", topProduct.description), ev("Unavailable quantity", topProduct.totalQuantity), ev("Demand records (all products)", String(f.unfulfilledDemandCount))],
        businessImpact: "Demand that could not be supplied is revenue the business already had a customer for.",
        recommendedAction: "Confirm whether supply of this product can be raised or a substitute offered, and tell Sales what to promise.",
        responsibleFunction: "PURCHASING",
        priority: "MEDIUM",
        expectedOutcome: "Less unavailable quantity for this product.",
        measurement: "Unavailable quantity for this product, same period length.",
        links: [link("Lost sales analytics", "/lost-sales/analytics"), link("Picking shortages report", "/reports/management/picking-shortages")],
      })
    );
  }

  const repeatCustomer = f.topShortageCustomers.find((c) => c.demandCount >= T.repeatShortageLines);
  if (repeatCustomer) {
    out.push(
      makeFinding(id, {
        key: `customer-shortage:${repeatCustomer.customerName}`,
        topic: `customer-shortage:${repeatCustomer.customerName}`,
        tag: "customer",
        title: `Repeatedly short-supplied: ${repeatCustomer.customerName}`,
        finding: `${repeatCustomer.customerName} could not be fully supplied on ${plural(repeatCustomer.demandCount, "occasion")}.`,
        evidence: [ev("Customer", repeatCustomer.customerName), ev("Shortage records", String(repeatCustomer.demandCount)), ev("Rule parameter", `flag at ${T.repeatShortageLines}+`)],
        businessImpact: "A customer who is regularly short-supplied is exposed to a competitor.",
        recommendedAction: "Agree with the customer which products matter most and prioritise stock for them, or set expectations on lead time.",
        responsibleFunction: "SALES",
        priority: "HIGH",
        expectedOutcome: "Fewer shortage records for this customer.",
        measurement: "Shortage records for this customer, same period length.",
        links: [link("Lost sales analytics", "/lost-sales/analytics")],
      })
    );
  }

  if (f.openClaimCount > 0 && f.underDisputeByCurrency.length > 0) {
    out.push(
      makeFinding(id, {
        key: "under-dispute",
        topic: "claims-under-dispute",
        tag: "financial",
        title: "Value is tied up in claims not yet decided",
        finding: `${plural(f.openClaimCount, "open claim")} hold${f.openClaimCount === 1 ? "s" : ""} disputed value that is neither lost nor recovered yet.`,
        evidence: [...f.underDisputeByCurrency.map((m) => ev(`Under dispute (${m.currency})`, formatMoney(m.value, m.currency))), ev("Open claims", String(f.openClaimCount))],
        businessImpact: "Until a claim is decided the business cannot say whether this revenue is kept, credited or lost.",
        recommendedAction: "Decide the oldest open claims first, and record the outcome so the amount moves to recovered or lost.",
        responsibleFunction: "FINANCE",
        priority: f.openClaimCount >= T.minSample ? "HIGH" : "MEDIUM",
        expectedOutcome: "Open claims reach a recorded decision.",
        measurement: "Open claim count and under-dispute value at the next weekly review.",
        links: [link("Invoice claims", "/invoice-claims"), link("Invoice claims and exposure report", "/reports/management/invoice-claims-exposure")],
      })
    );
  }

  const r = reasonFindings(id, f.reasons, f.claimCount);
  out.push(...r.findings);
  if (r.gap) gaps.push(r.gap);

  if (f.demandsWithoutPrice > 0 || f.linesWithoutPrice > 0) {
    out.push(
      makeFinding(id, {
        key: "unpriced-records",
        topic: "unpriced-records",
        tag: "financial",
        title: "Some lost-sales records cannot be valued",
        finding: `${f.demandsWithoutPrice} unfulfilled demand record(s) and ${f.linesWithoutPrice} claim line(s) have no usable price, so the value figures leave them out.`,
        evidence: [ev("Demand records without a price", String(f.demandsWithoutPrice)), ev("Claim lines without a price", String(f.linesWithoutPrice))],
        businessImpact: "Reported value is understated by whatever these records are worth.",
        recommendedAction: "Add the missing prices to the product master or the order lines so future figures are complete.",
        responsibleFunction: "SALES",
        priority: "LOW",
        expectedOutcome: "Fewer records excluded from value.",
        measurement: "Count of records without a price.",
        links: [link("Lost sales analytics", "/lost-sales/analytics")],
      })
    );
  }
  return finishIntelligence(id, out, gaps, out.length === 0 && gaps.length === 0);
}

// ---------------------------------------------------------------------------
// 8. Invoice claims and exposure
// ---------------------------------------------------------------------------
export type ClaimsExposureFacts = {
  claimCount: number;
  openClaimCount: number;
  underDisputeByCurrency: { currency: string; value: string }[];
  approvedNotYetCreditedByCurrency: { currency: string; value: string }[];
  unclassifiedConcludedByCurrency: { currency: string; value: string }[];
  claimsWhereCreditExceedsDisputed: number;
  creditNotesPendingCount: number;
  returnsAwaitingResolution: number;
  averageResolutionDays: number | null;
  repeatComplaintCustomers: { customerName: string; claimCount: number }[];
  reasons: ReasonFact[];
};

const money = (m: { currency: string; value: string }[]): EvidenceItem[] => m.map((x) => ev(x.currency, formatMoney(x.value, x.currency)));

export function buildInvoiceClaimsIntelligence(f: ClaimsExposureFacts): ManagementIntelligence {
  const id = "invoice-claims-exposure";
  const out: ManagementFinding[] = [];
  const gaps: string[] = [];
  if (f.claimCount === 0 && f.creditNotesPendingCount === 0 && f.returnsAwaitingResolution === 0) return finishIntelligence(id, [], [], true);

  if (f.creditNotesPendingCount > 0) {
    out.push(
      makeFinding(id, {
        key: "credit-notes-pending",
        topic: "credit-notes-pending",
        tag: "financial",
        title: "Approved credits have not been issued",
        finding: `${plural(f.creditNotesPendingCount, "approved claim")} ${f.creditNotesPendingCount === 1 ? "has" : "have"} no credit note recorded yet.`,
        evidence: [ev("Claims awaiting a credit note", String(f.creditNotesPendingCount)), ...money(f.approvedNotYetCreditedByCurrency).map((e) => ({ label: `Approved, not yet credited (${e.label})`, value: e.value }))],
        businessImpact: "The customer is owed the credit and the books overstate receivables until it is posted.",
        recommendedAction: "Raise the credit notes in SAP for the approved claims and record them against the claims.",
        responsibleFunction: "FINANCE",
        priority: f.creditNotesPendingCount >= T.minSample ? "HIGH" : "MEDIUM",
        expectedOutcome: "Every approved claim has a credit note recorded.",
        measurement: "Claims awaiting a credit note at the next weekly review.",
        links: [link("Invoice claims", "/invoice-claims")],
      })
    );
  }

  if (f.claimsWhereCreditExceedsDisputed > 0) {
    out.push(
      makeFinding(id, {
        key: "credit-exceeds-disputed",
        topic: "credit-exceeds-disputed",
        tag: "financial",
        title: "Credit issued is larger than the disputed value",
        finding: `${plural(f.claimsWhereCreditExceedsDisputed, "claim")} ${f.claimsWhereCreditExceedsDisputed === 1 ? "has" : "have"} more credited than was disputed.`,
        evidence: [ev("Claims affected", String(f.claimsWhereCreditExceedsDisputed))],
        businessImpact: "Over-crediting gives money away; it may also mean the disputed value is missing a line.",
        recommendedAction: "Compare each credit note with the claim lines and either correct the credit or add the missing claim line.",
        responsibleFunction: "FINANCE",
        priority: "HIGH",
        expectedOutcome: "Credit and disputed value agree, or the difference is explained.",
        measurement: "Claims where credit exceeds disputed value.",
        links: [link("Invoice claims", "/invoice-claims")],
      })
    );
  }

  if (f.unclassifiedConcludedByCurrency.length > 0) {
    out.push(
      makeFinding(id, {
        key: "concluded-unclassified",
        topic: "concluded-unclassified",
        tag: "financial",
        title: "Concluded claims do not say whether the sale was kept",
        finding: "Some claims were concluded without a recorded outcome that shows whether the value was kept or lost.",
        evidence: money(f.unclassifiedConcludedByCurrency).map((e) => ({ label: `Disputed value (${e.label})`, value: e.value })),
        businessImpact: "These amounts cannot be counted as recovered or lost, so the lost-sales picture is incomplete.",
        recommendedAction: "Open each concluded claim and record the resolution decision.",
        responsibleFunction: "MANAGEMENT",
        priority: "MEDIUM",
        expectedOutcome: "Concluded claims all carry a classifying outcome.",
        measurement: "Disputed value in the concluded, unclassified bucket.",
        links: [link("Invoice claims", "/invoice-claims")],
      })
    );
  }

  if (f.returnsAwaitingResolution > 0) {
    out.push(
      makeFinding(id, {
        key: "returns-awaiting",
        topic: "returns-awaiting",
        tag: "operational",
        title: "Returned goods are waiting for a decision",
        finding: `${plural(f.returnsAwaitingResolution, "claim")} with returned goods ${f.returnsAwaitingResolution === 1 ? "has" : "have"} not been resolved.`,
        evidence: [ev("Claims with unresolved returns", String(f.returnsAwaitingResolution))],
        businessImpact: "Returned produce loses value daily; unresolved returns also hold up the credit.",
        recommendedAction: "Inspect the returned goods, record their condition, and resolve the claim so resalable stock goes back on sale.",
        responsibleFunction: "WAREHOUSE",
        priority: "HIGH",
        expectedOutcome: "Returns inspected and resolved quickly.",
        measurement: "Claims with unresolved returns.",
        links: [link("Invoice claims", "/invoice-claims")],
      })
    );
  }

  if (f.averageResolutionDays !== null && f.averageResolutionDays > T.slowClaimResolutionDays && f.claimCount >= T.minSample) {
    out.push(
      makeFinding(id, {
        key: "slow-resolution",
        topic: "slow-claim-resolution",
        tag: "operational",
        title: "Claims are taking a long time to resolve",
        finding: `Resolved claims took ${f.averageResolutionDays.toFixed(1)} days on average.`,
        evidence: [ev("Average resolution", `${f.averageResolutionDays.toFixed(1)} days`), ev("Claims", String(f.claimCount)), ev("Rule parameter", `flag above ${T.slowClaimResolutionDays} days`)],
        businessImpact: "Slow resolution frustrates customers and keeps value in dispute.",
        recommendedAction: "Find where claims wait (investigation, customer reply, internal action) and put an owner on the longest wait.",
        responsibleFunction: "MANAGEMENT",
        priority: "MEDIUM",
        expectedOutcome: "A shorter average resolution time.",
        measurement: "Average resolution days.",
        links: [link("Invoice claims dashboard", "/invoice-claims/dashboard")],
      })
    );
  }

  for (const c of f.repeatComplaintCustomers) {
    if (c.claimCount < T.repeatCustomerClaims) continue;
    out.push(
      makeFinding(id, {
        key: `customer-claims:${c.customerName}`,
        topic: `customer-claims:${c.customerName}`,
        tag: "customer",
        title: `Repeat claims: ${c.customerName}`,
        finding: `${c.customerName} has raised ${plural(c.claimCount, "claim")}.`,
        evidence: [ev("Customer", c.customerName), ev("Claims", String(c.claimCount)), ev("Rule parameter", `flag at ${T.repeatCustomerClaims}+`)],
        businessImpact: "Repeated claims from one customer signal a service problem that will recur until the cause is fixed.",
        recommendedAction: "Review this customer's claims together, find what they have in common, and agree a fix with the customer.",
        responsibleFunction: "SALES",
        priority: "HIGH",
        expectedOutcome: "Fewer new claims from this customer.",
        measurement: "New claims from this customer in the next period.",
        links: [link("Invoice claims", "/invoice-claims")],
      })
    );
  }

  const r = reasonFindings(id, f.reasons, f.claimCount);
  out.push(...r.findings);
  if (r.gap) gaps.push(r.gap);
  return finishIntelligence(id, out, gaps, out.length === 0 && gaps.length === 0);
}

// ---------------------------------------------------------------------------
// 9. Communication failures
// ---------------------------------------------------------------------------
export type CommunicationFacts = {
  failedCount: number;
  ordersWithFailedOutbound: number;
  deliveryExceptionsWithNoSuccessfulNotification: number;
  topChannel: { key: string; count: number } | null;
  topType: { key: string; count: number } | null;
  repeatedlyRetried: number;
};

export function buildCommunicationFailuresIntelligence(f: CommunicationFacts): ManagementIntelligence {
  const id = "communication-failures";
  if (f.failedCount === 0 && f.deliveryExceptionsWithNoSuccessfulNotification === 0) return finishIntelligence(id, [], [], true);
  const out: ManagementFinding[] = [];
  if (f.failedCount > 0) {
    const finding = failedMessagesFinding(id, f.failedCount, f.ordersWithFailedOutbound, f.deliveryExceptionsWithNoSuccessfulNotification);
    if (f.topChannel && f.failedCount >= T.minSample && (f.topChannel.count / f.failedCount) * 100 >= T.statusConcentrationPercent) {
      finding.evidence.push(ev("Most failures on", `${f.topChannel.key} (${f.topChannel.count} of ${f.failedCount})`));
      finding.recommendedAction = `${finding.recommendedAction} Most failures are on ${f.topChannel.key}, so check that channel's connection first.`;
    }
    if (f.topType) finding.evidence.push(ev("Most common message type", `${f.topType.key} (${f.topType.count})`));
    if (f.repeatedlyRetried > 0) finding.evidence.push(ev("Messages already retried more than once", String(f.repeatedlyRetried)));
    out.push(finding);
  }
  if (f.deliveryExceptionsWithNoSuccessfulNotification > 0) {
    out.push(
      makeFinding(id, {
        key: "exceptions-not-notified",
        topic: "exceptions-not-notified",
        tag: "customer",
        title: "Customers with a delivery problem were not told",
        finding: `${plural(f.deliveryExceptionsWithNoSuccessfulNotification, "delivery exception")} ${f.deliveryExceptionsWithNoSuccessfulNotification === 1 ? "has" : "have"} no successful customer notification.`,
        evidence: [ev("Exceptions with no successful notification", String(f.deliveryExceptionsWithNoSuccessfulNotification))],
        businessImpact: "A customer who learns of a problem late, or from someone else, is more likely to dispute it.",
        recommendedAction: "Contact each affected customer directly today and record that they have been told.",
        responsibleFunction: "SALES",
        priority: "HIGH",
        expectedOutcome: "No delivery exception without a confirmed customer notification.",
        measurement: "Delivery exceptions with no successful notification.",
        links: [link("Delivery exceptions report", "/reports/management/delivery-exceptions")],
      })
    );
  }
  return finishIntelligence(id, out, [], out.length === 0);
}
