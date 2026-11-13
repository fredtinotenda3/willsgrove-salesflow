import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { currencyKey } from "@/lib/reporting/sales-revenue";

/**
 * Milestone 13 (Customer Intelligence). Pure product-purchasing-pattern
 * aggregation for one customer's qualifying SapInvoiceLine rows -- split
 * out from lib/reporting/customer-purchasing-queries.ts for the same
 * @prisma/client-stub reason as lib/reporting/sales-revenue.ts's own
 * comment explains.
 *
 * Four DISTINCT metrics, deliberately never combined with each other
 * (per the explicit correction that replaced an earlier, rejected
 * SUM(quantityInvoiced / lineTotal) expression):
 *
 *   1. Quantity purchased: SUM(quantityInvoiced), grouped by
 *      (sapItemCode, the LINE's own recorded unitOfMeasure) -- never
 *      Product.unitOfMeasure, which is separate master data, populated
 *      by a different import, and can be null or lag the transactional
 *      record. A sapItemCode invoiced under two different recorded
 *      units gets two separate rows here; they are never summed
 *      together, since "5 EA + 3 CTN" is not a meaningful number.
 *   2. SAP invoice line value per product: SUM(lineTotal), grouped by
 *      (sapItemCode, SapInvoice.currencyCode) -- never summed across
 *      currency, same rule as every other money figure in this project.
 *      Labelled "SAP invoice line value" by the caller, same as every
 *      other lineTotal sum in this codebase -- never "revenue."
 *   3. Purchase frequency: COUNT of DISTINCT qualifying invoices (never
 *      invoice LINES) containing >=1 line with this sapItemCode -- two
 *      lines for the same item on one invoice is one purchase, not two.
 *   4. Last purchased: MAX(invoiceDate) among qualifying invoices
 *      containing this sapItemCode. Bounded by whatever period/as-of
 *      filter the caller already applied when fetching `records` --
 *      this module performs no date filtering of its own, so the bound
 *      is enforced exactly once, at the query layer, never duplicated
 *      or risked drifting here.
 *
 * sapItemCode/unitOfMeasure/currency each get their own explicit
 * UNKNOWN_* bucket when missing -- never silently merged into a real
 * value, same convention as sales-revenue.ts's UNKNOWN_CURRENCY.
 */

export const UNKNOWN_SAP_ITEM_CODE = "UNKNOWN_ITEM";
export const UNKNOWN_UNIT_OF_MEASURE = "UNKNOWN_UOM";

export type ProductLineRecord = {
  /** The qualifying SapInvoice's own id -- used only to count DISTINCT invoices for purchase frequency, never to sum anything. */
  invoiceId: string;
  /** "YYYY-MM-DD", the qualifying invoice's own invoiceDate. Lexicographically comparable, so MAX can be computed with plain string comparison. */
  invoiceDate: string;
  sapItemCode: string | null;
  sapItemDescription: string | null;
  unitOfMeasure: string | null;
  /** Always a real decimal string in practice (SapInvoiceLine.quantityInvoiced is a required, non-nullable column) -- typed as a plain string, never optional, so a caller can't accidentally treat a missing quantity as possible here. */
  quantityInvoiced: string;
  lineTotal: string | null;
  currency: string | null;
};

function itemKey(sapItemCode: string | null): string {
  const trimmed = (sapItemCode ?? "").trim();
  return trimmed === "" ? UNKNOWN_SAP_ITEM_CODE : trimmed;
}

function uomKey(unitOfMeasure: string | null): string {
  const trimmed = (unitOfMeasure ?? "").trim();
  return trimmed === "" ? UNKNOWN_UNIT_OF_MEASURE : trimmed.toUpperCase();
}

export type ProductQuantityByUnit = { unitOfMeasure: string; quantityTotal: string };
export type ProductValueByCurrency = { currency: string; lineValueTotal: string; excludedLineCount: number };

export type ProductPurchasingAggregate = {
  sapItemCode: string;
  /**
   * The invoice line's own description text, taken from whichever
   * contributing line has the LATEST invoiceDate (a reasonable,
   * explicit tie-break, never the first row encountered in arbitrary
   * fetch order). Sourced from the transaction itself, never from
   * Product master data -- the caller (queries layer) joins Product
   * separately for product-master match status/category, and falls
   * back to this description when no Product row exists for the code.
   */
  latestLineDescription: string | null;
  quantityByUnit: ProductQuantityByUnit[];
  valueByCurrency: ProductValueByCurrency[];
  /** COUNT of distinct qualifying invoices containing this item -- never a count of lines. */
  purchaseFrequency: number;
  /** MAX(invoiceDate) among this item's contributing records, already bounded by whatever filter the caller applied to `records` before calling this function. Null only if, somehow, no record for this item carried a date -- unreachable in practice since every qualifying invoice has a non-null invoiceDate by definition. */
  lastPurchasedDate: string | null;
};

export function aggregateProductPurchasing(records: readonly ProductLineRecord[]): ProductPurchasingAggregate[] {
  type Accumulator = {
    quantityByUnit: Map<string, string[]>;
    valueByCurrency: Map<string, { values: string[]; excluded: number }>;
    invoiceIds: Set<string>;
    lastDate: string | null;
    latestLineDescription: string | null;
    latestLineDate: string | null;
  };

  const byItem = new Map<string, Accumulator>();

  for (const record of records) {
    const item = itemKey(record.sapItemCode);
    let acc = byItem.get(item);
    if (!acc) {
      acc = { quantityByUnit: new Map(), valueByCurrency: new Map(), invoiceIds: new Set(), lastDate: null, latestLineDescription: null, latestLineDate: null };
      byItem.set(item, acc);
    }

    const unit = uomKey(record.unitOfMeasure);
    const quantityBucket = acc.quantityByUnit.get(unit) ?? [];
    quantityBucket.push(record.quantityInvoiced);
    acc.quantityByUnit.set(unit, quantityBucket);

    const currency = currencyKey(record.currency);
    const valueBucket = acc.valueByCurrency.get(currency) ?? { values: [], excluded: 0 };
    if (record.lineTotal === null) valueBucket.excluded += 1;
    else valueBucket.values.push(record.lineTotal);
    acc.valueByCurrency.set(currency, valueBucket);

    acc.invoiceIds.add(record.invoiceId);

    if (acc.lastDate === null || record.invoiceDate > acc.lastDate) acc.lastDate = record.invoiceDate;
    if (acc.latestLineDate === null || record.invoiceDate >= acc.latestLineDate) {
      acc.latestLineDate = record.invoiceDate;
      acc.latestLineDescription = record.sapItemDescription;
    }
  }

  return [...byItem.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sapItemCode, acc]) => ({
      sapItemCode,
      latestLineDescription: acc.latestLineDescription,
      quantityByUnit: [...acc.quantityByUnit.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([unitOfMeasure, values]) => ({ unitOfMeasure, quantityTotal: formatScaledDecimal(sumDecimalStrings(values)) })),
      valueByCurrency: [...acc.valueByCurrency.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([currency, bucket]) => ({
          currency,
          lineValueTotal: bucket.values.length > 0 ? formatScaledDecimal(sumDecimalStrings(bucket.values)) : "0",
          excludedLineCount: bucket.excluded,
        })),
      purchaseFrequency: acc.invoiceIds.size,
      lastPurchasedDate: acc.lastDate,
    }));
}
