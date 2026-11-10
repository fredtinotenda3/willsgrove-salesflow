import { z } from "zod";

/**
 * Milestone 3A (SAP Invoice Handover Specification -- warehouse picking).
 *
 * Pure validation/arithmetic for the picking workflow -- no @prisma/client
 * import anywhere in this file, deliberately, so it can be statically
 * imported from an unconditional unit test exactly like
 * lib/handover/format-rows.ts (see tests/picking-validation.test.ts and
 * that file's own module comment for why this matters in this sandbox).
 *
 * Quantities travel as decimal strings end-to-end (the same convention
 * lib/handover/build-handover-rows.ts's HandoverRow.quantity already
 * uses) and are compared here as exact fixed-point integers scaled by
 * 10,000 -- this project's columns are all `@db.Decimal(18, 4)` -- rather
 * than as floating-point numbers, so e.g. "0.1" + "0.2" can never drift
 * away from "0.3".
 */

const DECIMAL_STRING_PATTERN = /^\d+(\.\d{1,4})?$/;

export const decimalStringSchema = z
  .string()
  .regex(DECIMAL_STRING_PATTERN, "Must be a non-negative number with at most 4 decimal places.");

export const recordPickedLineSchema = z.object({
  foundQuantity: decimalStringSchema,
  unavailableQuantity: decimalStringSchema,
  notes: z.string().max(2000).optional(),
});

export type RecordPickedLineInput = z.infer<typeof recordPickedLineSchema>;

/**
 * Parses a non-negative decimal string into an exact integer scaled by
 * 10,000. Returns null for anything that doesn't match
 * DECIMAL_STRING_PATTERN -- callers that already validated the string
 * with decimalStringSchema will never see null here, but this function is
 * also usable standalone (e.g. against a quantity read back from the
 * database as `decimal.toString()`), so it stays defensive.
 */
export function parseScaledDecimal(value: string): bigint | null {
  const trimmed = value.trim();
  if (!DECIMAL_STRING_PATTERN.test(trimmed)) return null;
  const [intPart, fracPartRaw = ""] = trimmed.split(".");
  // BigInt(10000) rather than a `10_000n` literal: this project's
  // tsconfig.json targets ES2017, which doesn't support BigInt literal
  // syntax (TS2737) -- the BigInt(...) call form works at any target.
  return BigInt(intPart) * BigInt(10_000) + BigInt(fracPartRaw.padEnd(4, "0"));
}

/**
 * True when found + unavailable is strictly greater than requested -- a
 * data-entry error, never a legitimate state. Returns false (rather than
 * throwing) for a malformed input; callers validate shape separately with
 * recordPickedLineSchema before this ever runs.
 */
export function exceedsRequested(foundRaw: string, unavailableRaw: string, requestedRaw: string): boolean {
  const found = parseScaledDecimal(foundRaw);
  const unavailable = parseScaledDecimal(unavailableRaw);
  const requested = parseScaledDecimal(requestedRaw);
  if (found === null || unavailable === null || requested === null) return false;
  return found + unavailable > requested;
}

/**
 * True when found + unavailable exactly accounts for requested -- the bar
 * every line of a PickingSession must clear before that session can be
 * marked COMPLETED (lib/picking/complete-picking.ts). Matches the spec's
 * worked example exactly: 20 requested / 20 found / 0 unavailable;
 * 15 / 10 / 5; 30 / 25 / 5.
 */
export function fullyAccountsFor(foundRaw: string, unavailableRaw: string, requestedRaw: string): boolean {
  const found = parseScaledDecimal(foundRaw);
  const unavailable = parseScaledDecimal(unavailableRaw);
  const requested = parseScaledDecimal(requestedRaw);
  if (found === null || unavailable === null || requested === null) return false;
  return found + unavailable === requested;
}
