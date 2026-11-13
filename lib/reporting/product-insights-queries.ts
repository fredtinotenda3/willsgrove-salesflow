import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reporting/types";
import { resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { getProductById } from "@/lib/product-queries";
import {
  getProductRevenueProfile,
  getProductPreviousPeriodRevenue,
  getProductRevenueOverview,
  getProductDecliningActivityOverview,
  getProductMasterDataQualityOverview,
  type ProductRevenueProfile,
  type ProductRevenueOverviewReport,
  type ProductDecliningActivityReport,
  type ProductMasterDataQualityReport,
} from "@/lib/reporting/product-revenue-queries";
import {
  getProductCustomerDemand,
  getProductRequestedDemand,
  getProductLostSalesSummary,
  getProductLostSalesRanking,
  type ProductCustomerDemandSummary,
  type ProductRequestedDemand,
  type ProductLostSalesSummary,
  type ProductLostSalesRankingRow,
} from "@/lib/reporting/product-demand-queries";
import {
  getProductCommercialHealth,
  getProductClaimAndReturnOverview,
  getProductCreditNoteValueOverview,
  type ProductCommercialHealth,
  type ProductClaimActivityRow,
  type ProductCreditNoteValueRow,
} from "@/lib/reporting/product-commercial-health-queries";
import {
  getProductFulfilmentSummary,
  getProductDeliveryRejectionOverview,
  type ProductFulfilmentSummary,
  type ProductDeliveryRejectionRow,
} from "@/lib/reporting/product-fulfilment-queries";
import { generateProductInsightsForProduct, type ProductInsight, type ProductInsightMetrics } from "@/lib/reporting/product-insights";

/**
 * Milestone 14 (Product Intelligence). The composite Product 360 read
 * function (getProductProfile) and the composite management overview
 * assembly (getProductIntelligenceOverview) -- same role as Milestone
 * 13's lib/reporting/customer-insights-queries.ts: pure composition of
 * already-built M14 modules, never a re-derived business rule of its
 * own. The one genuinely new piece of logic in this file is the
 * Product-master join that fills in `productId` on
 * getProductClaimAndReturnOverview's rows (that file's own comment
 * explains why it always returns `productId: null` itself -- the join
 * belongs at the assembly layer, which already has every dimension's
 * sapItemCode universe in hand, not duplicated inside each dimension's
 * own query file).
 *
 * Only exercised via RUN_DB_INTEGRATION_TESTS=1, same reason as every
 * other *-queries.ts file in this project.
 */

export type ProductProfile = {
  product: NonNullable<Awaited<ReturnType<typeof>>>;
  revenue: ProductRevenueProfile;
  customerDemand: ProductCustomerDemandSummary;
  requestedDemand: ProductRequestedDemand;
  lostSales: ProductLostSalesSummary;
  commercialHealth: ProductCommercialHealth;
  fulfilment: ProductFulfilmentSummary;
  /** Deterministic, explainable insights (spec section 7) -- generated from this product's own already-computed metrics above, never a second independent fetch. */
  insights: ProductInsight[];
};

export async function getProductProfile(id: string, filters: ReportFilters): Promise<ProductProfile | null> {
  const product = await getProductById(id);
  if (!product) return null;

  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const sapItemCode = product.sapItemCode;

  const [revenue, previousRevenue, customerDemand, requestedDemand, lostSales, commercialHealth, fulfilment] = await Promise.all([
    getProductRevenueProfile(sapItemCode, filters),
    getProductPreviousPeriodRevenue(sapItemCode, filters),
    getProductCustomerDemand(sapItemCode, filters),
    getProductRequestedDemand(sapItemCode, product.id, filters),
    getProductLostSalesSummary(sapItemCode, product.id, filters),
    getProductCommercialHealth(sapItemCode, filters),
    getProductFulfilmentSummary(sapItemCode, product.id, filters),
  ]);

  const returnCountInPeriod = commercialHealth.returns.inPeriodByCondition.reduce((sum, r) => sum + r.count, 0);

  const metrics: ProductInsightMetrics = {
    sapItemCode,
    productId: product.id,
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    previousPeriodFrom: previousRevenue.previousPeriodFrom,
    previousPeriodTo: previousRevenue.previousPeriodTo,
    currentPeriodInvoiceValueByCurrency: revenue.byCurrency.map((r) => ({ currency: r.currency, total: r.lineValueTotal })),
    previousPeriodInvoiceValueByCurrency: previousRevenue.byCurrency,
    distinctCustomerCountCurrentPeriod: revenue.distinctCustomerCountInPeriod,
    claimCountInPeriod: commercialHealth.claims.raisedInPeriodCount,
    returnCountInPeriod,
    creditNoteValueByCurrencyInPeriod: commercialHealth.actualCreditNotes.inPeriodByCurrency,
    confirmedLostSaleCountInPeriod: lostSales.confirmedLostSaleCount,
    deliveryRejectionCountInPeriod: fulfilment.deliveryLinesWithRejectionCount,
    totalQualifyingInvoiceCountAllTime: revenue.history.totalQualifyingInvoiceCountAllTime,
  };

  return {
    product,
    revenue,
    customerDemand,
    requestedDemand,
    lostSales,
    commercialHealth,
    fulfilment,
    insights: generateProductInsightsForProduct(metrics),
  };
}

// ---------------------------------------------------------------------------
// Management overview: every spec section 4.B ranking dimension, each
// kept under its OWN named key below -- never combined into one
// composite score (spec: "do not combine these independent dimensions
// into one composite score"). Dimensions 1-4 come from one already-
// batched query (getProductRevenueOverview); dimensions 5-10 each have
// their own already-built, independently-queried function. This function
// does no per-product looping of its own -- it is a bounded number of
// calls to those functions plus ONE small Product-master join to fill in
// productId on the claim/return dimension's rows, regardless of how many
// products exist.
// ---------------------------------------------------------------------------

export type ProductIntelligenceOverviewReport = {
  periodFrom: string;
  periodTo: string;
  previousPeriodFrom: string | null;
  previousPeriodTo: string | null;
  metricLabel: string;
  /** Items 1-4: SAP invoice line value by currency, invoiced quantity by unit, invoice frequency, distinct purchasing customers. */
  revenueQuantityFrequencyCustomers: ProductRevenueOverviewReport;
  /** Item 5: highest recorded lost-sales activity. */
  lostSalesActivity: { periodFrom: string; periodTo: string; rows: ProductLostSalesRankingRow[] };
  /** Item 6: highest claim and return activity. */
  claimAndReturnActivity: { rows: ProductClaimActivityRow[]; multiProductClaimCount: number };
  /** Item 7: highest actual credit-note values, by currency. */
  creditNoteValue: { rows: ProductCreditNoteValueRow[]; unattributableCreditNoteCount: number };
  /** Item 8: highest recorded delivery rejection quantities. */
  deliveryRejections: { periodFrom: string; periodTo: string; rows: ProductDeliveryRejectionRow[] };
  /** Item 9: declining invoice activity vs. the previous comparable period. */
  decliningActivity: ProductDecliningActivityReport;
  /** Item 10: incomplete or unmatched master data -- a flagged list, never a value ranking (see lib/reporting/product-revenue-queries.ts's own comment on this dimension). */
  masterDataQuality: ProductMasterDataQualityReport;
};

export async function getProductIntelligenceOverview(filters: ReportFilters): Promise<ProductIntelligenceOverviewReport> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);

  const [revenueQuantityFrequencyCustomers, lostSalesRows, claimAndReturnActivity, creditNoteValue, deliveryRejectionRows, decliningActivity, masterDataQuality] = await Promise.all([
    getProductRevenueOverview(filters),
    getProductLostSalesRanking(filters),
    getProductClaimAndReturnOverview(filters),
    getProductCreditNoteValueOverview(filters),
    getProductDeliveryRejectionOverview(filters),
    getProductDecliningActivityOverview(filters),
    getProductMasterDataQualityOverview(filters),
  ]);

  // getProductClaimAndReturnOverview deliberately never resolves
  // productId itself (claims/returns are attributed by sapItemCode only,
  // never via a Product-master join at that layer -- see that file's own
  // comment). Resolved here, once, for the whole ranking's universe.
  const claimItemCodes = claimAndReturnActivity.rows.map((r) => r.sapItemCode);
  const claimProducts = claimItemCodes.length > 0 ? await prisma.product.findMany({ where: { sapItemCode: { in: claimItemCodes } }, select: { id: true, sapItemCode: true } }) : [];
  const productIdByItemCode = new Map(claimProducts.map((p) => [p.sapItemCode, p.id]));
  const claimAndReturnRowsWithProductId = claimAndReturnActivity.rows.map((r) => ({ ...r, productId: productIdByItemCode.get(r.sapItemCode) ?? null }));

  return {
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    previousPeriodFrom: decliningActivity.previousPeriodFrom,
    previousPeriodTo: decliningActivity.previousPeriodTo,
    metricLabel: revenueQuantityFrequencyCustomers.metricLabel,
    revenueQuantityFrequencyCustomers,
    lostSalesActivity: lostSalesRows,
    claimAndReturnActivity: { rows: claimAndReturnRowsWithProductId, multiProductClaimCount: claimAndReturnActivity.multiProductClaimCount },
    creditNoteValue,
    deliveryRejections: deliveryRejectionRows,
    decliningActivity,
    masterDataQuality,
  };
}
