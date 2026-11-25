import { parseScaledDecimal } from "@/lib/picking/validation";
import { formatScaledDecimal } from "@/lib/fulfilment/decimal";

/**
 * Overall lost-sales view across the TWO distinct business categories:
 *
 *   1. Confirmed Loss (Returned Goods)  -- dispatched, delivered, REJECTED at
 *      the customer and returned (DeliveryLine.rejectedQuantity).
 *   2. Unfulfilled Demand               -- requested but never supplied
 *      (UnfulfilledDemand): by definition never dispatched or delivered.
 *
 * The two describe disjoint quantities (a unit is either never supplied, or
 * supplied and then returned), so adding their VALUES per currency cannot
 * double count. They stay separate categories everywhere else; this is only
 * the optional combined total. Unfulfilled demand records no currency of its
 * own -- it is priced from USD price lists -- so it is added to USD only.
 *
 * Pure: no Prisma, unit tested.
 */

export const UNFULFILLED_DEMAND_CURRENCY = "USD";

export type CategoryValue = { currencyCode: string; value: string };
export type CombinedLostSalesRow = { currencyCode: string; returnedGoods: string; unfulfilledDemand: string; total: string };

const ZERO = BigInt(0);

function big(value: string): bigint {
  return parseScaledDecimal(value) ?? ZERO;
}

export function combineLostSales(returnedGoods: readonly CategoryValue[], unfulfilledDemandValueUsd: string | null): CombinedLostSalesRow[] {
  const returned = new Map<string, bigint>();
  for (const row of returnedGoods) returned.set(row.currencyCode, (returned.get(row.currencyCode) ?? ZERO) + big(row.value));

  const unfulfilled = unfulfilledDemandValueUsd === null ? ZERO : big(unfulfilledDemandValueUsd);
  const currencies = new Set(returned.keys());
  if (unfulfilled !== ZERO) currencies.add(UNFULFILLED_DEMAND_CURRENCY);

  return [...currencies]
    .sort()
    .map((currencyCode) => {
      const r = returned.get(currencyCode) ?? ZERO;
      const u = currencyCode === UNFULFILLED_DEMAND_CURRENCY ? unfulfilled : ZERO;
      return { currencyCode, returnedGoods: formatScaledDecimal(r), unfulfilledDemand: formatScaledDecimal(u), total: formatScaledDecimal(r + u) };
    });
}
