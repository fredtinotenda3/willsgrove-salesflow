import { parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Milestone 5 (SAP Invoice Reconciliation). Pure, deterministic,
 * deliberately conservative automatic matching -- no @prisma/client
 * import, no I/O; lib/invoice-reconciliation/match-invoice.ts does the
 * database work and calls this with plain data.
 *
 * Spec section 4's central rule: SAP item code is the primary product
 * identity, never description similarity -- this module never reads an
 * item description at all. Section 4 also requires "where automatic
 * matching is ambiguous, send the record to a manual reconciliation
 * queue; do not silently guess" -- every ambiguous case below resolves
 * to `null` (no match), never a best-effort guess.
 */

export interface MatchCandidateOrderLine {
  orderLineId: string;
  orderId: string;
  sapItemCode: string | null; // live Product.sapItemCode, falling back to OrderLine.sapItemCodeSnapshot -- resolved by the caller, never by this module
  authorizedQuantity: string; // PickingLine.foundQuantity from the order's most recently AUTHORIZED session
  alreadyInvoicedQuantity: string; // sum of quantityInvoiced across this line's already-matched, non-cancelled SapInvoiceLines (running tally -- see match-invoice.ts)
}

export interface MatchCandidateOrder {
  orderId: string;
  /** True when the invoice's own orderReference/sapOrderReference field
   * exactly equalled this order's reference or customerPoReference --
   * the strong signal that narrows matching scope to this order alone. */
  referenceMatches: boolean;
  lines: MatchCandidateOrderLine[];
}

export interface AutoMatchResult {
  orderId: string;
  orderLineId: string;
  /** True when this line's own invoiced quantity pushes the order line's
   * cumulative invoiced quantity past its authorized quantity -- the
   * match still proceeds (quantity is never silently capped or the match
   * silently refused once identity is unambiguous), but the invoice this
   * line belongs to must be flagged RECONCILIATION_REQUIRED rather than
   * MATCHED. See lib/invoice-reconciliation/reconcile.ts. */
  causesOverInvoicing: boolean;
  note: string;
}

/**
 * Attempts to match one invoice line (identified only by its SAP item
 * code) against the candidate order lines of the one customer this
 * invoice's header resolved to.
 *
 * Returns null (left UNMATCHED, for the manual reconciliation queue)
 * when:
 *  - the invoice line has no SAP item code at all;
 *  - no candidate order line shares that exact SAP item code with
 *    remaining capacity (authorized > already-invoiced) at this point;
 *  - more than one candidate order line would otherwise qualify -- this
 *    is the "do not silently guess" case, whether that ambiguity is
 *    across several orders or several lines of the same order.
 *
 * When the invoice's header has a reference match, only that order's
 * lines are ever considered -- an item code that happens to also appear,
 * coincidentally, on a different order is never used to override an
 * explicit reference.
 */
export function matchInvoiceLineToOrder(
  invoiceLineSapItemCode: string | null,
  invoiceLineQuantity: string,
  candidateOrders: MatchCandidateOrder[]
): AutoMatchResult | null {
  if (!invoiceLineSapItemCode) return null;

  const referenceOrders = candidateOrders.filter((order) => order.referenceMatches);
  const scopeOrders = referenceOrders.length > 0 ? referenceOrders : candidateOrders;

  const qualifying: { orderId: string; orderLineId: string; remaining: bigint }[] = [];

  for (const order of scopeOrders) {
    for (const line of order.lines) {
      if (line.sapItemCode !== invoiceLineSapItemCode) continue;

      const authorized = parseScaledDecimal(line.authorizedQuantity);
      const alreadyInvoiced = parseScaledDecimal(line.alreadyInvoicedQuantity);
      if (authorized === null || alreadyInvoiced === null) continue;

      const remaining = authorized - alreadyInvoiced;
      if (remaining <= BigInt(0)) continue; // already fully/over-invoiced -- never auto-extend, leave for manual review

      qualifying.push({ orderId: order.orderId, orderLineId: line.orderLineId, remaining });
    }
  }

  if (qualifying.length !== 1) return null;

  const chosen = qualifying[0];
  const invoicedQty = parseScaledDecimal(invoiceLineQuantity);
  const causesOverInvoicing = invoicedQty === null ? false : invoicedQty > chosen.remaining;

  return {
    orderId: chosen.orderId,
    orderLineId: chosen.orderLineId,
    causesOverInvoicing,
    note: referenceOrders.length > 0
      ? `Matched by SAP item code ${invoiceLineSapItemCode} within the order identified by the invoice's own order reference.`
      : `Matched by SAP item code ${invoiceLineSapItemCode} -- the only outstanding order line for this customer carrying that code.`,
  };
}
