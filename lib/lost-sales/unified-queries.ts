import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reporting/types";
import { dateRangeToDateOnlyFilter, dateRangeToTimestampFilter, demoWhere } from "@/lib/reporting/filters";
import { computeClaimLineDisputedValue } from "@/lib/invoice-claims/financial";
import { resolveEffectiveLostValue } from "@/lib/lost-sales/effective-value";
import { listDeliveryReturnRows } from "@/lib/lost-sales/delivery-returns";
import { parseScaledDecimal } from "@/lib/picking/validation";
import { formatScaledDecimal } from "@/lib/fulfilment/decimal";
import {
  aggregateUnifiedLostSales,
  buildReasonBreakdown,
  type ClaimFact,
  type ClaimLineFact,
  type DemandFact,
  type ReasonBreakdown,
  type ReturnLossFact,
  type UnifiedLostSales,
} from "@/lib/lost-sales/unified-core";

/**
 * Server side of the unified lost-sales / claim-reason analytics: fetches
 * REAL records and hands them to lib/lost-sales/unified-core.ts, which does
 * all the arithmetic. Nothing is calculated here that the core does not
 * also own, so every page and every recommendation shares one set of rules.
 *
 * Filters honoured: includeDemo, dateFrom/dateTo (InvoiceClaim.claimDate for
 * claims, UnfulfilledDemand.createdAt for shortages), customerId. Others are
 * ignored, as in the other claim analytics.
 *
 * Source-of-truth per figure:
 *   disputed value   rejectedQuantity x the REAL invoice unit price
 *                    (computeClaimLineDisputedValue / same price rule as
 *                    lib/invoice-claims/financial.ts); AMOUNT_ONLY lines use
 *                    the recorded disputedAmount. The customer's own
 *                    disputedUnitPrice is never used.
 *   currency         the claim's SAP invoice currency, else the order's
 *                    currency; "UNKNOWN" is reported as such, never guessed.
 *   credited         sum of CreditNote.amount recorded against the claim.
 *   returned         sum of ClaimReturn.receivedQuantity for the line.
 *   confirmed loss   ClaimReturnLostSale rows (existing return-condition
 *                    rule) and UnfulfilledDemand.confirmedLostQuantity.
 */

const MAX_CLAIMS = 5000;

export type ClaimFacts = { lines: ClaimLineFact[]; claims: ClaimFact[]; returnLosses: ReturnLossFact[]; truncated: boolean };

function dec(value: { toDecimalPlaces: (n: number) => { toString: () => string } } | null | undefined): string | null {
  return value ? value.toDecimalPlaces(4).toString() : null;
}

function sum(values: (string | null)[]): string {
  let total = BigInt(0);
  for (const v of values) total += v ? (parseScaledDecimal(v) ?? BigInt(0)) : BigInt(0);
  return formatScaledDecimal(total);
}

export async function loadClaimFacts(filters: Pick<ReportFilters, "includeDemo" | "dateFrom" | "dateTo" | "customerId">): Promise<ClaimFacts> {
  const dateFilter = dateRangeToDateOnlyFilter(filters);
  const claims = await prisma.invoiceClaim.findMany({
    where: {
      ...demoWhere(filters),
      ...(Object.keys(dateFilter).length > 0 ? { claimDate: dateFilter } : {}),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    take: MAX_CLAIMS + 1,
    orderBy: { claimDate: "desc" },
    select: {
      id: true,
      claimReference: true,
      claimDate: true,
      status: true,
      customerId: true,
      customer: { select: { name: true } },
      deliveryRecordId: true,
      sapInvoice: { select: { currencyCode: true } },
      order: { select: { currency: true } },
      creditNotes: { select: { amount: true } },
      resolutions: { select: { decision: true, approvedCreditAmount: true, approvedById: true, rejectedById: true, recordedAt: true }, orderBy: { recordedAt: "desc" } },
      returnLostSales: { select: { currencyCode: true, estimatedValue: true, claimReturn: { select: { receivedQuantity: true, claimLine: { select: { orderLineId: true, sapInvoiceLine: { select: { unitOfMeasure: true, matchedOrderLineId: true } }, orderLine: { select: { requestedUnitCode: true } } } } } } } },
      lines: {
        select: {
          id: true,
          disputeType: true,
          rejectedQuantity: true,
          disputedAmount: true,
          reasonCategory: true,
          sapItemCodeSnapshot: true,
          sapItemDescriptionSnapshot: true,
          deliveryLineId: true,
          sapInvoiceLine: { select: { unitPrice: true, unitOfMeasure: true } },
          orderLine: { select: { requestedUnitCode: true, approvedUnitPrice: true, customerUnitPrice: true } },
          returns: { select: { receivedQuantity: true } },
        },
      },
    },
  });

  const truncated = claims.length > MAX_CLAIMS;
  const lines: ClaimLineFact[] = [];
  const claimFacts: ClaimFact[] = [];
  const returnLosses: ReturnLossFact[] = [];

  // Goods returned through Record Delivery: the primary, automatic source of
  // "returned" and of Confirmed Loss (Returned Goods).
  const range = dateRangeToTimestampFilter(filters);
  const deliveryReturns = await listDeliveryReturnRows({ includeDemo: filters.includeDemo ?? false, customerId: filters.customerId, dateRange: range });
  const deliveryCoveredOrderLineIds = new Set(deliveryReturns.rows.map((row) => row.orderLineId));

  for (const claim of claims.slice(0, MAX_CLAIMS)) {
    const currency = claim.sapInvoice?.currencyCode ?? claim.order?.currency ?? "UNKNOWN";
    const claimDate = claim.claimDate.toISOString().slice(0, 10);

    for (const line of claim.lines) {
      // same real-price rule as lib/invoice-claims/financial.ts
      const realUnitPrice = line.sapInvoiceLine ? line.sapInvoiceLine.unitPrice : line.orderLine?.approvedUnitPrice ?? line.orderLine?.customerUnitPrice ?? null;
      const value = computeClaimLineDisputedValue(line, { unitPrice: realUnitPrice });
      lines.push({
        claimId: claim.id,
        claimLineId: line.id,
        claimDate,
        claimStatus: claim.status,
        customerId: claim.customerId,
        customerName: claim.customer.name,
        productKey: line.sapItemCodeSnapshot ?? `__desc__${line.sapItemDescriptionSnapshot ?? "unknown"}`,
        sapItemCode: line.sapItemCodeSnapshot,
        description: line.sapItemDescriptionSnapshot,
        unit: line.sapInvoiceLine?.unitOfMeasure ?? line.orderLine?.requestedUnitCode ?? null,
        reasonCategory: line.reasonCategory,
        disputeType: line.disputeType as "QUANTITY" | "AMOUNT_ONLY",
        rejectedQuantity: dec(line.rejectedQuantity),
        // A claim line created from a delivery outcome IS a returned line: the
        // rejected goods came back with the delivery. Manual lines keep using
        // the recorded ClaimReturn receipts.
        returnedQuantity: line.deliveryLineId ? (dec(line.rejectedQuantity) ?? "0") : sum(line.returns.map((r) => r.receivedQuantity.toDecimalPlaces(4).toString())),
        value,
        currency,
      });
    }

    // only an approved, not-rejected resolution can classify the outcome
    const decisive = claim.resolutions.filter((r) => r.rejectedById === null);
    claimFacts.push({
      claimId: claim.id,
      claimReference: claim.claimReference,
      status: claim.status,
      currency,
      customerId: claim.customerId,
      customerName: claim.customer.name,
      creditedAmount: sum(claim.creditNotes.map((c) => c.amount.toDecimalPlaces(4).toString())),
      approvedCreditAmount: sum(claim.resolutions.filter((r) => r.approvedById !== null && r.rejectedById === null).map((r) => dec(r.approvedCreditAmount))),
      latestDecision: decisive[0]?.decision ?? null,
    });

    // Legacy manual return losses: skipped when the units are already counted
    // from the delivery outcome (claim created from a delivery, or the claimed
    // order line has a delivery rejection) -- see lib/lost-sales/delivery-returns.ts.
    for (const loss of claim.deliveryRecordId ? [] : claim.returnLostSales) {
      const claimedOrderLineId = loss.claimReturn.claimLine?.orderLineId ?? loss.claimReturn.claimLine?.sapInvoiceLine?.matchedOrderLineId ?? null;
      if (claimedOrderLineId && deliveryCoveredOrderLineIds.has(claimedOrderLineId)) continue;
      returnLosses.push({
        claimId: claim.id,
        currency: loss.currencyCode ?? currency,
        unit: loss.claimReturn.claimLine?.sapInvoiceLine?.unitOfMeasure ?? loss.claimReturn.claimLine?.orderLine?.requestedUnitCode ?? null,
        quantity: loss.claimReturn.receivedQuantity.toDecimalPlaces(4).toString(),
        value: dec(loss.estimatedValue),
      });
    }
  }

  for (const row of deliveryReturns.rows) {
    returnLosses.push({
      claimId: row.claimId ?? `delivery:${row.deliveryRecordId}`,
      currency: row.currencyCode,
      unit: row.unitOfMeasure,
      quantity: row.returnedQuantity,
      value: row.totalValue,
    });
  }

  return { lines, claims: claimFacts, returnLosses, truncated: truncated || deliveryReturns.truncated };
}

export async function loadDemandFacts(filters: Pick<ReportFilters, "includeDemo" | "dateFrom" | "dateTo" | "customerId">): Promise<DemandFact[]> {
  const range = dateRangeToTimestampFilter(filters);
  const demands = await prisma.unfulfilledDemand.findMany({
    where: {
      ...demoWhere(filters),
      status: { not: "SUPERSEDED" },
      ...(Object.keys(range).length > 0 ? { createdAt: range } : {}),
      ...(filters.customerId ? { customerId: filters.customerId } : {}),
    },
    select: {
      id: true,
      orderId: true,
      customerId: true,
      customer: { select: { name: true } },
      productId: true,
      sapItemCodeSnapshot: true,
      productDescriptionSnapshot: true,
      unavailableQuantity: true,
      confirmedLostQuantity: true,
      estimatedUnitPrice: true,
      estimatedValue: true,
      orderLine: { select: { requestedUnitCode: true, approvedUnitPrice: true, customerUnitPrice: true } },
    },
  });
  return demands.map((d) => {
    // same price resolution the existing lost-sales value uses
    const effective = resolveEffectiveLostValue({
      storedUnitPrice: d.estimatedUnitPrice?.toString() ?? null,
      storedValue: d.estimatedValue?.toString() ?? null,
      lineApprovedUnitPrice: d.orderLine?.approvedUnitPrice?.toString() ?? null,
      lineCustomerUnitPrice: d.orderLine?.customerUnitPrice?.toString() ?? null,
      quantity: d.unavailableQuantity.toString(),
    });
    return {
      id: d.id,
      orderId: d.orderId,
      customerId: d.customerId,
      customerName: d.customer.name,
      productKey: d.sapItemCodeSnapshot ?? d.productId ?? `__desc__${d.productDescriptionSnapshot}`,
      sapItemCode: d.sapItemCodeSnapshot,
      description: d.productDescriptionSnapshot,
      unit: d.orderLine?.requestedUnitCode ?? null,
      unavailableQuantity: d.unavailableQuantity.toDecimalPlaces(4).toString(),
      confirmedLostQuantity: d.confirmedLostQuantity.toDecimalPlaces(4).toString(),
      estimatedUnitPrice: effective.unitPrice,
      estimatedValue: effective.value,
    };
  });
}

export type UnifiedLostSalesReport = { unified: UnifiedLostSales; reasons: ReasonBreakdown; demands: DemandFact[]; claimFacts: ClaimFacts; truncated: boolean };

/** The one entry point every page, recommendation and the Action Centre reads. */
export async function getUnifiedLostSalesReport(filters: Pick<ReportFilters, "includeDemo" | "dateFrom" | "dateTo" | "customerId">): Promise<UnifiedLostSalesReport> {
  const [claimFacts, demands] = await Promise.all([loadClaimFacts(filters), loadDemandFacts(filters)]);
  return {
    unified: aggregateUnifiedLostSales({ claimLines: claimFacts.lines, claims: claimFacts.claims, returnLosses: claimFacts.returnLosses, demands }),
    reasons: buildReasonBreakdown(claimFacts.lines, { from: filters.dateFrom, to: filters.dateTo }),
    demands,
    claimFacts,
    truncated: claimFacts.truncated,
  };
}

export async function getClaimReasonBreakdown(filters: Pick<ReportFilters, "includeDemo" | "dateFrom" | "dateTo" | "customerId">): Promise<{ breakdown: ReasonBreakdown; truncated: boolean }> {
  const facts = await loadClaimFacts(filters);
  return { breakdown: buildReasonBreakdown(facts.lines, { from: filters.dateFrom, to: filters.dateTo }), truncated: facts.truncated };
}
