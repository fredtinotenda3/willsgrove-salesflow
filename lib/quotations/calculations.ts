import "server-only";
import { Prisma } from "@prisma/client";

/**
 * Milestone 7 (Quotations Management). Decimal-exact money calculations
 * (spec section 4): "use appropriate decimal/money handling. Do not use
 * JavaScript floating-point arithmetic for financial calculations where
 * it can introduce rounding errors." Same style as
 * lib/invoice-claims/financial.ts's computeClaimLineDisputedValue --
 * Prisma.Decimal's own exact arithmetic (`.times()`, `.minus()`,
 * `.plus()`, `.toDecimalPlaces(4)`), never a JS `number`.
 *
 * Deliberately `server-only` and the one place in lib/quotations/ that
 * imports `@prisma/client` for real arithmetic (lib/quotations/
 * validation.ts stays pure/client-safe, per that file's own comment).
 * Called only from the impure create/edit functions
 * (lib/quotations/create.ts, edit.ts) immediately before a write -- the
 * computed values are then STORED on QuotationLine/Quotation (see that
 * schema comment for why), never recomputed live on every read.
 */

export type QuotationLineAmountInput = {
  quantity: string; // decimal string, already validated non-negative/4dp
  unitPrice: string;
  discountPercent: string | null; // 0-100, or null for "no discount"
  vatRatePercent: string | null; // 0-100, or null for "no VAT" (e.g. unlisted item with no resolvable TaxCode)
};

export type QuotationLineAmounts = {
  lineSubtotal: Prisma.Decimal;
  discountAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  lineTotal: Prisma.Decimal;
};

/**
 * One line's amounts. Discount is applied to the line subtotal BEFORE
 * VAT (standard practice -- VAT is charged on the discounted price, not
 * the pre-discount price), consistent with how a real SAP B1 price
 * list/discount would be applied.
 */
export function computeQuotationLineAmounts(input: QuotationLineAmountInput): QuotationLineAmounts {
  const quantity = new Prisma.Decimal(input.quantity);
  const unitPrice = new Prisma.Decimal(input.unitPrice);
  const discountPercent = input.discountPercent !== null ? new Prisma.Decimal(input.discountPercent) : new Prisma.Decimal(0);
  const vatRatePercent = input.vatRatePercent !== null ? new Prisma.Decimal(input.vatRatePercent) : new Prisma.Decimal(0);

  const lineSubtotal = quantity.times(unitPrice).toDecimalPlaces(4);
  const discountAmount = lineSubtotal.times(discountPercent).dividedBy(100).toDecimalPlaces(4);
  const afterDiscount = lineSubtotal.minus(discountAmount);
  const vatAmount = afterDiscount.times(vatRatePercent).dividedBy(100).toDecimalPlaces(4);
  const lineTotal = afterDiscount.plus(vatAmount).toDecimalPlaces(4);

  return { lineSubtotal, discountAmount, vatAmount, lineTotal };
}

export type QuotationTotals = {
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  vatTotal: Prisma.Decimal;
  total: Prisma.Decimal;
};

/**
 * The quotation-level totals are a straight sum of every line's already-
 * rounded amounts (never re-derived from quantity*price across all lines
 * at once, which could round differently) -- "quotation total" is
 * defined as "sum of line totals," not an independent calculation that
 * could disagree with the line table a human is looking at.
 */
export function computeQuotationTotals(lines: QuotationLineAmounts[]): QuotationTotals {
  let subtotal = new Prisma.Decimal(0);
  let discountTotal = new Prisma.Decimal(0);
  let vatTotal = new Prisma.Decimal(0);
  let total = new Prisma.Decimal(0);

  for (const line of lines) {
    subtotal = subtotal.plus(line.lineSubtotal);
    discountTotal = discountTotal.plus(line.discountAmount);
    vatTotal = vatTotal.plus(line.vatAmount);
    total = total.plus(line.lineTotal);
  }

  return {
    subtotal: subtotal.toDecimalPlaces(4),
    discountTotal: discountTotal.toDecimalPlaces(4),
    vatTotal: vatTotal.toDecimalPlaces(4),
    total: total.toDecimalPlaces(4),
  };
}
