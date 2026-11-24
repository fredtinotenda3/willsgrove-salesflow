import "server-only";
import { prisma } from "@/lib/prisma";
import { computeClaimLineDisputedValue } from "@/lib/invoice-claims/financial";
import {
  aggregateClaimComposition,
  type ClaimCompositionInputLine,
  type ClaimCompositionRow,
  type ClaimCompositionSummary,
} from "@/lib/invoice-claims/composition";
import { formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Loads the claim lines in scope and aggregates them with
 * aggregateClaimComposition (see that file for every definition). One
 * query -- the aggregation happens in memory over claim LINES (bounded by
 * claim volume, same trade-off lib/invoice-claims/financial.ts documents),
 * with a hard row cap that is surfaced as `truncated` rather than hidden.
 */

const MAX_CLAIM_LINES = 20_000;

export type ClaimCompositionReport = {
  rows: ClaimCompositionRow[];
  summary: ClaimCompositionSummary;
  truncated: boolean;
};

/** Claim statuses after which nothing further is expected -- same set lib/invoice-claims/invoice-claim-state.ts treats as terminal. */
export const TERMINAL_CLAIM_STATUSES = ["RESOLVED", "REJECTED", "CLOSED"] as const;

export async function getClaimComposition(options: { includeDemo?: boolean; topProducts?: number; unresolvedOnly?: boolean } = {}): Promise<ClaimCompositionReport> {
  const demandFilter = {
    ...(options.includeDemo ? {} : { isDemo: false }),
    // "Unresolved" = the claim has not reached a terminal status. This is
    // the honest basis for "unresolved claims exposure"; the pre-existing
    // exposureByCurrency table sums EVERY claim regardless of status.
    ...(options.unresolvedOnly ? { status: { notIn: [...TERMINAL_CLAIM_STATUSES] } } : {}),
  };

  const lines = await prisma.invoiceClaimLine.findMany({
    where: { claim: demandFilter },
    take: MAX_CLAIM_LINES + 1,
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      disputeType: true,
      acceptedQuantity: true,
      rejectedQuantity: true,
      disputedAmount: true,
      reasonCategory: true,
      sapItemCodeSnapshot: true,
      sapItemDescriptionSnapshot: true,
      sapInvoiceLineId: true,
      sapInvoiceLine: { select: { quantityInvoiced: true, unitOfMeasure: true, unitPrice: true } },
      orderLine: { select: { requestedUnitCode: true, approvedUnitPrice: true, customerUnitPrice: true } },
      returns: { select: { receivedQuantity: true } },
      claim: { select: { sapInvoice: { select: { currencyCode: true } }, order: { select: { currency: true } } } },
    },
  });

  const truncated = lines.length > MAX_CLAIM_LINES;
  const inputs: ClaimCompositionInputLine[] = lines.slice(0, MAX_CLAIM_LINES).map((line) => {
    // Same real-price rule as computeClaimFinancialSummary so the
    // product-level values reconcile with the exposure-by-currency table.
    const realUnitPrice = line.sapInvoiceLine
      ? line.sapInvoiceLine.unitPrice
      : line.orderLine?.approvedUnitPrice ?? line.orderLine?.customerUnitPrice ?? null;
    const value = computeClaimLineDisputedValue(line, { unitPrice: realUnitPrice });

    let returned = BigInt(0);
    for (const r of line.returns) returned += parseScaledDecimal(r.receivedQuantity.toDecimalPlaces(4).toString()) ?? BigInt(0);

    const productKey = line.sapItemCodeSnapshot ?? `__desc__${line.sapItemDescriptionSnapshot ?? "unknown"}`;
    return {
      claimLineId: line.id,
      productKey,
      sapItemCode: line.sapItemCodeSnapshot,
      description: line.sapItemDescriptionSnapshot,
      unit: line.sapInvoiceLine?.unitOfMeasure ?? line.orderLine?.requestedUnitCode ?? null,
      invoiceLineId: line.sapInvoiceLineId,
      deliveredQuantity: line.sapInvoiceLine ? line.sapInvoiceLine.quantityInvoiced.toDecimalPlaces(4).toString() : null,
      acceptedQuantity: line.acceptedQuantity?.toDecimalPlaces(4).toString() ?? null,
      rejectedQuantity: line.rejectedQuantity?.toDecimalPlaces(4).toString() ?? null,
      returnedQuantity: formatScaledDecimal(returned),
      reasonCategory: line.reasonCategory,
      value,
      currency: line.claim.sapInvoice?.currencyCode ?? line.claim.order?.currency ?? "UNKNOWN",
    };
  });

  const { rows, summary } = aggregateClaimComposition(inputs, { topProducts: options.topProducts });
  return { rows, summary, truncated };
}
