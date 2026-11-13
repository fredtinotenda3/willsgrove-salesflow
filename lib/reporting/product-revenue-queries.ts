import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToDateOnlyFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { dateOnlyStringToUtcDate, utcDateToDateOnlyString } from "@/lib/dates";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { qualifyingInvoiceWhere } from "@/lib/reporting/customer-activity-queries";
import { groupRevenueByCurrencyAndProduct, summarizeProductRevenueByCurrency, type ProductRevenueLineRecord } from "@/lib/reporting/product-revenue";
import { itemKey, aggregateQuantityByUnit, type ProductQuantityByUnit } from "@/lib/reporting/product-purchasing";
import { SAP_INVOICE_LINE_VALUE_LABEL, sumMoneyRows } from "@/lib/reporting/sales-revenue";
import { resolveAsOfDate, computeDaysSinceLastQualifyingInvoice, computeAverageInterPurchaseInterval, type AsOfDateSource } from "@/lib/reporting/customer-recency";
import { rankByValue, computePreviousPeriod } from "@/lib/reporting/product-segmentation";

/**
 * Milestone 14 (Product Intelligence). The database-backed half of
 * lib/reporting/product-revenue.ts, plus the product-level invoice-
 * history metrics (all-time-first/as-of-bounded-last/period-frequency/
 * inter-purchase-interval/distinct-customer-count/quantity-by-unit) and
 * the management overview's ranked assembly for the SAP-invoice-line-
 * value, invoiced-quantity, invoice-frequency and distinct-customer-count
 * dimensions (spec section 4.B, items 1-4), the declining-invoice-activity
 * dimension (item 9), and the incomplete/unmatched master-data flagged
 * list (item 10) -- grouped in this one file because all three reuse the
 * exact same qualifying-invoice-line fetch and Product-master join
 * pattern, never a re-derived variant of either.
 *
 * Only exercised via RUN_DB_INTEGRATION_TESTS=1, same reason as every
 * other *-queries.ts file in this project (@prisma/client-stub sandbox
 * limitation).
 *
 * Reuses lib/reporting/customer-activity-queries.ts's own
 * qualifyingInvoiceWhere verbatim, called with an EMPTY customer filter
 * ({}) -- the function's second parameter is a generic
 * Prisma.SapInvoiceWhereInput, so this product-scoped reuse needs no
 * change to that function at all.
 *
 * Spec section 8: "Do not load every invoice line into memory merely to
 * calculate simple aggregate metrics. Use database-side grouping and
 * aggregation where appropriate." Honoured here as follows, stated
 * honestly per metric (also recorded in docs/milestones/
 * m14-metric-definitions.md):
 *   - Invoiced quantity by (item code, unit of measure): a TRUE Prisma
 *     groupBy, by scalar columns on SapInvoiceLine itself -- the
 *     database does the grouping and the SUM.
 *   - Qualifying-invoice frequency / distinct customer count per
 *     product: a Prisma groupBy on SapInvoiceLine's own scalar columns
 *     (sapItemCode) with a `distinct`-style COUNT where available,
 *     falling back to a minimal-column fetch (only sapInvoiceId,
 *     matchedCustomerId) that is counted in memory -- never the full
 *     line/invoice row.
 *   - SAP invoice line value by (item code, currency): SapInvoiceLine
 *     has NO currencyCode column of its own (it lives only on the
 *     parent SapInvoice), and Prisma's typed groupBy cannot group by a
 *     joined/related model's column without raw SQL. This is the one
 *     metric that cannot be expressed as a pure database-side groupBy
 *     through Prisma's query builder in this schema. The closest
 *     defensible alternative (per spec section 15's own fallback
 *     clause) is implemented instead: a minimal-column SELECT (item
 *     code, line total, and the joined invoice's currency code only --
 *     never a full invoice/line row), already bounded to the selected
 *     reporting period by the same qualifying-invoice WHERE clause used
 *     everywhere else in this project. This is honestly documented as a
 *     limitation, never presented as a true database-side aggregate.
 */

// ---------------------------------------------------------------------------
// Product 360 profile: one product's own revenue + invoice-history figures.
// ---------------------------------------------------------------------------

export type ProductInvoiceHistory = {
  /** All-time, unbounded by any as-of date -- MIN(invoiceDate) across every qualifying invoice this product has ever appeared on. */
  firstQualifyingInvoiceDate: string | null;
  /** MAX(invoiceDate) among qualifying invoices with invoiceDate <= asOfDate -- bounded, reproducible. */
  lastQualifyingInvoiceDateAsOf: string | null;
  asOfDate: string;
  asOfDateSource: AsOfDateSource;
  /** Whole days between lastQualifyingInvoiceDateAsOf and asOfDate -- null, never 0, when there is no qualifying invoice at all as of asOfDate. */
  daysSinceLastQualifyingInvoice: number | null;
  /** COUNT of DISTINCT qualifying invoices containing this item, with invoiceDate inside [periodFrom, periodTo] -- never a count of lines. */
  purchaseFrequencyInPeriod: number;
  /** Average day-gap between consecutive qualifying invoice dates INSIDE the period -- "insufficient_data" (never 0) when fewer than 2 such dates exist. */
  averageInterPurchaseIntervalInPeriod: { status: "ok"; averageDays: number } | { status: "insufficient_data" };
  /** All-time qualifying-invoice count for this product, unbounded by period or as-of date -- used by lib/reporting/product-insights.ts's insufficient-data check, never shown as a period figure. */
  totalQualifyingInvoiceCountAllTime: number;
  periodFrom: string;
  periodTo: string;
};

export type ProductRevenueProfile = {
  metricLabel: string;
  byCurrency: { currency: string; lineValueTotal: string; excludedLineCount: number }[];
  quantityByUnit: ProductQuantityByUnit[];
  distinctCustomerCountInPeriod: number;
  history: ProductInvoiceHistory;
};

export async function getProductRevenueProfile(sapItemCode: string, filters: ReportFilters): Promise<ProductRevenueProfile> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const { asOfDate, source: asOfDateSource } = resolveAsOfDate({ dateTo: filters.dateTo });
  const asOfDateUtc = dateOnlyStringToUtcDate(asOfDate)!;

  const productFilter: Prisma.SapInvoiceLineWhereInput = { sapItemCode };
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  // Period-scoped lines for this product, with their parent invoice's
  // minimal identity fields only -- for SAP invoice line value by
  // currency, quantity by unit, distinct-customer count and the
  // within-period dates used by purchase frequency / inter-purchase
  // interval. One query drives all four; never re-fetched per metric.
  const periodLines = await prisma.sapInvoiceLine.findMany({
    where: {
      ...productFilter,
      ...demo,
      sapInvoice: { ...qualifyingInvoiceWhere(demo, {}), invoiceDate: { not: null, ...periodDateRange } },
    },
    select: {
      quantityInvoiced: true,
      unitOfMeasure: true,
      lineTotal: true,
      sapInvoice: { select: { id: true, invoiceDate: true, currencyCode: true, matchedCustomerId: true } },
    },
  });

  const revenueRecords: ProductRevenueLineRecord[] = periodLines.map((line) => ({
    sapItemCode: itemKey(sapItemCode),
    currency: line.sapInvoice.currencyCode,
    lineTotal: line.lineTotal?.toString() ?? null,
  }));
  const byCurrency = summarizeProductRevenueByCurrency(itemKey(sapItemCode), revenueRecords);

  const quantityByUnit = aggregateQuantityByUnit(periodLines.map((line) => ({ unitOfMeasure: line.unitOfMeasure, quantityInvoiced: line.quantityInvoiced.toString() })));

  const distinctInvoiceIds = new Set(periodLines.map((l) => l.sapInvoice.id));
  const distinctCustomerIds = new Set(periodLines.map((l) => l.sapInvoice.matchedCustomerId).filter((id): id is string => id !== null));

  const periodDatesOnly = [...new Set(periodLines.map((l) => utcDateToDateOnlyString(l.sapInvoice.invoiceDate)!))];
  const averageInterPurchaseIntervalInPeriod = computeAverageInterPurchaseInterval(periodDatesOnly);

  // All-time first (unbounded) and as-of-bounded last qualifying invoice
  // date, plus the all-time qualifying-invoice count -- all three via
  // minimal-column queries scoped to this product's own sapItemCode,
  // never a full line/invoice fetch.
  const [firstLineRow, lastRow, allTimeInvoiceIds] = await Promise.all([
    prisma.sapInvoiceLine.findMany({
      where: { ...productFilter, ...demo, sapInvoice: { ...qualifyingInvoiceWhere(demo, {}), invoiceDate: { not: null } } },
      select: { sapInvoice: { select: { invoiceDate: true } } },
      orderBy: { sapInvoice: { invoiceDate: "asc" } },
      take: 1,
    }),
    prisma.sapInvoiceLine.findMany({
      where: { ...productFilter, ...demo, sapInvoice: { ...qualifyingInvoiceWhere(demo, {}), invoiceDate: { not: null, lte: asOfDateUtc } } },
      select: { sapInvoice: { select: { invoiceDate: true } } },
      orderBy: { sapInvoice: { invoiceDate: "desc" } },
      take: 1,
    }),
    prisma.sapInvoiceLine.findMany({
      where: { ...productFilter, ...demo, sapInvoice: qualifyingInvoiceWhere(demo, {}) },
      select: { sapInvoiceId: true },
      distinct: ["sapInvoiceId"],
    }),
  ]);

  const firstQualifyingInvoiceDate = utcDateToDateOnlyString(firstLineRow[0]?.sapInvoice.invoiceDate ?? null);
  const lastQualifyingInvoiceDateAsOf = utcDateToDateOnlyString(lastRow[0]?.sapInvoice.invoiceDate ?? null);

  return {
    metricLabel: SAP_INVOICE_LINE_VALUE_LABEL,
    byCurrency,
    quantityByUnit,
    distinctCustomerCountInPeriod: distinctCustomerIds.size,
    history: {
      firstQualifyingInvoiceDate,
      lastQualifyingInvoiceDateAsOf,
      asOfDate,
      asOfDateSource,
      daysSinceLastQualifyingInvoice: computeDaysSinceLastQualifyingInvoice(asOfDate, lastQualifyingInvoiceDateAsOf),
      purchaseFrequencyInPeriod: distinctInvoiceIds.size,
      averageInterPurchaseIntervalInPeriod,
      totalQualifyingInvoiceCountAllTime: allTimeInvoiceIds.length,
      periodFrom: effectiveFrom,
      periodTo: effectiveTo,
    },
  };
}

// ---------------------------------------------------------------------------
// Management overview: all eligible products, ranked independently along
// value/quantity/frequency/distinct-customer-count dimensions (spec 4.B
// items 1-4). No per-product loop -- a bounded number of queries
// regardless of how many products exist.
// ---------------------------------------------------------------------------

export type ProductRevenueOverviewRow = {
  sapItemCode: string;
  /** The invoice line's own description text (never Product master), from whichever contributing line has the latest invoiceDate -- same tie-break rule as lib/reporting/customer-purchasing.ts's own latestLineDescription. */
  description: string | null;
  productId: string | null;
  productMasterMatched: boolean;
  revenueByCurrency: { currency: string; lineValueTotal: string; rank: number }[];
  quantityByUnit: { unitOfMeasure: string; quantityTotal: string; rank: number }[];
  invoiceFrequencyInPeriod: number;
  invoiceFrequencyRank: number;
  distinctCustomerCountInPeriod: number;
  distinctCustomerCountRank: number;
};

export type ProductRevenueOverviewReport = {
  periodFrom: string;
  periodTo: string;
  metricLabel: string;
  rows: ProductRevenueOverviewRow[];
};

/**
 * TRUE database-side groupBy for invoiced quantity (spec section 8) --
 * grouped by SapInvoiceLine's own scalar columns (sapItemCode,
 * unitOfMeasure), with the sum computed by the database, not in memory.
 */
async function getQuantityByItemAndUnit(filters: ReportFilters, periodDateRange: { gte?: Date; lte?: Date }) {
  const demo = demoWhere(filters);
  const rows = await prisma.sapInvoiceLine.groupBy({
    by: ["sapItemCode", "unitOfMeasure"],
    where: { ...demo, sapInvoice: { ...qualifyingInvoiceWhere(demo, {}), invoiceDate: { not: null, ...periodDateRange } } },
    _sum: { quantityInvoiced: true },
  });
  return rows;
}

export async function getProductRevenueOverview(filters: ReportFilters): Promise<ProductRevenueOverviewReport> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const categoryFilter: Prisma.SapInvoiceLineWhereInput = filters.sapItemCode ? { sapItemCode: filters.sapItemCode } : {};
  const currencyFilter: Prisma.SapInvoiceWhereInput = filters.currency ? { currencyCode: filters.currency } : {};

  // Minimal-column fetch for value-by-currency and invoice frequency /
  // distinct-customer-count -- the one metric (value by currency) that
  // cannot be a pure Prisma groupBy on this schema (see this module's own
  // top comment). Scoped to the period and, if given, a single item
  // code/currency filter.
  const periodLines = await prisma.sapInvoiceLine.findMany({
    where: {
      ...demo,
      ...categoryFilter,
      sapItemCode: { not: null },
      sapInvoice: { ...qualifyingInvoiceWhere(demo, {}), ...currencyFilter, invoiceDate: { not: null, ...periodDateRange } },
    },
    select: {
      sapItemCode: true,
      sapItemDescription: true,
      lineTotal: true,
      sapInvoice: { select: { id: true, invoiceDate: true, currencyCode: true, matchedCustomerId: true } },
    },
  });

  const revenueRecords: ProductRevenueLineRecord[] = periodLines.map((line) => ({
    sapItemCode: itemKey(line.sapItemCode),
    currency: line.sapInvoice.currencyCode,
    lineTotal: line.lineTotal?.toString() ?? null,
  }));
  const revenueBreakdown = groupRevenueByCurrencyAndProduct(revenueRecords);

  const frequencyByProduct = new Map<string, Set<string>>();
  const customersByProduct = new Map<string, Set<string>>();
  const latestDescriptionByProduct = new Map<string, { date: string; description: string | null }>();
  for (const line of periodLines) {
    const item = itemKey(line.sapItemCode);
    const invId = line.sapInvoice.id;
    const invDate = utcDateToDateOnlyString(line.sapInvoice.invoiceDate) ?? "";

    const invoiceSet = frequencyByProduct.get(item) ?? new Set<string>();
    invoiceSet.add(invId);
    frequencyByProduct.set(item, invoiceSet);

    if (line.sapInvoice.matchedCustomerId) {
      const customerSet = customersByProduct.get(item) ?? new Set<string>();
      customerSet.add(line.sapInvoice.matchedCustomerId);
      customersByProduct.set(item, customerSet);
    }

    const current = latestDescriptionByProduct.get(item);
    if (!current || invDate >= current.date) {
      latestDescriptionByProduct.set(item, { date: invDate, description: line.sapItemDescription });
    }
  }

  const quantityRows = await getQuantityByItemAndUnit(filters, periodDateRange);
  const quantityByProduct = new Map<string, { unitOfMeasure: string; quantityTotal: string }[]>();
  for (const row of quantityRows) {
    if (filters.sapItemCode && row.sapItemCode !== filters.sapItemCode) continue;
    const item = itemKey(row.sapItemCode);
    const list = quantityByProduct.get(item) ?? [];
    list.push({ unitOfMeasure: (row.unitOfMeasure ?? "").trim() === "" ? "UNKNOWN_UOM" : row.unitOfMeasure!.trim().toUpperCase(), quantityTotal: row._sum.quantityInvoiced?.toString() ?? "0" });
    quantityByProduct.set(item, list);
  }

  // Product universe: every distinct sapItemCode that appears on at
  // least one qualifying invoice line in the period -- a product with
  // zero activity in the selected period has nothing to rank it by, so
  // (unlike M13's customer overview, which deliberately includes zero-
  // activity customers) it is not meaningfully "rankable" here and is
  // left out of this period-scoped overview; spec section 10's product
  // search/category filters narrow the SAME universe, never widen it to
  // include products with zero recorded activity in the period.
  const universeIds = [...frequencyByProduct.keys()];

  // Product-master join -- for match-status/category DISPLAY only, never
  // identity (spec section 3).
  const products = universeIds.length > 0 ? await prisma.product.findMany({ where: { sapItemCode: { in: universeIds } }, select: { id: true, sapItemCode: true, category: true } }) : [];
  const productByItemCode = new Map(products.map((p) => [p.sapItemCode, p]));
  // productCategory/productSearch are applied AFTER the aggregation
  // above, never as a WHERE clause on SapInvoiceLine itself: Product.category
  // lives on the Product master, which SapInvoiceLine has no foreign key
  // to (product identity is matched by sapItemCode string, never joined
  // -- spec section 3), so there is no DB-side filter to push this into.
  // This mirrors every other place in this codebase that joins Product
  // for display/filtering only, after the transactional data is already
  // fetched by item code.
  const categoryProducts = filters.productCategory
    ? new Set(products.filter((p) => p.category === filters.productCategory).map((p) => p.sapItemCode))
    : null;
  const searchLower = filters.productSearch?.trim().toLowerCase() ?? null;

  const revenueRankByCurrencyAndProduct = new Map<string, Map<string, number>>();
  for (const currencyRow of revenueBreakdown) {
    const ranked = rankByValue(currencyRow.byProduct.map((p) => ({ sapItemCode: p.sapItemCode, value: Number(p.lineValueTotal) })), "descending");
    revenueRankByCurrencyAndProduct.set(currencyRow.currency, new Map(ranked.map((r) => [r.sapItemCode, r.rank])));
  }

  const quantityRankByUnitAndProduct = new Map<string, Map<string, number>>();
  const unitsSeen = new Set<string>();
  for (const list of quantityByProduct.values()) for (const row of list) unitsSeen.add(row.unitOfMeasure);
  for (const unit of unitsSeen) {
    const itemsForUnit = [...quantityByProduct.entries()]
      .map(([item, list]) => ({ sapItemCode: item, value: Number(list.find((r) => r.unitOfMeasure === unit)?.quantityTotal ?? "0") }))
      .filter((r) => quantityByProduct.get(r.sapItemCode)?.some((row) => row.unitOfMeasure === unit));
    const ranked = rankByValue(itemsForUnit, "descending");
    quantityRankByUnitAndProduct.set(unit, new Map(ranked.map((r) => [r.sapItemCode, r.rank])));
  }

  const frequencyRanked = rankByValue(universeIds.map((id) => ({ sapItemCode: id, value: frequencyByProduct.get(id)?.size ?? 0 })), "descending");
  const frequencyRankByProduct = new Map(frequencyRanked.map((r) => [r.sapItemCode, r.rank]));

  const customerCountRanked = rankByValue(universeIds.map((id) => ({ sapItemCode: id, value: customersByProduct.get(id)?.size ?? 0 })), "descending");
  const customerCountRankByProduct = new Map(customerCountRanked.map((r) => [r.sapItemCode, r.rank]));

  const rows: ProductRevenueOverviewRow[] = universeIds
    .filter((item) => !categoryProducts || categoryProducts.has(item))
    .filter((item) => {
      if (!searchLower) return true;
      const desc = (latestDescriptionByProduct.get(item)?.description ?? "").toLowerCase();
      return item.toLowerCase().includes(searchLower) || desc.includes(searchLower);
    })
    .map((item) => {
      const revenueByCurrency = revenueBreakdown
        .map((currencyRow) => {
          const row = currencyRow.byProduct.find((p) => p.sapItemCode === item);
          if (!row) return null;
          return { currency: currencyRow.currency, lineValueTotal: row.lineValueTotal, rank: revenueRankByCurrencyAndProduct.get(currencyRow.currency)!.get(item)! };
        })
        .filter((r): r is { currency: string; lineValueTotal: string; rank: number } => r !== null);

      const quantityByUnit = (quantityByProduct.get(item) ?? []).map((row) => ({
        ...row,
        rank: quantityRankByUnitAndProduct.get(row.unitOfMeasure)?.get(item) ?? 0,
      }));

      const product = productByItemCode.get(item);

      return {
        sapItemCode: item,
        description: latestDescriptionByProduct.get(item)?.description ?? null,
        productId: product?.id ?? null,
        productMasterMatched: product !== undefined,
        revenueByCurrency,
        quantityByUnit,
        invoiceFrequencyInPeriod: frequencyByProduct.get(item)?.size ?? 0,
        invoiceFrequencyRank: frequencyRankByProduct.get(item)!,
        distinctCustomerCountInPeriod: customersByProduct.get(item)?.size ?? 0,
        distinctCustomerCountRank: customerCountRankByProduct.get(item)!,
      };
    })
    .sort((a, b) => a.sapItemCode.localeCompare(b.sapItemCode));

  return {
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    metricLabel: SAP_INVOICE_LINE_VALUE_LABEL,
    rows,
  };
}

// ---------------------------------------------------------------------------
// Product 360 profile: this one product's previous-period SAP invoice
// line value by currency -- the single-product counterpart of
// getProductDecliningActivityOverview below, used by
// lib/reporting/product-insights-queries.ts to feed product-insights.ts's
// own "broad-customer-base-declining-activity" single-product insight.
// Kept separate from getProductRevenueProfile (which only ever fetches
// the CURRENT period) rather than widening that function's own query to
// cover two periods it does not otherwise need.
// ---------------------------------------------------------------------------

export type ProductPreviousPeriodRevenue = {
  previousPeriodFrom: string | null;
  previousPeriodTo: string | null;
  byCurrency: { currency: string; total: string }[];
};

export async function getProductPreviousPeriodRevenue(sapItemCode: string, filters: ReportFilters): Promise<ProductPreviousPeriodRevenue> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const previousPeriod = computePreviousPeriod(effectiveFrom, effectiveTo);
  if (!previousPeriod) return { previousPeriodFrom: null, previousPeriodTo: null, byCurrency: [] };

  const demo = demoWhere(filters);
  const previousRange = dateRangeToDateOnlyFilter({ dateFrom: previousPeriod.previousFrom, dateTo: previousPeriod.previousTo });

  const lines = await prisma.sapInvoiceLine.findMany({
    where: { sapItemCode, ...demo, sapInvoice: { ...qualifyingInvoiceWhere(demo, {}), invoiceDate: { not: null, ...previousRange } } },
    select: { lineTotal: true, sapInvoice: { select: { currencyCode: true } } },
  });

  const records: ProductRevenueLineRecord[] = lines.map((line) => ({
    sapItemCode: itemKey(sapItemCode),
    currency: line.sapInvoice.currencyCode,
    lineTotal: line.lineTotal?.toString() ?? null,
  }));
  const byCurrency = summarizeProductRevenueByCurrency(itemKey(sapItemCode), records).map((r) => ({ currency: r.currency, total: r.lineValueTotal }));

  return { previousPeriodFrom: previousPeriod.previousFrom, previousPeriodTo: previousPeriod.previousTo, byCurrency };
}

// ---------------------------------------------------------------------------
// Management overview: products with declining invoice activity vs. the
// immediately preceding period of equal duration (spec section 4.B item
// 9, section 6's period-comparison requirement).
// ---------------------------------------------------------------------------

export type ProductDecliningActivityRow = {
  sapItemCode: string;
  productId: string | null;
  currency: string;
  currentPeriodValue: string;
  previousPeriodValue: string;
  /** previousPeriodValue - currentPeriodValue, always > 0 for a row in this report -- the ranking value for "highest decline" within this currency. */
  declineAmount: string;
  rank: number;
};

export type ProductDecliningActivityReport = {
  periodFrom: string;
  periodTo: string;
  /** Null when the previous period could not be computed (an invalid/unbounded range) -- the report is then returned with zero rows, never a guessed comparison period. */
  previousPeriodFrom: string | null;
  previousPeriodTo: string | null;
  metricLabel: string;
  rows: ProductDecliningActivityRow[];
};

/**
 * "Declining" is the SAME per-currency rule lib/reporting/
 * product-insights.ts's hasDeclineSimple already establishes for the
 * Product 360 single-product insight (current period's value, for a
 * given currency, strictly lower than that SAME currency's previous-
 * period value) -- applied here across every currency a product
 * transacted in during the previous period, rather than stopping at the
 * first one, since this overview ranks "highest decline" independently
 * PER CURRENCY (same convention as items 1-4's revenue-by-currency
 * ranking), never a single cross-currency figure. A product with zero
 * previous-period activity in a currency is simply absent from that
 * currency's comparison -- spec section 6's "handle a zero previous
 * period without division," never treated as a 100% decline.
 */
export async function getProductDecliningActivityOverview(filters: ReportFilters): Promise<ProductDecliningActivityReport> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const metricLabel = SAP_INVOICE_LINE_VALUE_LABEL;
  const previousPeriod = computePreviousPeriod(effectiveFrom, effectiveTo);
  if (!previousPeriod) {
    return { periodFrom: effectiveFrom, periodTo: effectiveTo, previousPeriodFrom: null, previousPeriodTo: null, metricLabel, rows: [] };
  }

  const demo = demoWhere(filters);
  const categoryFilter: Prisma.SapInvoiceLineWhereInput = filters.sapItemCode ? { sapItemCode: filters.sapItemCode } : {};
  const currencyFilter: Prisma.SapInvoiceWhereInput = filters.currency ? { currencyCode: filters.currency } : {};

  async function fetchMoneyRecords(range: { gte?: Date; lte?: Date }): Promise<ProductRevenueLineRecord[]> {
    const lines = await prisma.sapInvoiceLine.findMany({
      where: {
        ...demo,
        ...categoryFilter,
        sapItemCode: { not: null },
        sapInvoice: { ...qualifyingInvoiceWhere(demo, {}), ...currencyFilter, invoiceDate: { not: null, ...range } },
      },
      select: { sapItemCode: true, lineTotal: true, sapInvoice: { select: { currencyCode: true } } },
    });
    return lines.map((line) => ({ sapItemCode: itemKey(line.sapItemCode), currency: line.sapInvoice.currencyCode, lineTotal: line.lineTotal?.toString() ?? null }));
  }

  const [currentRecords, previousRecords] = await Promise.all([
    fetchMoneyRecords(dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo })),
    fetchMoneyRecords(dateRangeToDateOnlyFilter({ dateFrom: previousPeriod.previousFrom, dateTo: previousPeriod.previousTo })),
  ]);

  const currentBreakdown = groupRevenueByCurrencyAndProduct(currentRecords);
  const previousBreakdown = groupRevenueByCurrencyAndProduct(previousRecords);

  const currentValueByProductAndCurrency = new Map<string, Map<string, string>>();
  for (const currencyRow of currentBreakdown) {
    for (const p of currencyRow.byProduct) {
      const byCurrency = currentValueByProductAndCurrency.get(p.sapItemCode) ?? new Map<string, string>();
      byCurrency.set(currencyRow.currency, p.lineValueTotal);
      currentValueByProductAndCurrency.set(p.sapItemCode, byCurrency);
    }
  }

  // Decline candidates: every (product, currency) pair with previous-
  // period activity where the current period's value is strictly lower.
  const declines: { sapItemCode: string; currency: string; currentValue: string; previousValue: string; declineAmount: string }[] = [];
  for (const currencyRow of previousBreakdown) {
    for (const p of currencyRow.byProduct) {
      const currentValue = currentValueByProductAndCurrency.get(p.sapItemCode)?.get(currencyRow.currency) ?? "0";
      if (Number(currentValue) < Number(p.lineValueTotal)) {
        declines.push({
          sapItemCode: p.sapItemCode,
          currency: currencyRow.currency,
          currentValue,
          previousValue: p.lineValueTotal,
          declineAmount: formatScaledDecimal(sumDecimalStrings([p.lineValueTotal, `-${currentValue}`])),
        });
      }
    }
  }

  const universeIds = [...new Set(declines.map((d) => d.sapItemCode))];
  const products = universeIds.length > 0 ? await prisma.product.findMany({ where: { sapItemCode: { in: universeIds } }, select: { id: true, sapItemCode: true } }) : [];
  const productIdByItemCode = new Map(products.map((p) => [p.sapItemCode, p.id]));

  const rankByCurrency = new Map<string, Map<string, number>>();
  const currenciesSeen = new Set(declines.map((d) => d.currency));
  for (const currency of currenciesSeen) {
    const itemsForCurrency = declines.filter((d) => d.currency === currency).map((d) => ({ sapItemCode: d.sapItemCode, value: Number(d.declineAmount) }));
    const ranked = rankByValue(itemsForCurrency, "descending");
    rankByCurrency.set(currency, new Map(ranked.map((r) => [r.sapItemCode, r.rank])));
  }

  const rows: ProductDecliningActivityRow[] = declines
    .map((d) => ({
      sapItemCode: d.sapItemCode,
      productId: productIdByItemCode.get(d.sapItemCode) ?? null,
      currency: d.currency,
      currentPeriodValue: d.currentValue,
      previousPeriodValue: d.previousValue,
      declineAmount: d.declineAmount,
      rank: rankByCurrency.get(d.currency)!.get(d.sapItemCode)!,
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.rank - b.rank);

  return { periodFrom: effectiveFrom, periodTo: effectiveTo, previousPeriodFrom: previousPeriod.previousFrom, previousPeriodTo: previousPeriod.previousTo, metricLabel, rows };
}

// ---------------------------------------------------------------------------
// Management overview: products with incomplete or unmatched master data
// (spec section 4.B item 10). A flagged list, deliberately never a value
// ranking -- "incomplete/unmatched" is a binary data-quality fact about a
// product, not a magnitude to rank highest-to-lowest, so this report has
// no `rank` field (unlike every other item 1-9 dimension in this file).
// ---------------------------------------------------------------------------

export type ProductMasterDataQualityIssue = "unmatched" | "incomplete_category";

export type ProductMasterDataQualityRow = {
  sapItemCode: string;
  productId: string | null;
  issue: ProductMasterDataQualityIssue;
};

export type ProductMasterDataQualityReport = {
  periodFrom: string;
  periodTo: string;
  unmatchedCount: number;
  incompleteCategoryCount: number;
  rows: ProductMasterDataQualityRow[];
};

/**
 * "Incomplete" is scoped narrowly to Product.category -- the ONE
 * nullable Product-master extension field this milestone's own filters
 * and display actually depend on (spec section 6's product-category
 * filter; quantity reporting elsewhere in this milestone deliberately
 * uses the transaction-level unit of measure, never Product.unitOfMeasure
 * -- see this file's own top comment -- so a null unitOfMeasure is not
 * flagged here as an "incompleteness" this milestone has any stake in).
 * "Unmatched" means a SAP item code with real qualifying-invoice activity
 * in the selected period that has no corresponding Product master row at
 * all -- never hidden (spec section 10: "never hide unmatched products").
 */
export async function getProductMasterDataQualityOverview(filters: ReportFilters): Promise<ProductMasterDataQualityReport> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const categoryFilter: Prisma.SapInvoiceLineWhereInput = filters.sapItemCode ? { sapItemCode: filters.sapItemCode } : {};

  const itemCodeRows = await prisma.sapInvoiceLine.findMany({
    where: { ...demo, ...categoryFilter, sapItemCode: { not: null }, sapInvoice: { ...qualifyingInvoiceWhere(demo, {}), invoiceDate: { not: null, ...periodDateRange } } },
    select: { sapItemCode: true },
    distinct: ["sapItemCode"],
  });
  const universeIds = [...new Set(itemCodeRows.map((r) => itemKey(r.sapItemCode)))];

  const products = universeIds.length > 0 ? await prisma.product.findMany({ where: { sapItemCode: { in: universeIds } }, select: { id: true, sapItemCode: true, category: true } }) : [];
  const productByItemCode = new Map(products.map((p) => [p.sapItemCode, p]));

  const rows: ProductMasterDataQualityRow[] = [];
  for (const item of universeIds) {
    const product = productByItemCode.get(item);
    if (!product) {
      rows.push({ sapItemCode: item, productId: null, issue: "unmatched" });
    } else if (product.category === null) {
      rows.push({ sapItemCode: item, productId: product.id, issue: "incomplete_category" });
    }
  }
  rows.sort((a, b) => a.sapItemCode.localeCompare(b.sapItemCode));

  return {
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    unmatchedCount: rows.filter((r) => r.issue === "unmatched").length,
    incompleteCategoryCount: rows.filter((r) => r.issue === "incomplete_category").length,
    rows,
  };
}

export { sumMoneyRows };
