import { parseScaledDecimal } from "@/lib/picking/validation";
import { formatScaledDecimal } from "@/lib/fulfilment/decimal";

/**
 * Pure server-side rule for a returned quantity: the cumulative quantity
 * received back against a claim line can never exceed the quantity that
 * line actually disputed (its rejected quantity -- the portion of the
 * invoiced quantity the customer refused). Kept pure (scaled-bigint, 4dp,
 * the same convention as the rest of the money/quantity code) so it is unit
 * testable without a database; recordClaimReturn supplies the three numbers
 * from inside its transaction.
 */
export type ReturnQuantityCheck =
  | { ok: true; remainingAfter: string }
  | { ok: false; message: string; remaining: string };

export function checkReturnQuantity(input: {
  /** Quantity being recorded now. */
  receivedQuantity: string;
  /** Sum of all earlier returns recorded against the same claim line / claim. */
  alreadyReturned: string;
  /** Eligible quantity: the claim line's rejected quantity (or the claim's total rejected quantity when no line is named). */
  eligibleQuantity: string;
}): ReturnQuantityCheck {
  const received = parseScaledDecimal(input.receivedQuantity);
  const already = parseScaledDecimal(input.alreadyReturned);
  const eligible = parseScaledDecimal(input.eligibleQuantity);
  if (received === null || already === null || eligible === null) {
    return { ok: false, message: "Quantities must be valid decimal numbers.", remaining: "0" };
  }
  const remaining = eligible - already;
  const safeRemaining = remaining < BigInt(0) ? BigInt(0) : remaining;
  if (received > safeRemaining) {
    return {
      ok: false,
      remaining: formatScaledDecimal(safeRemaining),
      message: `Cannot return ${input.receivedQuantity}: only ${formatScaledDecimal(safeRemaining)} of the ${formatScaledDecimal(eligible)} disputed quantity remains eligible to be returned.`,
    };
  }
  return { ok: true, remainingAfter: formatScaledDecimal(safeRemaining - received) };
}
