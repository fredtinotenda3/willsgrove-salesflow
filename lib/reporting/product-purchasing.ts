import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";

/**
 * Milestone 14 (Product Intelligence). Pure purchasing-pattern
 * aggregation for Product 360 -- the product-keyed twin of Milestone 13's
 * lib/reporting/customer-purchasing.ts, split out for the same
 * @prisma/client-stub reason every pure reporting module in this project
 * gives.
 *
 * Two DISTINCT, deliberately never-combined aggregations, matching spec
 * sections 4.2/4.3/5.3:
 *
 *   1. Quantity invoiced, grouped by the LINE's own recorded
 *      unitOfMeasure (never Product.unitOfMeasure, which is separate
 *      master data populated by a different import and can lag or be
 *      null) -- aggregateQuantityByUnit. A product invoiced under two
 *      different recorded units gets two separate rows; they are never
 *      summed together ("5 EA + 3 CTN" is not a meaningful number).
 *   2. Per-customer demand for ONE product (spec 4.3: "customers who
 *      purchased; purchase frequency; last purchase date") --
 *      aggregateCustomerDemandForProduct. Purchase frequency is COUNT of
 *      DISTINCT qualifying invoices (never lines) in which that customer
 *      bought the product; two lines for the same product on one invoice
 *      is one purchase, not two -- identical rule to M13's
 *      purchaseFrequency, applied per-customer here instead of
 *      per-product.
 *
 * itemKey/UNKNOWN_SAP_ITEM_CODE are kept here (rather than duplicated in
 * product-revenue.ts) because this is where Milestone 13's own
 * UNKNOWN_SAP_ITEM_CODE precedent for "purchasing pattern" modules lives;
 * product-revenue-queries.ts imports this one normalizer rather than
 * re-deriving it.
 */

export const UNKNOWN_SAP_ITEM_CODE = "UNKNOWN_ITEM";
export const UNKNOWN_UNIT_OF_MEASURE = "UNKNOWN_UOM";

export function itemKey(sapItemCode: string | null): string {
  const trimmed = (sapItemCode ?? "").trim();
  return trimmed === "" ? UNKNOWN_SAP_ITEM_CODE : trimmed;
}

function uomKey(unitOfMeasure: string | null): string {
  const trimmed = (unitOfMeasure ?? "").trim();
  return trimmed === "" ? UNKNOWN_UNIT_OF_MEASURE : trimmed.toUpperCase();
}

export type ProductQuantityLineRecord = {
  unitOfMeasure: string | null;
  /** Always a real decimal string in practice (SapInvoiceLine.quantityInvoiced is a required, non-nullable column). */
  quantityInvoiced: string;
};

export type ProductQuantityByUnit = { unitOfMeasure: string; quantityTotal: string };

/**
 * SUM(quantityInvoiced), grouped by the line's own recorded
 * unitOfMeasure. Pure; never mixes units, never touches Product master.
 */
export function aggregateQuantityByUnit(records: readonly ProductQuantityLineRecord[]): ProductQuantityByUnit[] {
  const byUnit = new Map<string, string[]>();
  for (const record of records) {
    const unit = uomKey(record.unitOfMeasure);
    const bucket = byUnit.get(unit) ?? [];
    bucket.push(record.quantityInvoiced);
    byUnit.set(unit, bucket);
  }
  return [...byUnit.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([unitOfMeasure, values]) => ({ unitOfMeasure, quantityTotal: formatScaledDecimal(sumDecimalStrings(values)) }));
}

export type ProductCustomerDemandLineRecord = {
  customerId: string;
  /** The qualifying SapInvoice's own id -- used only to count DISTINCT invoices per customer, never to sum anything. */
  invoiceId: string;
  /** "YYYY-MM-DD", the qualifying invoice's own invoiceDate. Lexicographically comparable. */
  invoiceDate: string;
};

export type ProductCustomerDemandRow = {
  customerId: string;
  /** COUNT of distinct qualifying invoices in which this customer bought this product -- never a count of lines. */
  purchaseFrequency: number;
  /** MAX(invoiceDate) among this customer's contributing records for this product, bounded by whatever period/as-of filter the caller already applied before calling this function. */
  lastPurchaseDate: string | null;
};

/**
 * Groups one product's already-fetched qualifying-invoice-line records
 * by customer -- spec 4.3's "customers who purchased; purchase frequency;
 * last purchase date." Pure; no financial or quantity figures here (a
 * customer's own per-product money/quantity figures are already surfaced
 * via the EXISTING Customer 360 purchasing breakdown -- this function
 * exists to answer the inverse question, "which customers bought THIS
 * product," without re-deriving money/quantity math a second time).
 */
export function aggregateCustomerDemandForProduct(records: readonly ProductCustomerDemandLineRecord[]): ProductCustomerDemandRow[] {
  type Accumulator = { invoiceIds: Set<string>; lastDate: string | null };
  const byCustomer = new Map<string, Accumulator>();

  for (const record of records) {
    let acc = byCustomer.get(record.customerId);
    if (!acc) {
      acc = { invoiceIds: new Set(), lastDate: null };
      byCustomer.set(record.customerId, acc);
    }
    acc.invoiceIds.add(record.invoiceId);
    if (acc.lastDate === null || record.invoiceDate > acc.lastDate) acc.lastDate = record.invoiceDate;
  }

  return [...byCustomer.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([customerId, acc]) => ({
      customerId,
      purchaseFrequency: acc.invoiceIds.size,
      lastPurchaseDate: acc.lastDate,
    }));
}
