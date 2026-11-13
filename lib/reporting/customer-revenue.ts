import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { currencyKey, sumMoneyRows } from "@/lib/reporting/sales-revenue";

/**
 * Milestone 13 (Customer Intelligence). Pure money-aggregation logic for
 * the customer-keyed twin of Milestone 12's lib/reporting/
 * sales-revenue.ts -- split out for the same @prisma/client-stub reason
 * as that module's own comment explains, and deliberately reusing
 * currencyKey/sumMoneyRows from sales-revenue.ts rather than
 * re-implementing currency normalization a second time.
 *
 * Every qualifying SapInvoiceLine belongs to the customer recorded on
 * its OWN invoice header (SapInvoice.matchedCustomerId) -- never order-
 * line matching or salesperson attribution, which is a separate,
 * unrelated join used only for the salesperson-revenue report (M12).
 * Grouping by customer here carries none of M12's order-attribution
 * ambiguity: a SapInvoiceLine's customer is a direct, unambiguous fact
 * of its own invoice, not something resolved through a matched order.
 *
 * "SAP invoice line value" -- the exact same label, and the exact same
 * never-call-it-revenue rule, as sales-revenue.ts's own top comment
 * documents. Never summed across currency; a null/missing currency is
 * its own explicit UNKNOWN_CURRENCY bucket (reused from sales-revenue.ts,
 * never redefined here).
 */

export type CustomerRevenueLineRecord = {
  /** SapInvoice.matchedCustomerId -- never null for a record passed in here, since only lines on qualifying invoices (which require a resolved matchedCustomerId) are ever fed into this function. */
  customerId: string;
  currency: string | null;
  lineTotal: string | null;
};

export type CustomerRevenueRow = {
  customerId: string;
  lineValueTotal: string;
  excludedLineCount: number;
};

export type CustomerRevenueCurrencyBreakdown = {
  currency: string;
  totalLineValue: string;
  excludedLineCount: number;
  byCustomer: CustomerRevenueRow[];
};

/**
 * Groups already-fetched qualifying SapInvoiceLine records by currency
 * first (never summed across currencies), then by customer within each
 * currency. Pure data transformation; every value returned is a decimal
 * STRING via sumDecimalStrings/formatScaledDecimal, never a
 * floating-point addition -- same discipline as groupRevenueByCurrencyAndSalesperson.
 */
export function groupRevenueByCurrencyAndCustomer(records: readonly CustomerRevenueLineRecord[]): CustomerRevenueCurrencyBreakdown[] {
  type CustomerAccumulator = { lineValues: string[]; excludedCount: number };
  type CurrencyAccumulator = { lineValues: string[]; excludedCount: number; byCustomer: Map<string, CustomerAccumulator> };

  const byCurrency = new Map<string, CurrencyAccumulator>();

  for (const record of records) {
    const currency = currencyKey(record.currency);
    let currencyAcc = byCurrency.get(currency);
    if (!currencyAcc) {
      currencyAcc = { lineValues: [], excludedCount: 0, byCustomer: new Map() };
      byCurrency.set(currency, currencyAcc);
    }
    if (record.lineTotal === null) currencyAcc.excludedCount += 1;
    else currencyAcc.lineValues.push(record.lineTotal);

    let customerAcc = currencyAcc.byCustomer.get(record.customerId);
    if (!customerAcc) {
      customerAcc = { lineValues: [], excludedCount: 0 };
      currencyAcc.byCustomer.set(record.customerId, customerAcc);
    }
    if (record.lineTotal === null) customerAcc.excludedCount += 1;
    else customerAcc.lineValues.push(record.lineTotal);
  }

  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, currencyAcc]) => ({
      currency,
      totalLineValue: currencyAcc.lineValues.length > 0 ? formatScaledDecimal(sumDecimalStrings(currencyAcc.lineValues)) : "0",
      excludedLineCount: currencyAcc.excludedCount,
      byCustomer: [...currencyAcc.byCustomer.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([customerId, customerAcc]) => ({
          customerId,
          lineValueTotal: customerAcc.lineValues.length > 0 ? formatScaledDecimal(sumDecimalStrings(customerAcc.lineValues)) : "0",
          excludedLineCount: customerAcc.excludedCount,
        })),
    }));
}

/**
 * Convenience for the Customer 360 profile: the SAME grouping logic,
 * applied to one customer's own lines only (so it never has to walk a
 * byCustomer array to find itself). Deliberately NOT a separate
 * aggregation algorithm -- it calls groupRevenueByCurrencyAndCustomer
 * and reads the one customer's row back out, so a future change to the
 * grouping rule can never drift between the two call shapes.
 */
export function summarizeCustomerRevenueByCurrency(
  customerId: string,
  records: readonly CustomerRevenueLineRecord[]
): { currency: string; lineValueTotal: string; excludedLineCount: number }[] {
  const breakdown = groupRevenueByCurrencyAndCustomer(records);
  const result: { currency: string; lineValueTotal: string; excludedLineCount: number }[] = [];
  for (const currencyRow of breakdown) {
    const row = currencyRow.byCustomer.find((r) => r.customerId === customerId);
    if (row) result.push({ currency: currencyRow.currency, lineValueTotal: row.lineValueTotal, excludedLineCount: row.excludedLineCount });
  }
  return result;
}

export { sumMoneyRows };
