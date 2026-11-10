import { parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Milestone 5 (SAP Invoice Reconciliation). Pure quantity math and status
 * derivation -- no @prisma/client import, no I/O. Reuses the same
 * scaled-BigInt decimal arithmetic as lib/picking/validation.ts (imported
 * directly, not copied -- the exact choice Milestone 4's
 * lib/lost-sales/validation.ts already made for the same reason: this is
 * byte-for-byte the same arithmetic, so DRY/KISS wins over a second copy).
 */

export type OrderLineInvoiceStatusValue =
  | "NOT_YET_INVOICED"
  | "PARTIALLY_INVOICED"
  | "FULLY_INVOICED"
  | "OVER_INVOICED";

export interface OrderLineReconciliation {
  authorizedQuantity: string;
  invoicedQuantity: string;
  remainingQuantity: string; // authorized - invoiced; negative when over-invoiced
  status: OrderLineInvoiceStatusValue;
}

/**
 * Spec section 5's four worked examples, implemented exactly:
 *   A. authorized 20, invoiced 20 -> remaining 0, FULLY_INVOICED
 *   B. authorized 20, invoiced 12 -> remaining 8, PARTIALLY_INVOICED
 *   C. authorized 20, invoiced 0  -> remaining 20, NOT_YET_INVOICED
 *   D. authorized 20, invoiced 23 -> remaining -3, OVER_INVOICED
 *
 * Never silently changes authorizedQuantity to match invoicedQuantity,
 * and never clamps a negative remainder back to zero -- an over-invoiced
 * discrepancy must stay visibly negative, not be hidden by clamping.
 */
export function computeOrderLineReconciliation(
  authorizedQuantityRaw: string,
  invoicedQuantityRaw: string
): OrderLineReconciliation | null {
  const authorized = parseScaledDecimal(authorizedQuantityRaw);
  const invoiced = parseScaledDecimal(invoicedQuantityRaw);
  if (authorized === null || invoiced === null) return null;

  const remaining = authorized - invoiced;
  const remainingQuantity = formatSignedScaled(remaining);

  let status: OrderLineInvoiceStatusValue;
  if (remaining < BigInt(0)) {
    status = "OVER_INVOICED";
  } else if (invoiced === BigInt(0)) {
    status = "NOT_YET_INVOICED";
  } else if (remaining === BigInt(0)) {
    status = "FULLY_INVOICED";
  } else {
    status = "PARTIALLY_INVOICED";
  }

  return { authorizedQuantity: authorizedQuantityRaw, invoicedQuantity: invoicedQuantityRaw, remainingQuantity, status };
}

// parseScaledDecimal/formatScaledDecimal (lib/picking/validation.ts and
// lib/lost-sales/validation.ts) are both non-negative-only by design --
// this milestone is the first place a legitimately NEGATIVE scaled value
// (an over-invoiced remainder) needs formatting back to a decimal
// string, so that one extra case is handled locally rather than widening
// either shared helper's contract for every one of its other callers.
function formatSignedScaled(scaled: bigint): string {
  const negative = scaled < BigInt(0);
  const magnitude = negative ? -scaled : scaled;
  const digits = magnitude.toString().padStart(5, "0");
  const whole = digits.slice(0, -4);
  const fraction = digits.slice(-4);
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

export type InvoiceReconciliationStatusValue =
  | "UNMATCHED"
  | "PARTIALLY_MATCHED"
  | "RECONCILIATION_REQUIRED"
  | "MATCHED"
  | "CANCELLED_REVERSED";

export interface InvoiceLineStateForStatus {
  matchStatus: "UNMATCHED" | "AUTO_MATCHED" | "MANUALLY_MATCHED" | "CANNOT_LINK";
  /** True when this matched line's order line is itself OVER_INVOICED
   * once this line's quantity is included -- surfaces as an invoice-level
   * exception even though every line has technically been "matched." */
  causesOverInvoicing?: boolean;
}

/**
 * Invoice-HEADER status. Cancelled/reversed always wins (spec section 6:
 * cancelled invoices "must not continue contributing to valid invoiced
 * quantities" -- but the record itself stays visible, flagged, never
 * deleted). Otherwise derived purely from the set of this invoice's own
 * lines' resolution state -- never confused with order-line status
 * (computeOrderLineReconciliation above), per the spec's explicit
 * instruction to keep the two separate.
 */
export function deriveInvoiceReconciliationStatus(
  lines: InvoiceLineStateForStatus[],
  isCancelledOrReversed: boolean
): InvoiceReconciliationStatusValue {
  if (isCancelledOrReversed) return "CANCELLED_REVERSED";
  if (lines.length === 0) return "RECONCILIATION_REQUIRED";

  const anyOverInvoicing = lines.some((line) => line.causesOverInvoicing);
  if (anyOverInvoicing) return "RECONCILIATION_REQUIRED";

  const allUnmatched = lines.every((line) => line.matchStatus === "UNMATCHED");
  if (allUnmatched) return "UNMATCHED";

  const anyStillUnmatched = lines.some((line) => line.matchStatus === "UNMATCHED");
  if (anyStillUnmatched) return "PARTIALLY_MATCHED";

  return "MATCHED";
}
