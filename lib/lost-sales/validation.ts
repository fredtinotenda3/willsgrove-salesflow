import { parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Milestone 4 (Lost-Sales Management), rewritten for the Real Business
 * Data Onboarding round's removal of the Customer Decision workflow
 * (spec PART A, section 4).
 *
 * Pure validation/arithmetic for the lost-sales workflow -- no
 * @prisma/client import anywhere in this file, deliberately, so it stays
 * statically importable from an unconditional unit test exactly like
 * lib/picking/validation.ts (see that file's own module comment).
 *
 * REMOVED in this round (deleted outright, not merely deprecated --
 * their only callers were the decision-recording and manual
 * lost-sale-confirmation flows, both deleted alongside them; see
 * IMPLEMENTATION-REPORT.md for the full file list):
 *   - customerDecisionTypeValues/CustomerDecisionTypeValue,
 *     WHOLE_REMAINDER_DECISION_TYPES
 *   - recordDecisionSchema/RecordDecisionInput,
 *     confirmLostSaleSchema/ConfirmLostSaleInput
 *   - computeUndecidedQuantity -- there is no longer an "undecided
 *     remainder" to compute; a demand is fully cancelled and fully
 *     confirmed lost in the same write it is created in.
 *   - deriveUnfulfilledDemandStatus/DeriveStatusInput -- the six-state
 *     machine (PENDING_DECISION/AWAITING_SUPPLY/PARTIALLY_CANCELLED/
 *     FULLY_CANCELLED/CONFIRMED_LOST/RESOLVED) collapses to a hardcoded
 *     "CONFIRMED_LOST" at creation (lib/lost-sales/create-unfulfilled-
 *     demand.ts) -- there is nothing left to derive.
 *   - decisionTypeToBucket/DecisionBucket -- no decision type exists
 *     anymore to bucket a quantity into.
 *   - validateDecisionQuantity -- no decision-quantity input exists to
 *     validate.
 *   - computeLostSaleConsumption/LostSaleConsumptionResult -- there is no
 *     longer a separate manual "confirm as lost" step that draws from a
 *     cancelled-but-unconfirmed pool; confirmation happens automatically,
 *     for the full quantity, in the same write as cancellation.
 *   - validateLostSaleReason/QuantityCheckResult -- reason is now chosen
 *     mechanically (INSUFFICIENT_QUANTITY/PRODUCT_UNAVAILABLE only, from
 *     foundQuantity) by create-unfulfilled-demand.ts itself, never typed
 *     in by a person, so OTHER (the only reason that ever needed a
 *     required free-text detail) can never be produced by this round's
 *     automatic path -- there is nothing left for this validator to gate.
 *
 * decisionSourceValues is kept, not pruned, and gains exactly one new
 * value (AUTOMATIC_SYSTEM_RECORDED) -- every LostSaleRecord this module
 * creates now uses it. The other values remain defined (and still used by
 * lib/reporting/sales-performance.ts's breakdown) rather than removed,
 * since DecisionSource is a general "how was this sourced" taxonomy, not
 * intrinsically tied to the removed decision workflow -- pruning it would
 * be an unrelated, unrequested schema change with its own ripple effects
 * this round does not need to take on.
 *
 * lostSaleReasonValues is kept in full (unchanged) -- it is still the
 * full domain of valid LostSaleRecord.reason values; this round only
 * removes the ability for a human to pick one manually (and removes the
 * one validation rule, "OTHER requires a detail," that only applied to
 * that manual path).
 */

export const decisionSourceValues = [
  "CUSTOMER_PHONE_CALL",
  "CUSTOMER_EMAIL",
  "CUSTOMER_WRITTEN_COMMUNICATION",
  "CUSTOMER_IN_PERSON",
  "CUSTOMER_PORTAL_OR_SYSTEM",
  "SALESPERSON_JUDGEMENT_UNCONFIRMED",
  "OTHER",
  // Real Business Data Onboarding round: the ONLY value used for a
  // LostSaleRecord created automatically by
  // create-unfulfilled-demand.ts -- no human ever "decides" a shortage
  // anymore, so every other value above is now purely historical/unused
  // by any production call site (kept per this file's module comment).
  "AUTOMATIC_SYSTEM_RECORDED",
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

/**
 * Real Business Data Onboarding round: with no decision step, a NEWLY
 * CREATED UnfulfilledDemand can only ever be in one of two states --
 * CONFIRMED_LOST (the normal, current, fully-automatic outcome) or
 * SUPERSEDED (a later re-pick on the same order line replaced it; see
 * create-unfulfilled-demand.ts). PENDING_DECISION/AWAITING_SUPPLY/
 * PARTIALLY_CANCELLED/FULLY_CANCELLED/RESOLVED can no longer be produced
 * by any surviving code path, but are KEPT here (not pruned) because the
 * underlying Prisma enum/database column also keeps them -- narrowing
 * this list while the database can still legitimately hold rows in any
 * of those five states (created before this round) would make them
 * unfilterable/unreportable, not merely unreachable. See
 * UnfulfilledDemandStatus's own schema.prisma comment for the full
 * "never drop what might already hold real data" rationale this mirrors.
 */
export const unfulfilledDemandStatusValues = [
  "PENDING_DECISION",
  "AWAITING_SUPPLY",
  "PARTIALLY_CANCELLED",
  "FULLY_CANCELLED",
  "CONFIRMED_LOST",
  "RESOLVED",
  "SUPERSEDED",
] as const;

export type UnfulfilledDemandStatusValue = (typeof unfulfilledDemandStatusValues)[number];

const ZERO = BigInt(0);

/**
 * Inverse of parseScaledDecimal: turns an exact scaled-by-10,000 integer
 * back into a canonical "whole.ffff" decimal string suitable for a
 * `@db.Decimal(18, 4)` column (Prisma accepts a plain string for a
 * Decimal field). Always emits exactly 4 fractional digits -- trailing
 * zeros are harmless in Postgres and keeping them avoids any ambiguity
 * about precision. Throws on a negative input: every caller in this
 * module computes these from validated, invariant-respecting arithmetic,
 * so a negative result here would mean that arithmetic has a bug --
 * surfacing it loudly is safer than silently clamping to zero.
 */
export function formatScaledDecimal(scaled: bigint): string {
  if (scaled < ZERO) {
    throw new Error("formatScaledDecimal: refusing to format a negative scaled quantity.");
  }
  const whole = scaled / BigInt(10_000);
  const frac = scaled % BigInt(10_000);
  return `${whole.toString()}.${frac.toString().padStart(4, "0")}`;
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
