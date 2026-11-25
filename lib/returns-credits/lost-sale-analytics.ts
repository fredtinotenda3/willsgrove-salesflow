import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getDeliveryReturnSummary, legacyReturnLossNotCoveredByDelivery } from "@/lib/lost-sales/delivery-returns";

/**
 * Real Business Data Onboarding round, Phase 7 (Claims analytics).
 *
 * Extends the Final Operational Enhancements spec Part 7 "lost sales by
 * source" split (lib/reporting/financial-exposure.ts's
 * LostSalesBySourceReport, Source A / Source B) with the one source it
 * genuinely didn't have a figure for yet: the confirmed loss recorded
 * automatically whenever a returned invoice claim's goods turn out to be
 * unsellable (ClaimReturnLostSale, Phase 6 of this round).
 *
 * This is deliberately presented as its own figure ("Source C"), never
 * folded into Source A or Source B:
 *   - It is NOT Source B: Source B's quantity was, by UnfulfilledDemand's
 *     own definition, never dispatched or invoiced at all. A
 *     ClaimReturnLostSale always traces back to an actual invoiced,
 *     delivered, and then returned line -- the opposite situation.
 *   - It is NOT simply addable to Source A either, even though both can
 *     describe the very same claim: Source A
 *     (claims.exposureByCurrency/potentialCreditExposure) is the
 *     DISPUTE's own claimed/exposure value -- it exists the moment a
 *     claim is raised, whether or not any goods are ever physically
 *     returned. This figure is a different, more concrete measurement of
 *     a SUBSET of those same claims: specifically, of the goods that
 *     were actually received back and physically inspected, the value
 *     of whatever the inspector found DAMAGED, EXPIRED, or otherwise
 *     unsellable (ReturnCondition -- a recorded physical fact, not a
 *     dispute amount). Adding this figure to Source A for the same claim
 *     lines would double-count the same underlying loss, once as a
 *     dispute estimate and again as a confirmed physical outcome -- see
 *     lib/reporting/financial-exposure.ts's own note, which states this
 *     explicitly next to Source A and Source B's genuine disjointness.
 *
 * Grouped by currency (like Source A, never summed across currencies)
 * because ClaimReturnLostSale.currencyCode is recorded per row -- unlike
 * Source B, which (per lib/lost-sales/estimate-value.ts's own documented
 * scope decision) never records one at all.
 *
 * Follow-up fix ("Preserve the separate detailed returned-claims report
 * if it is useful, but the main Lost Sales Analytics must consolidate
 * both sources"): this function and its one consumer
 * (lib/reporting/financial-exposure.ts) are UNCHANGED by that follow-up
 * -- this whole-business, currency-grouped SUMMARY remains exactly as
 * it was. The new row-level, filterable, combined-with-shortages view
 * the follow-up asked for lives in
 * lib/lost-sales/consolidated-analytics.ts's getConsolidatedLostSalesAnalytics
 * (rendered on /lost-sales/analytics alongside the existing shortage-only
 * charts), which reads the SAME underlying ClaimReturnLostSale rows via
 * lib/returns-credits/lost-sale-rows.ts's listReturnedProductLostSaleRows
 * -- never a second, independently-derived figure.
 */

export type ReturnedGoodsLostSalesBucket = {
  currencyCode: string; // "UNKNOWN" when the originating invoice had none on record
  recordCount: number; // genuine-loss returns in this currency that DID resolve to a real estimate
  estimatedValue: string;
};

export type ReturnedGoodsLostSalesValue = {
  /** Never summed across currencies -- same rule every other per-currency bucket list in this project follows. */
  byCurrency: ReturnedGoodsLostSalesBucket[];
  /** How many ClaimReturnLostSale rows (confirmed-loss returns) contributed a real value above. */
  recordsWithEstimate: number;
  /** How many confirmed-loss returns exist in total but had no resolvable price (no claimLineId, or that line's invoice carried none) -- never silently dropped from the count, so the UI can disclose that the total understates reality (same convention getSupplyShortageLostSalesValue already follows for Source B). */
  recordsWithoutEstimate: number;
  /** recordsWithEstimate + recordsWithoutEstimate -- every genuine-loss return recorded, priced or not. */
  totalLossRecords: number;
  /**
   * Where the figure above comes from. deliveryRejections is the primary,
   * automatic source (Record Delivery -> DeliveryLine.rejectedQuantity);
   * manualReturns are legacy ClaimReturn losses on claims that did NOT
   * originate from a delivery. They are disjoint, so byCurrency is their sum.
   */
  sources: {
    deliveryRejections: { recordCount: number; pricedRecordCount: number };
    manualReturns: { recordCount: number; pricedRecordCount: number };
  };
};

export async function getReturnedGoodsLostSalesValue(options?: { includeDemo?: boolean }): Promise<ReturnedGoodsLostSalesValue> {
  const includeDemo = options?.includeDemo ?? false;
  // Legacy manual returns, minus anything already counted from the delivery outcome (no double counting).
  const where: Prisma.ClaimReturnLostSaleWhereInput = { ...(includeDemo ? {} : { isDemo: false }), ...legacyReturnLossNotCoveredByDelivery() };

  const [totalCount, withEstimateCount, currencyGroups, delivery] = await Promise.all([
    prisma.claimReturnLostSale.count({ where }),
    prisma.claimReturnLostSale.count({ where: { ...where, estimatedValue: { not: null } } }),
    prisma.claimReturnLostSale.groupBy({
      by: ["currencyCode"],
      where: { ...where, estimatedValue: { not: null } },
      _sum: { estimatedValue: true },
      _count: { _all: true },
    }),
    getDeliveryReturnSummary({ includeDemo }),
  ]);

  const merged = new Map<string, { recordCount: number; value: Prisma.Decimal }>();
  const add = (currencyCode: string, recordCount: number, value: Prisma.Decimal) => {
    const current = merged.get(currencyCode) ?? { recordCount: 0, value: new Prisma.Decimal(0) };
    merged.set(currencyCode, { recordCount: current.recordCount + recordCount, value: current.value.plus(value) });
  };
  for (const row of currencyGroups) add(row.currencyCode ?? "UNKNOWN", row._count._all, row._sum.estimatedValue ?? new Prisma.Decimal(0));
  for (const bucket of delivery.byCurrency) add(bucket.currencyCode, bucket.pricedRecordCount, new Prisma.Decimal(bucket.value));

  const byCurrency: ReturnedGoodsLostSalesBucket[] = [...merged.entries()]
    .map(([currencyCode, entry]) => ({ currencyCode, recordCount: entry.recordCount, estimatedValue: entry.value.toString() }))
    .sort((a, b) => Number(b.estimatedValue) - Number(a.estimatedValue));

  const recordsWithEstimate = withEstimateCount + delivery.pricedRecordCount;
  return {
    byCurrency,
    recordsWithEstimate,
    recordsWithoutEstimate: totalCount - withEstimateCount + delivery.unpricedRecordCount,
    totalLossRecords: totalCount + delivery.recordCount,
    sources: {
      deliveryRejections: { recordCount: delivery.recordCount, pricedRecordCount: delivery.pricedRecordCount },
      manualReturns: { recordCount: totalCount, pricedRecordCount: withEstimateCount },
    },
  };
}
