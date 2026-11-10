import { z } from "zod";
import { decimalStringSchema, parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Milestone 4 (Lost-Sales Management).
 *
 * Pure validation/arithmetic for the lost-sales workflow -- no
 * @prisma/client import anywhere in this file, deliberately, so it stays
 * statically importable from an unconditional unit test exactly like
 * lib/picking/validation.ts (see that file's own module comment).
 *
 * decimalStringSchema/parseScaledDecimal are IMPORTED from
 * lib/picking/validation.ts rather than duplicated here. This is a
 * deliberate departure from this project's usual "mirror the convention,
 * don't force a shared abstraction across two genuinely different call
 * sites" rule (see lib/assembly-form/resolve-line.ts's own comment for
 * where that rule applies): that rule is about two call sites that
 * resolve the SAME kind of thing into two genuinely DIFFERENT shapes.
 * Scaled-decimal parsing has no shape difference here -- it is the exact
 * same arithmetic, byte-for-byte, that must never be allowed to drift
 * into two subtly different implementations -- so importing the existing,
 * already-tested, read-only function is the simpler and safer choice
 * (DRY/KISS), and carries zero risk to lib/picking/validation.ts since
 * nothing about it is modified.
 */

export const customerDecisionTypeValues = [
  "ACCEPT_PARTIAL_CANCEL_REMAINDER",
  "AWAIT_REMAINING_QUANTITY",
  "SCHEDULE_LATER_SUPPLY",
  "SUBSTITUTE_ACCEPTED",
  "PARTIAL_CANCELLATION",
  "ENTIRE_LINE_CANCELLED",
  "ENTIRE_ORDER_CANCELLED",
] as const;

export type CustomerDecisionTypeValue = (typeof customerDecisionTypeValues)[number];

/**
 * Decision types whose quantity is always "whatever is still undecided
 * right now" -- computed server-side, never caller-supplied. Includes
 * ACCEPT_PARTIAL_CANCEL_REMAINDER: spec outcome 2's worked example
 * ("the customer accepts 12 and cancels the remaining 8") cancels
 * whatever is left outstanding at that moment, mechanically identical to
 * ENTIRE_LINE_CANCELLED -- the two differ only in the narrative framing a
 * salesperson picks (whether there's an "accepted" portion worth naming),
 * never in the bucket arithmetic. PARTIAL_CANCELLATION is the only
 * cancellation-flavored type that takes an explicit, caller-chosen
 * quantity smaller than the full remainder.
 */
export const WHOLE_REMAINDER_DECISION_TYPES = new Set<CustomerDecisionTypeValue>([
  "ACCEPT_PARTIAL_CANCEL_REMAINDER",
  "ENTIRE_LINE_CANCELLED",
  "ENTIRE_ORDER_CANCELLED",
]);

export const decisionSourceValues = [
  "CUSTOMER_PHONE_CALL",
  "CUSTOMER_EMAIL",
  "CUSTOMER_WRITTEN_COMMUNICATION",
  "CUSTOMER_IN_PERSON",
  "CUSTOMER_PORTAL_OR_SYSTEM",
  "SALESPERSON_JUDGEMENT_UNCONFIRMED",
  "OTHER",
] as const;

export type DecisionSourceValue = (typeof decisionSourceValues)[number];

export const lostSaleReasonValues = [
  "PRODUCT_UNAVAILABLE",
  "INSUFFICIENT_QUANTITY",
  "CUSTOMER_CANCELLED",
  "CUSTOMER_SOURCED_ELSEWHERE",
  "DELIVERY_OR_TIMING_ISSUE",
  "QUALITY_RELATED_ISSUE",
  "SUBSTITUTE_REJECTED",
  "OTHER",
] as const;

export type LostSaleReasonValue = (typeof lostSaleReasonValues)[number];

export const unfulfilledDemandStatusValues = [
  "PENDING_DECISION",
  "AWAITING_SUPPLY",
  "PARTIALLY_CANCELLED",
  "FULLY_CANCELLED",
  "CONFIRMED_LOST",
  "RESOLVED",
] as const;

export type UnfulfilledDemandStatusValue = (typeof unfulfilledDemandStatusValues)[number];

/** Request-body shape checks only -- business-rule validation (quantity vs. remaining, reason-detail-required-for-OTHER, etc.) happens in record-decision.ts/confirm-lost-sale.ts, the same split lib/picking/record-picked-line.ts already follows relative to lib/picking/validation.ts's recordPickedLineSchema. */
export const recordDecisionSchema = z.object({
  decisionType: z.enum(customerDecisionTypeValues),
  source: z.enum(decisionSourceValues),
  // Required for every decisionType except the two WHOLE_REMAINDER ones --
  // enforced in record-decision.ts, not here.
  quantity: decimalStringSchema.optional(),
  substituteProductId: z.string().min(1).max(64).optional(),
  customerContactName: z.string().max(200).optional(),
  reason: z.string().max(2000).optional(),
  remarks: z.string().max(2000).optional(),
  attachmentReference: z.string().max(500).optional(),
  expectedFollowUpDate: z.string().max(40).optional(),
  decidedAt: z.string().max(40).optional(),
});

export type RecordDecisionInput = z.infer<typeof recordDecisionSchema>;

export const confirmLostSaleSchema = z.object({
  quantity: decimalStringSchema,
  reason: z.enum(lostSaleReasonValues),
  reasonDetail: z.string().max(2000).optional(),
  decisionSource: z.enum(decisionSourceValues),
  remarks: z.string().max(2000).optional(),
});

export type ConfirmLostSaleInput = z.infer<typeof confirmLostSaleSchema>;

const ZERO = BigInt(0);

/**
 * Inverse of parseScaledDecimal: turns an exact scaled-by-10,000 integer
 * back into a canonical "whole.ffff" decimal string suitable for a
 * `@db.Decimal(18, 4)` column (Prisma accepts a plain string for a
 * Decimal field). Always emits exactly 4 fractional digits -- trailing
 * zeros are harmless in Postgres and keeping them avoids any ambiguity
 * about precision. Throws on a negative input: every caller in this
 * module computes these from validated, invariant-respecting bucket
 * arithmetic, so a negative result here would mean that arithmetic has a
 * bug -- surfacing it loudly is safer than silently clamping to zero.
 */
export function formatScaledDecimal(scaled: bigint): string {
  if (scaled < ZERO) {
    throw new Error("formatScaledDecimal: refusing to format a negative scaled quantity.");
  }
  const whole = scaled / BigInt(10_000);
  const frac = scaled % BigInt(10_000);
  return `${whole.toString()}.${frac.toString().padStart(4, "0")}`;
}

function toScaledOrZero(raw: string): bigint {
  const parsed = parseScaledDecimal(raw);
  return parsed ?? ZERO;
}

/**
 * The undecided remainder of unavailableQuantity -- the amount that has
 * not yet been assigned to any of the three decision buckets. Not its
 * own stored column (see UnfulfilledDemand's schema comment); always
 * derived from the four stored quantities. Returns null if the inputs
 * are malformed or the arithmetic would go negative (a bucket-invariant
 * violation -- should never happen given validateDecisionQuantity/
 * computeLostSaleConsumption gate every write, but this function stays
 * defensive rather than returning a misleading number).
 */
export function computeUndecidedQuantity(
  unavailableRaw: string,
  outstandingRaw: string,
  cancelledRaw: string,
  substitutedRaw: string
): string | null {
  const unavailable = parseScaledDecimal(unavailableRaw);
  const outstanding = parseScaledDecimal(outstandingRaw);
  const cancelled = parseScaledDecimal(cancelledRaw);
  const substituted = parseScaledDecimal(substitutedRaw);
  if (unavailable === null || outstanding === null || cancelled === null || substituted === null) return null;

  const undecided = unavailable - outstanding - cancelled - substituted;
  if (undecided < ZERO) return null;
  return formatScaledDecimal(undecided);
}

export type DeriveStatusInput = {
  unavailableQuantity: string;
  outstandingQuantity: string;
  cancelledQuantity: string;
  substitutedQuantity: string;
  confirmedLostQuantity: string;
};

/**
 * The one place "Awaiting customer decision / Waiting for remaining
 * supply / Partially cancelled / Fully cancelled / Confirmed lost /
 * Resolved" (spec section 6) is decided, from an UnfulfilledDemand's
 * quantity buckets. Priority-ordered, zero overlap by construction:
 *
 *   1. PENDING_DECISION    -- any undecided remainder > 0
 *   2. AWAITING_SUPPLY     -- fully decided, outstandingQuantity > 0
 *                             (checked BEFORE the cancelled-side checks
 *                             below -- deliberately: even if some of this
 *                             record's cancelled slice has already been
 *                             confirmed lost, the record is not done while
 *                             outstanding demand still needs following up)
 *   3. cancelled === unavailable (no outstanding, no substituted):
 *        CONFIRMED_LOST    -- confirmedLost === cancelled
 *        FULLY_CANCELLED   -- confirmedLost <  cancelled
 *   4. PARTIALLY_CANCELLED -- 0 < cancelled < unavailable
 *   5. RESOLVED            -- unavailable <= 0, OR cancelled === 0 (every
 *                             remaining unit was substituted, nothing
 *                             outstanding/cancelled/undecided)
 */
export function deriveUnfulfilledDemandStatus(input: DeriveStatusInput): UnfulfilledDemandStatusValue {
  const unavailable = toScaledOrZero(input.unavailableQuantity);
  if (unavailable <= ZERO) return "RESOLVED";

  const outstanding = toScaledOrZero(input.outstandingQuantity);
  const cancelled = toScaledOrZero(input.cancelledQuantity);
  const substituted = toScaledOrZero(input.substitutedQuantity);
  const confirmedLost = toScaledOrZero(input.confirmedLostQuantity);

  const undecided = unavailable - outstanding - cancelled - substituted;
  if (undecided > ZERO) return "PENDING_DECISION";
  if (outstanding > ZERO) return "AWAITING_SUPPLY";

  if (cancelled === unavailable) {
    return confirmedLost >= cancelled ? "CONFIRMED_LOST" : "FULLY_CANCELLED";
  }
  if (cancelled > ZERO) return "PARTIALLY_CANCELLED";
  return "RESOLVED";
}

export type DecisionBucket = "outstanding" | "cancelled" | "substituted";

/**
 * Which quantity bucket a given decision type adds its quantity into.
 * AWAIT_REMAINING_QUANTITY and SCHEDULE_LATER_SUPPLY both map to
 * "outstanding" -- same bucket, different customer-facing semantics (see
 * CustomerDecisionType's own schema comment). An exhaustive switch (no
 * default) so TypeScript flags this function if a decision type is ever
 * added without deciding where its quantity goes.
 */
export function decisionTypeToBucket(decisionType: CustomerDecisionTypeValue): DecisionBucket {
  switch (decisionType) {
    case "AWAIT_REMAINING_QUANTITY":
    case "SCHEDULE_LATER_SUPPLY":
      return "outstanding";
    case "SUBSTITUTE_ACCEPTED":
      return "substituted";
    case "ACCEPT_PARTIAL_CANCEL_REMAINDER":
    case "PARTIAL_CANCELLATION":
    case "ENTIRE_LINE_CANCELLED":
    case "ENTIRE_ORDER_CANCELLED":
      return "cancelled";
  }
}

export type QuantityCheckResult = { ok: true } | { ok: false; message: string };

/**
 * Business-rule gate for every decision event EXCEPT the two
 * WHOLE_REMAINDER_DECISION_TYPES (those always consume the full
 * remainder, computed server-side -- see record-decision.ts). Rejects a
 * zero/negative quantity and anything exceeding what is actually still
 * undecided on the parent record -- the structural guarantee behind test
 * scenario 14 ("prevention of quantities exceeding the original
 * unavailable quantity") and scenario 13 ("prevention of duplicate
 * quantity classification"): a quantity can never be assigned to a
 * second bucket once it has already left the undecided remainder.
 */
export function validateDecisionQuantity(quantityRaw: string, undecidedRemainingRaw: string): QuantityCheckResult {
  const quantity = parseScaledDecimal(quantityRaw);
  if (quantity === null) {
    return { ok: false, message: "Quantity must be a non-negative number with at most 4 decimal places." };
  }
  if (quantity <= ZERO) {
    return { ok: false, message: "Quantity must be greater than zero." };
  }
  const undecided = parseScaledDecimal(undecidedRemainingRaw);
  if (undecided === null) {
    return { ok: false, message: "Could not determine the undecided remaining quantity on this record." };
  }
  if (quantity > undecided) {
    return {
      ok: false,
      message: `Quantity (${quantityRaw}) exceeds the undecided remaining quantity on this record (${undecidedRemainingRaw}).`,
    };
  }
  return { ok: true };
}

export type LostSaleConsumptionResult =
  | {
      ok: true;
      newCancelledQuantity: string;
      newConfirmedLostQuantity: string;
      newOutstandingQuantity: string;
    }
  | { ok: false; message: string };

/**
 * Implements the one rule that lets a lost sale be confirmed from EITHER
 * already-cancelled quantity or abandoned outstanding quantity (spec test
 * scenario 12, "conversion from outstanding demand to confirmed lost
 * quantity where appropriate"), while structurally preserving
 * confirmedLostQuantity <= cancelledQuantity at all times:
 *
 *   1. Draw from (cancelledQuantity - confirmedLostQuantity) first --
 *      cancelled-but-not-yet-confirmed-lost quantity.
 *   2. Any remaining shortfall is drawn from outstandingQuantity, and
 *      that same shortfall is moved into cancelledQuantity as part of
 *      this same operation (so the subset invariant never breaks even
 *      transiently).
 *   3. Refuses if the total requested exceeds what both sources
 *      together can supply.
 */
export function computeLostSaleConsumption(
  quantityToConfirmRaw: string,
  cancelledRaw: string,
  confirmedLostRaw: string,
  outstandingRaw: string
): LostSaleConsumptionResult {
  const quantityToConfirm = parseScaledDecimal(quantityToConfirmRaw);
  const cancelled = parseScaledDecimal(cancelledRaw);
  const confirmedLost = parseScaledDecimal(confirmedLostRaw);
  const outstanding = parseScaledDecimal(outstandingRaw);

  if (quantityToConfirm === null || cancelled === null || confirmedLost === null || outstanding === null) {
    return { ok: false, message: "One or more quantities could not be parsed." };
  }
  if (quantityToConfirm <= ZERO) {
    return { ok: false, message: "Quantity must be greater than zero." };
  }

  const availableFromCancelled = cancelled - confirmedLost;
  if (quantityToConfirm <= availableFromCancelled) {
    return {
      ok: true,
      newCancelledQuantity: formatScaledDecimal(cancelled),
      newConfirmedLostQuantity: formatScaledDecimal(confirmedLost + quantityToConfirm),
      newOutstandingQuantity: formatScaledDecimal(outstanding),
    };
  }

  const shortfall = quantityToConfirm - availableFromCancelled;
  if (shortfall > outstanding) {
    return {
      ok: false,
      message:
        "Quantity exceeds what is available to confirm as lost (already-cancelled-but-not-yet-confirmed quantity plus outstanding quantity).",
    };
  }

  return {
    ok: true,
    newCancelledQuantity: formatScaledDecimal(cancelled + shortfall),
    newConfirmedLostQuantity: formatScaledDecimal(confirmedLost + quantityToConfirm),
    newOutstandingQuantity: formatScaledDecimal(outstanding - shortfall),
  };
}

/**
 * Multiplies two non-negative decimal strings (each up to 4 fractional
 * digits) using exact integer arithmetic, truncating (never rounding up)
 * to 4 fractional digits. Used only for LostSaleRecord.estimatedValue --
 * an explicitly-labeled ESTIMATE (spec 4.6), so truncation is an
 * acceptable, documented simplification here; never used anywhere that
 * must reconcile against SAP, which remains authoritative for all real
 * pricing/invoicing.
 */
export function multiplyDecimalStrings(aRaw: string, bRaw: string): string | null {
  const a = parseScaledDecimal(aRaw);
  const b = parseScaledDecimal(bRaw);
  if (a === null || b === null) return null;
  // a and b are each scaled by 10^4, so their product is scaled by 10^8;
  // divide once to rescale back down to the 10^4 scale every other
  // quantity/value in this module uses.
  const product = (a * b) / BigInt(10_000);
  return formatScaledDecimal(product);
}

/** Spec 4.6: "Other, with explanation" -- a free-text detail is required whenever reason is OTHER. */
export function validateLostSaleReason(reason: string, reasonDetail: string | null | undefined): QuantityCheckResult {
  if (reason === "OTHER" && (!reasonDetail || reasonDetail.trim().length === 0)) {
    return { ok: false, message: "A reason detail is required when the loss reason is 'Other'." };
  }
  return { ok: true };
}
