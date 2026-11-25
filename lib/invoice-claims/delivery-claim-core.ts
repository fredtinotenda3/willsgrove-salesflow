import { CLAIM_LINE_REASON_CATEGORIES, CLAIM_LINE_REASON_CATEGORY_LABELS, type ClaimLineReasonCategory } from "@/lib/invoice-claims/validation";

/**
 * Pure rules for turning a Record Delivery outcome into an invoice claim.
 * No Prisma, no I/O -- unit testable without a database.
 *
 * Source of truth: DeliveryLine (accepted / rejected quantity + reason) is the
 * ONLY place a returned quantity is stored. Everything here derives from it;
 * nothing invents a second quantity.
 */

/** Claim-header category used when the rejected lines carry more than one standard reason (or none). */
export const MIXED_REASON_HEADER_CATEGORY = "CUSTOMER_REJECTION" as const;

const LABEL_TO_CATEGORY: ReadonlyMap<string, ClaimLineReasonCategory> = new Map(
  CLAIM_LINE_REASON_CATEGORIES.flatMap((category) => [
    [CLAIM_LINE_REASON_CATEGORY_LABELS[category].trim().toLowerCase(), category] as const,
    [category.toLowerCase(), category] as const,
  ])
);

/**
 * Maps the free-text DeliveryLine.rejectionReason (the Record Delivery screen
 * stores the standardised LABEL, e.g. "Poor Quality Product"; older rows may
 * hold the identifier or free text) to the standardised claim-line category.
 * Anything unrecognised returns null -- it is never forced into a wrong
 * category; the original text is preserved on the claim line's `reason`.
 */
export function mapRejectionReasonToCategory(raw: string | null | undefined): ClaimLineReasonCategory | null {
  const key = raw?.trim().toLowerCase();
  if (!key) return null;
  return LABEL_TO_CATEGORY.get(key) ?? null;
}

/** Claim-header category: the single standard reason when every rejected line agrees, otherwise a customer rejection. */
export function deriveClaimHeaderCategory(lineCategories: ReadonlyArray<ClaimLineReasonCategory | null>): ClaimLineReasonCategory | typeof MIXED_REASON_HEADER_CATEGORY {
  const distinct = new Set(lineCategories);
  if (distinct.size === 1) {
    const only = [...distinct][0];
    if (only) return only;
  }
  return MIXED_REASON_HEADER_CATEGORY;
}

export type DeliveryClaimSourceLine = {
  deliveryLineId: string;
  orderLineId: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  rejectionReason: string | null;
};

/** True when the quantity string is a strictly positive decimal. Quantities come from NUMERIC(18,4) columns. */
export function isPositiveQuantity(value: string): boolean {
  return /^\d+(\.\d+)?$/.test(value) && /[1-9]/.test(value);
}

/** Only lines with a rejected quantity > 0 become claim lines; fully accepted lines never do. */
export function selectRejectedLines<T extends { rejectedQuantity: string }>(lines: readonly T[]): T[] {
  return lines.filter((line) => isPositiveQuantity(line.rejectedQuantity));
}
