import { computeOrderPricing, describePricingGaps, resolveVatRatePercent, type OrderPricing } from "@/lib/order-pricing";

/**
 * ONE definition of "what is this order's total" for every screen and report
 * (operational list, admin list, admin detail, exports).
 *
 * Basis, in priority order:
 *   STORED      -- CustomerOrder.total is set (approved / SAP-confirmed amount) and wins.
 *   CALCULATED  -- derived by computeOrderPricing from the stored line price snapshots:
 *                  every line priced and every priced line has a configured tax rate.
 *   PARTIAL     -- some lines unpriced or untaxed; the amount covers only what is known.
 *   UNAVAILABLE -- no line has a price. The amount is null and `warning` says why:
 *                  a missing total is NEVER displayed as zero.
 *
 * Pure (no Prisma): importable from server and client code and unit-tested.
 */

export type TotalBasis = "STORED" | "CALCULATED" | "PARTIAL" | "UNAVAILABLE";

export type OrderTotalSummary = {
  amount: string | null;
  currency: string;
  basis: TotalBasis;
  pricedLineCount: number;
  unpricedLineCount: number;
  /** Human-readable data-quality warning, or null when the total is complete. */
  warning: string | null;
};

export type TotalLineSource = {
  requestedQuantity: { toString(): string };
  customerUnitPrice: { toString(): string } | null;
  approvedUnitPrice: { toString(): string } | null;
  product: { vatCode: string | null } | null;
};

export function pricingFromLines(lines: readonly TotalLineSource[], taxRates: ReadonlyMap<string, string>): OrderPricing {
  return computeOrderPricing(
    lines.map((line) => ({
      quantity: line.requestedQuantity.toString(),
      // Same `approvedUnitPrice ?? customerUnitPrice` snapshot convention used everywhere.
      unitPrice: (line.approvedUnitPrice ?? line.customerUnitPrice)?.toString() ?? null,
      vatRatePercent: resolveVatRatePercent(line.product?.vatCode, taxRates),
    }))
  );
}

export function summariseOrderTotal(input: { storedTotal: { toString(): string } | null; currency: string; pricing: OrderPricing }): OrderTotalSummary {
  const { storedTotal, currency, pricing } = input;
  const base = { currency, pricedLineCount: pricing.pricedLineCount, unpricedLineCount: pricing.unpricedLineCount };
  if (storedTotal !== null) return { ...base, amount: storedTotal.toString(), basis: "STORED", warning: null };
  if (pricing.total === null) {
    return { ...base, amount: null, basis: "UNAVAILABLE", warning: pricing.unpricedLineCount > 0 ? "No line on this order has a price, so no total can be calculated." : "This order has no lines." };
  }
  if (!pricing.isComplete) return { ...base, amount: pricing.total, basis: "PARTIAL", warning: describePricingGaps(pricing) };
  return { ...base, amount: pricing.total, basis: "CALCULATED", warning: null };
}
