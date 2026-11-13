import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { currencyKey, sumMoneyRows } from "@/lib/reporting/sales-revenue";

/**
 * Milestone 14 (Product Intelligence). Pure money-aggregation logic for
 * the product-keyed twin of Milestone 13's lib/reporting/
 * customer-revenue.ts -- split out for the same @prisma/client-stub
 * reason every other pure reporting module in this project gives (see
 * lib/reporting/sales-revenue.ts's own comment), and deliberately reusing
 * currencyKey/sumMoneyRows rather than re-implementing currency
 * normalization a third time.
 *
 * Every qualifying SapInvoiceLine is grouped by its OWN recorded
 * sapItemCode (SapInvoiceLine.sapItemCode) -- the canonical SAP product
 * identity per spec section 3, never a Product-master join (a join is
 * used only for match-status/category DISPLAY, at the query layer, never
 * for identity or grouping).
 *
 * "SAP invoice line value" -- the exact same label, and the exact same
 * never-call-it-revenue-or-profit rule, as sales-revenue.ts's own top
 * comment documents. Never summed across currency; a null/missing
 * currency is its own explicit UNKNOWN_CURRENCY bucket (reused from
 * sales-revenue.ts, never redefined here).
 */

export type ProductRevenueLineRecord = {
  /** SapInvoiceLine.sapItemCode, normalized via itemCodeKey below by the caller before this is populated -- never null for a record passed in here (a null/blank item code is its own explicit UNKNOWN_ITEM bucket, same convention product-purchasing.ts already uses). */
  sapItemCode: string;
  currency: string | null;
  lineTotal: string | null;
};

export type ProductRevenueRow = {
  sapItemCode: string;
  lineValueTotal: string;
  excludedLineCount: number;
};

export type ProductRevenueCurrencyBreakdown = {
  currency: string;
  totalLineValue: string;
  excludedLineCount: number;
  byProduct: ProductRevenueRow[];
};

/**
 * Groups already-fetched qualifying SapInvoiceLine records by currency
 * first (never summed across currencies), then by SAP item code within
 * each currency. Pure data transformation; every value returned is a
 * decimal STRING via sumDecimalStrings/formatScaledDecimal, never a
 * floating-point addition -- same discipline as every other revenue
 * aggregator in this project.
 */
export function groupRevenueByCurrencyAndProduct(records: readonly ProductRevenueLineRecord[]): ProductRevenueCurrencyBreakdown[] {
  type ProductAccumulator = { lineValues: string[]; excludedCount: number };
  type CurrencyAccumulator = { lineValues: string[]; excludedCount: number; byProduct: Map<string, ProductAccumulator> };

  const byCurrency = new Map<string, CurrencyAccumulator>();

  for (const record of records) {
    const currency = currencyKey(record.currency);
    let currencyAcc = byCurrency.get(currency);
    if (!currencyAcc) {
      currencyAcc = { lineValues: [], excludedCount: 0, byProduct: new Map() };
      byCurrency.set(currency, currencyAcc);
    }
    if (record.lineTotal === null) currencyAcc.excludedCount += 1;
    else currencyAcc.lineValues.push(record.lineTotal);

    let productAcc = currencyAcc.byProduct.get(record.sapItemCode);
    if (!productAcc) {
      productAcc = { lineValues: [], excludedCount: 0 };
      currencyAcc.byProduct.set(record.sapItemCode, productAcc);
    }
    if (record.lineTotal === null) productAcc.excludedCount += 1;
    else productAcc.lineValues.push(record.lineTotal);
  }

  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, currencyAcc]) => ({
      currency,
      totalLineValue: currencyAcc.lineValues.length > 0 ? formatScaledDecimal(sumDecimalStrings(currencyAcc.lineValues)) : "0",
      excludedLineCount: currencyAcc.excludedCount,
      byProduct: [...currencyAcc.byProduct.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sapItemCode, productAcc]) => ({
          sapItemCode,
          lineValueTotal: productAcc.lineValues.length > 0 ? formatScaledDecimal(sumDecimalStrings(productAcc.lineValues)) : "0",
          excludedLineCount: productAcc.excludedCount,
        })),
    }));
}

/**
 * Convenience for the Product 360 profile: the SAME grouping logic,
 * applied to one product's own lines only (so it never has to walk a
 * byProduct array to find itself). Deliberately NOT a separate
 * aggregation algorithm -- it calls groupRevenueByCurrencyAndProduct and
 * reads the one product's row back out, so a future change to the
 * grouping rule can never drift between the two call shapes.
 */
export function summarizeProductRevenueByCurrency(
  sapItemCode: string,
  records: readonly ProductRevenueLineRecord[]
): { currency: string; lineValueTotal: string; excludedLineCount: number }[] {
  const breakdown = groupRevenueByCurrencyAndProduct(records);
  const result: { currency: string; lineValueTotal: string; excludedLineCount: number }[] = [];
  for (const currencyRow of breakdown) {
    const row = currencyRow.byProduct.find((r) => r.sapItemCode === sapItemCode);
    if (row) result.push({ currency: currencyRow.currency, lineValueTotal: row.lineValueTotal, excludedLineCount: row.excludedLineCount });
  }
  return result;
}

export { sumMoneyRows };
