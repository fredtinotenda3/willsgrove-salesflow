import { parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Thin, additive
 * extension of lib/picking/validation.ts's exact fixed-point decimal
 * arithmetic (reused here UNCHANGED via parseScaledDecimal, imported, not
 * copied) -- adds only what dispatch/delivery quantity bookkeeping needs
 * beyond what picking itself required: summing across many rows, and
 * formatting a scaled value back into a decimal string for an API
 * response. Kept in its own file rather than appended to
 * lib/picking/validation.ts, consistent with this milestone's own rule of
 * building alongside already-shipped M0-M9 code rather than editing it.
 *
 * No @prisma/client import, same reason lib/picking/validation.ts gives
 * for its own module comment: statically importable from an unconditional
 * unit test.
 */

// BigInt(10000) rather than a `10_000n` literal: this project's tsconfig
// targets ES2017, which does not support BigInt literal syntax (TS2737) --
// the BigInt(...) call form works at any target, same convention as
// lib/picking/validation.ts's own parseScaledDecimal.
const SCALE = BigInt(10_000);

/**
 * Sums any number of decimal strings (typically Prisma Decimal.toString()
 * values already read from the database) exactly, as a scaled bigint.
 * Throws on a malformed value -- every caller in this milestone passes
 * either a database-sourced Decimal.toString() (always well-formed) or a
 * value already checked with decimalStringSchema beforehand, so this
 * stays a true "should never happen" guard, not a validation path.
 */
export function sumDecimalStrings(values: readonly string[]): bigint {
  return values.reduce((total, value) => {
    const scaled = parseScaledDecimal(value);
    if (scaled === null) {
      throw new Error(`sumDecimalStrings: "${value}" is not a valid non-negative decimal string.`);
    }
    return total + scaled;
  }, BigInt(0));
}

/**
 * Formats a scaled bigint (see parseScaledDecimal) back into a plain
 * decimal string -- e.g. 123450n -> "12.345", 200000n -> "20". Trailing
 * zero fractional digits are trimmed (and the decimal point dropped
 * entirely for a whole number), matching how Prisma's own Decimal.
 * toString() renders a `@db.Decimal(18, 4)` value, so a value that round-
 * trips through this function reads the same as one read directly off a
 * model.
 */
export function formatScaledDecimal(scaled: bigint): string {
  const negative = scaled < BigInt(0);
  const abs = negative ? -scaled : scaled;
  const intPart = abs / SCALE;
  const fracPart = abs % SCALE;
  const fracText = fracPart.toString().padStart(4, "0").replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fracText.length > 0 ? `${sign}${intPart}.${fracText}` : `${sign}${intPart}`;
}

/**
 * available - used, clamped at zero. A negative raw difference would mean
 * more has been dispatched against a line than was ever authorized as
 * found for it -- lib/fulfilment/dispatch.ts's own validation is designed
 * to make that impossible on every path that creates a DispatchLine, so
 * this clamp is a defensive floor against it ever being displayed as a
 * negative "outstanding" quantity, not an expected outcome.
 */
export function clampedDifference(available: bigint, used: bigint): bigint {
  const diff = available - used;
  return diff > BigInt(0) ? diff : BigInt(0);
}
