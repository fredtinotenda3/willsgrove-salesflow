/**
 * Milestone 14 (Product Intelligence), spec section 7: "Implement
 * deterministic, explainable insights... Every insight must include:
 * product identifier, reason, supporting metric(s), relevant period,
 * data limitations where applicable, link to the Product 360 profile.
 * Never use an LLM to fabricate explanations. Never introduce arbitrary
 * thresholds, invented risk scores, or unsupported AI predictions."
 *
 * This module is pure (no @prisma/client import, no randomness, no LLM
 * call) -- every insight is a plain, reproducible function of the
 * metrics passed in. The caller (lib/reporting/product-insights-queries.ts)
 * is responsible for computing those metrics from real records only.
 *
 * On "deterministic... never arbitrary thresholds": the spec's own
 * illustrative examples use words like "repeated," "high," and
 * "significant," which inherently imply SOME cutoff. Rather than invent
 * a business-judgment number (e.g. "more than 3 claims is a concern"),
 * every rule below uses a STRUCTURAL cutoff that needs no judgment call:
 *   - "repeated" == occurred more than once (count >= 2) -- the plain
 *     dictionary meaning of the word, not a chosen business threshold.
 *   - "declining" == the current period's own figure is strictly lower
 *     than the immediately preceding period's, for the SAME currency --
 *     a direction, never a percentage magnitude (so no arbitrary "20%
 *     drop" bar, and no division -- zero-previous-period activity simply
 *     cannot be "declined into" from zero, and is handled without any
 *     division at all).
 *   - "credit notes significant relative to invoice activity" ==
 *     actual credit-note value in a currency is greater than or equal to
 *     the SAP invoice line value invoiced in that SAME currency in the
 *     same period -- a self-justifying 100% bar (credits have reached or
 *     exceeded what was invoiced), not a chosen percentage tier.
 * This choice is documented again, with the same reasoning, in
 * docs/milestones/m14-metric-definitions.md -- it is a deliberate
 * engineering decision made per spec section 15's own instruction to
 * "implement the closest defensible alternative... and clearly document
 * the limitation," not an oversight.
 */

export type ProductInsightMoneyRow = { currency: string; total: string };

export type ProductInsightMetrics = {
  sapItemCode: string;
  /** Product master id, when matched -- used only to build the Product 360 link; never used for identity. Null when this SAP item code has no matching Product row. */
  productId: string | null;
  periodFrom: string;
  periodTo: string;
  /** Null when the previous-period comparison could not be computed (e.g. an invalid/unbounded date range) -- every insight that depends on it is skipped, never computed against a guessed range. */
  previousPeriodFrom: string | null;
  previousPeriodTo: string | null;
  currentPeriodInvoiceValueByCurrency: readonly ProductInsightMoneyRow[];
  previousPeriodInvoiceValueByCurrency: readonly ProductInsightMoneyRow[];
  distinctCustomerCountCurrentPeriod: number;
  claimCountInPeriod: number;
  returnCountInPeriod: number;
  creditNoteValueByCurrencyInPeriod: readonly ProductInsightMoneyRow[];
  /** Confirmed LostSaleRecord count (spec 5.6: never an assumption that every unfulfilled order became a lost sale -- only CONFIRMED records count here). */
  confirmedLostSaleCountInPeriod: number;
  /** Count of DeliveryLine rows with rejectedQuantity > 0 for this product's dispatched order lines, in the period. */
  deliveryRejectionCountInPeriod: number;
  /** All-time qualifying-invoice count for this product -- used only for the insufficient-data check (fewer than 2 means no trend of any kind can be reliably assessed). */
  totalQualifyingInvoiceCountAllTime: number;
};

export type ProductInsightCategory =
  | "activity-with-repeated-claims"
  | "demand-with-repeated-unfulfilled-quantities"
  | "broad-customer-base-declining-activity"
  | "credit-notes-reach-or-exceed-invoiced-value"
  | "repeated-delivery-rejections"
  | "insufficient-data";

export type ProductInsight = {
  sapItemCode: string;
  productId: string | null;
  category: ProductInsightCategory;
  reason: string;
  supportingMetrics: Record<string, string | number>;
  period: { from: string; to: string };
  dataLimitations?: string;
};

/**
 * Generates every applicable insight for one product from its own
 * already-computed metrics. A product can surface more than one insight
 * at once (e.g. repeated claims AND repeated delivery rejections are not
 * mutually exclusive) -- each is reported as its own, separately
 * explainable row, never merged into a combined narrative.
 */
export function generateProductInsightsForProduct(metrics: ProductInsightMetrics): ProductInsight[] {
  const insights: ProductInsight[] = [];
  const period = { from: metrics.periodFrom, to: metrics.periodTo };

  // Insufficient data takes priority: if this product has never had
  // enough qualifying history to assess a trend, say so and skip every
  // other rule that would otherwise rest on a thin sample.
  if (metrics.totalQualifyingInvoiceCountAllTime < 2) {
    insights.push({
      sapItemCode: metrics.sapItemCode,
      productId: metrics.productId,
      category: "insufficient-data",
      reason: "Fewer than two qualifying invoices on record for this product -- no trend, decline, or recurring-issue pattern can be reliably assessed yet.",
      supportingMetrics: { totalQualifyingInvoiceCountAllTime: metrics.totalQualifyingInvoiceCountAllTime },
      period,
      dataLimitations: "Insufficient invoice history for any comparison-based insight.",
    });
    return insights;
  }

  if (metrics.claimCountInPeriod >= 2) {
    insights.push({
      sapItemCode: metrics.sapItemCode,
      productId: metrics.productId,
      category: "activity-with-repeated-claims",
      reason: `${metrics.claimCountInPeriod} invoice claims recorded against this product in the selected period -- more than one claim indicates a recurring, not one-off, quality or commercial concern.`,
      supportingMetrics: { claimCountInPeriod: metrics.claimCountInPeriod, returnCountInPeriod: metrics.returnCountInPeriod },
      period,
    });
  }

  if (metrics.confirmedLostSaleCountInPeriod >= 2) {
    insights.push({
      sapItemCode: metrics.sapItemCode,
      productId: metrics.productId,
      category: "demand-with-repeated-unfulfilled-quantities",
      reason: `${metrics.confirmedLostSaleCountInPeriod} confirmed lost-sale records for this product in the selected period -- recorded demand this product could not satisfy more than once.`,
      supportingMetrics: { confirmedLostSaleCountInPeriod: metrics.confirmedLostSaleCountInPeriod },
      period,
      dataLimitations: "Counts only CONFIRMED lost-sale records; not every unfulfilled order is assumed to have become a lost sale.",
    });
  }

  if (metrics.deliveryRejectionCountInPeriod >= 2) {
    insights.push({
      sapItemCode: metrics.sapItemCode,
      productId: metrics.productId,
      category: "repeated-delivery-rejections",
      reason: `${metrics.deliveryRejectionCountInPeriod} delivery lines for this product were rejected (partially or fully) in the selected period -- an operational pattern worth investigating.`,
      supportingMetrics: { deliveryRejectionCountInPeriod: metrics.deliveryRejectionCountInPeriod },
      period,
      dataLimitations: "Delivery rejections are an operational signal, not a commercial dispute -- never a quality-defect conclusion on their own.",
    });
  }

  for (const creditRow of metrics.creditNoteValueByCurrencyInPeriod) {
    const invoiceRow = metrics.currentPeriodInvoiceValueByCurrency.find((r) => r.currency === creditRow.currency);
    const invoicedValue = invoiceRow ? Number(invoiceRow.total) : 0;
    const creditValue = Number(creditRow.total);
    if (creditValue > 0 && creditValue >= invoicedValue) {
      insights.push({
        sapItemCode: metrics.sapItemCode,
        productId: metrics.productId,
        category: "credit-notes-reach-or-exceed-invoiced-value",
        reason: `Actual credit notes in ${creditRow.currency} (${creditRow.total}) reach or exceed the SAP invoice line value invoiced in ${creditRow.currency} in the same period (${invoicedValue}).`,
        supportingMetrics: { currency: creditRow.currency, creditNoteValueInPeriod: creditRow.total, invoiceLineValueInPeriod: String(invoicedValue) },
        period,
      });
    }
  }

  if (metrics.previousPeriodFrom && metrics.previousPeriodTo) {
    const decline = hasDeclineSimple(metrics.currentPeriodInvoiceValueByCurrency, metrics.previousPeriodInvoiceValueByCurrency);
    if (decline && metrics.distinctCustomerCountCurrentPeriod >= 2) {
      insights.push({
        sapItemCode: metrics.sapItemCode,
        productId: metrics.productId,
        category: "broad-customer-base-declining-activity",
        reason: `This product is purchased by ${metrics.distinctCustomerCountCurrentPeriod} distinct customers, yet its ${decline.currency} invoice line value fell from ${decline.previousValue} in the preceding period to ${decline.currentValue} in the selected period.`,
        supportingMetrics: {
          distinctCustomerCountCurrentPeriod: metrics.distinctCustomerCountCurrentPeriod,
          currency: decline.currency,
          previousPeriodValue: decline.previousValue,
          currentPeriodValue: decline.currentValue,
          previousPeriodFrom: metrics.previousPeriodFrom,
          previousPeriodTo: metrics.previousPeriodTo,
        },
        period,
      });
    }
  }

  return insights;
}

/**
 * Exported for reuse by lib/reporting/product-revenue-queries.ts's
 * management-overview "declining invoice activity" ranking (spec section
 * 4.B item 9) -- the SAME per-currency decline rule used for the Product
 * 360 single-product insight above, never a second, independently
 * maintained definition of "declining."
 */
export function hasDeclineSimple(
  current: readonly ProductInsightMoneyRow[],
  previous: readonly ProductInsightMoneyRow[]
): { currency: string; currentValue: string; previousValue: string } | null {
  for (const prevRow of previous) {
    const currentRow = current.find((c) => c.currency === prevRow.currency);
    const currentValue = currentRow ? Number(currentRow.total) : 0;
    const previousValue = Number(prevRow.total);
    if (currentValue < previousValue) {
      return { currency: prevRow.currency, currentValue: String(currentValue), previousValue: prevRow.total };
    }
  }
  return null;
}

export function generateProductInsights(metricsList: readonly ProductInsightMetrics[]): ProductInsight[] {
  return metricsList.flatMap((m) => generateProductInsightsForProduct(m));
}
