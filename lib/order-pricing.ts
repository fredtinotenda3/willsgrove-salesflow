/**
 * Order pricing calculations: line totals, subtotal, configured tax and
 * the final total -- ONE definition shared by the Orders list, the
 * dashboard's recent-orders widget and the order detail page, so the three
 * can never disagree about what an order is worth.
 *
 * Pure logic only (no `@prisma/client`, no database access), so it is safe
 * to import from a Client Component and to unit-test without a database --
 * the same split lib/fulfilment/decimal.ts and lib/picking/validation.ts
 * already use. All arithmetic is scaled-bigint (4 decimal places), never
 * floating point, matching this codebase's house convention for money.
 *
 * Rules (deliberately conservative -- see the stated reasons):
 *  - A line with no unit price contributes NOTHING and is counted as
 *    unpriced. It is never treated as a zero-value line: an unpriced line
 *    is "unknown", not "free".
 *  - Tax is applied only where a rate is actually CONFIGURED for the line's
 *    product (Product.vatCode -> TaxCode.ratePercent). A line whose product
 *    has no VAT code, or whose code matches no TaxCode row, is counted as
 *    `taxUnconfigured`; no rate is ever guessed or defaulted, and the line
 *    contributes its subtotal but no tax. A configured rate of exactly 0
 *    (e.g. VAT00) is a real, valid rate and is NOT "unconfigured".
 *  - Rounding: half-up to 4 decimal places at each line (subtotal and tax),
 *    and the order totals are the plain sum of those already-rounded line
 *    amounts -- so the lines a person reads always add up to the totals
 *    they see (same "sum of lines, not an independent recomputation"
 *    definition lib/quotations/calculations.ts documents).
 */

const SCALE = BigInt(10_000); // 4 decimal places
const SCALE_DIGITS = 4;
const DECIMAL_PATTERN = /^\d+(\.\d{1,4})?$/;

/** Parses a non-negative decimal string (max 4dp) into a scaled bigint; null when malformed. */
export function parseMoneyDecimal(value: string): bigint | null {
  if (!DECIMAL_PATTERN.test(value)) return null;
  const [intPart, fracPart = ""] = value.split(".");
  return BigInt(intPart) * SCALE + BigInt(fracPart.padEnd(SCALE_DIGITS, "0"));
}

/** Rounds a scaled-by-`extraScale` product back down to the 4dp scale, half-up. */
function divideRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / BigInt(2)) / denominator;
}

/** Formats a scaled bigint as a plain decimal string with exactly 4 decimal places. */
export function formatMoneyDecimal(scaled: bigint): string {
  const intPart = scaled / SCALE;
  const fracPart = scaled % SCALE;
  return `${intPart}.${fracPart.toString().padStart(SCALE_DIGITS, "0")}`;
}

export type OrderPricingLineInput = {
  /** requestedQuantity, as a decimal string. */
  quantity: string;
  /** The unit price actually used for this line (snapshot), or null when none is known. */
  unitPrice: string | null;
  /**
   * The configured VAT rate for this line's product as a percentage decimal
   * string (e.g. "15" or "15.00"), or null when NO rate is configured for it.
   * "0" is a valid configured rate (zero-rated).
   */
  vatRatePercent: string | null;
};

export type OrderPricingLine = {
  /** quantity x unit price, or null when the line has no usable price/quantity. */
  subtotal: string | null;
  /** Tax on this line's subtotal, or null when unpriced OR no tax rate is configured. */
  tax: string | null;
  /** subtotal + tax (tax counted as 0 where unconfigured), or null when unpriced. */
  total: string | null;
  priced: boolean;
  taxConfigured: boolean;
};

export type OrderPricing = {
  lines: OrderPricingLine[];
  /** Sum of every priced line's subtotal; null when NO line is priced. */
  subtotal: string | null;
  /** Sum of the tax actually computed (configured lines only); null when no line is priced. */
  taxTotal: string | null;
  /** subtotal + taxTotal; null when no line is priced. */
  total: string | null;
  pricedLineCount: number;
  unpricedLineCount: number;
  /** Priced lines for which no tax rate is configured (their tax is NOT in taxTotal). */
  taxUnconfiguredLineCount: number;
  /** True only when every line is priced AND every priced line has a configured tax rate. */
  isComplete: boolean;
};

export function computeOrderPricing(lines: OrderPricingLineInput[]): OrderPricing {
  let subtotalSum = BigInt(0);
  let taxSum = BigInt(0);
  let pricedLineCount = 0;
  let taxUnconfiguredLineCount = 0;

  const computed: OrderPricingLine[] = lines.map((line) => {
    const quantity = parseMoneyDecimal(line.quantity);
    const unitPrice = line.unitPrice === null ? null : parseMoneyDecimal(line.unitPrice);
    const rate = line.vatRatePercent === null ? null : parseMoneyDecimal(line.vatRatePercent);

    if (quantity === null || unitPrice === null) {
      return { subtotal: null, tax: null, total: null, priced: false, taxConfigured: rate !== null };
    }

    const subtotal = divideRoundHalfUp(quantity * unitPrice, SCALE);
    pricedLineCount += 1;
    subtotalSum += subtotal;

    if (rate === null) {
      taxUnconfiguredLineCount += 1;
      return { subtotal: formatMoneyDecimal(subtotal), tax: null, total: formatMoneyDecimal(subtotal), priced: true, taxConfigured: false };
    }

    // rate is scaled by 10^4 (e.g. 15% -> 150000); percentage -> divide by 100.
    const tax = divideRoundHalfUp(subtotal * rate, SCALE * BigInt(100));
    taxSum += tax;
    return {
      subtotal: formatMoneyDecimal(subtotal),
      tax: formatMoneyDecimal(tax),
      total: formatMoneyDecimal(subtotal + tax),
      priced: true,
      taxConfigured: true,
    };
  });

  const unpricedLineCount = lines.length - pricedLineCount;

  if (pricedLineCount === 0) {
    return {
      lines: computed,
      subtotal: null,
      taxTotal: null,
      total: null,
      pricedLineCount: 0,
      unpricedLineCount,
      taxUnconfiguredLineCount: 0,
      isComplete: false,
    };
  }

  return {
    lines: computed,
    subtotal: formatMoneyDecimal(subtotalSum),
    taxTotal: formatMoneyDecimal(taxSum),
    total: formatMoneyDecimal(subtotalSum + taxSum),
    pricedLineCount,
    unpricedLineCount,
    taxUnconfiguredLineCount,
    isComplete: unpricedLineCount === 0 && taxUnconfiguredLineCount === 0,
  };
}

/**
 * Looks up the configured rate for a product's VAT code. Returns null (never
 * a defaulted rate) when the product has no VAT code or the code is not in
 * the supplied map.
 */
export function resolveVatRatePercent(
  vatCode: string | null | undefined,
  ratePercentByCode: ReadonlyMap<string, string>
): string | null {
  if (!vatCode) return null;
  return ratePercentByCode.get(vatCode) ?? null;
}

/**
 * Human-readable explanation of why a figure is partial, or null when the
 * pricing is complete. Used verbatim by the UI so the wording is defined
 * once, next to the rule it explains.
 */
export function describePricingGaps(pricing: OrderPricing): string | null {
  const parts: string[] = [];
  if (pricing.unpricedLineCount > 0) {
    parts.push(
      `${pricing.unpricedLineCount} line${pricing.unpricedLineCount === 1 ? " has" : "s have"} no price yet and ${
        pricing.unpricedLineCount === 1 ? "is" : "are"
      } not included`
    );
  }
  if (pricing.taxUnconfiguredLineCount > 0) {
    parts.push(
      `no tax rate is configured for ${pricing.taxUnconfiguredLineCount} priced line${
        pricing.taxUnconfiguredLineCount === 1 ? "" : "s"
      }, so no tax is added to ${pricing.taxUnconfiguredLineCount === 1 ? "it" : "them"}`
    );
  }
  if (parts.length === 0) return null;
  const sentence = parts.join("; ");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
