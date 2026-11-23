import { multiplyDecimalStrings } from "@/lib/lost-sales/validation";

/**
 * Lost Value = the order-line Total for the quantity that was lost.
 *
 * The estimate stored on UnfulfilledDemand at creation time is
 * authoritative when present. When it is null (demand created before the
 * order line carried a price, or the price was added afterwards) the
 * value is derived at read time from the order line's own price snapshot
 * (`approvedUnitPrice ?? customerUnitPrice`, the same convention used
 * everywhere else) x the lost quantity -- exactly what the order's
 * "Total" column shows for that quantity (USD 2 x 10 KG = USD 20.00).
 *
 * Unpriced stays null -- never 0. Pure and synchronous so it is unit
 * tested without a database.
 */
export type EffectiveLostValueInput = {
  storedUnitPrice: string | null;
  storedValue: string | null;
  lineApprovedUnitPrice: string | null;
  lineCustomerUnitPrice: string | null;
  /** The lost quantity: confirmedLostQuantity, falling back to unavailableQuantity. */
  quantity: string;
};

export type EffectiveLostValue = {
  unitPrice: string | null;
  value: string | null;
  source: "STORED" | "ORDER_LINE_PRICE" | null;
};

export function resolveEffectiveLostValue(input: EffectiveLostValueInput): EffectiveLostValue {
  if (input.storedUnitPrice !== null && input.storedValue !== null) {
    return { unitPrice: input.storedUnitPrice, value: input.storedValue, source: "STORED" };
  }
  const linePrice = input.lineApprovedUnitPrice ?? input.lineCustomerUnitPrice;
  if (linePrice === null) return { unitPrice: null, value: null, source: null };
  const value = multiplyDecimalStrings(linePrice, input.quantity);
  if (value === null) return { unitPrice: null, value: null, source: null };
  return { unitPrice: linePrice, value, source: "ORDER_LINE_PRICE" };
}
