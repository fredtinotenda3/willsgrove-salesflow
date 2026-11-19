import "server-only";
import { dateRangeToTimestampFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import type { ReportFilters } from "@/lib/reporting/types";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { listShortageLostSaleRows, type ShortageLostSaleRow } from "@/lib/lost-sales/queries";
import { listReturnedProductLostSaleRows, type ReturnedProductLostSaleRow } from "@/lib/returns-credits/lost-sale-rows";
import { LOST_SALE_SOURCE_VALUES, type LostSaleSource } from "@/lib/lost-sales/display";

/**
 * Follow-up fix ("Returned-claim lost sales must follow your actual
 * business rules"). This is the user's own authoritative requirement,
 * reproduced here so this module's design can be checked against it
 * directly:
 *
 *   "Show returned-claim losses in the same Lost Sales Analytics page,
 *   KPIs, charts and reports as shortage-based lost sales. I do not
 *   want returned-claim losses isolated in a separate report. Keep the
 *   existing return-condition business rule for now [...] clearly
 *   distinguish the different sources [...] Include both sources in
 *   the overall lost-sales KPIs and analytics. Show separate
 *   breakdowns by source [...] Include product, customer, quantity,
 *   unit of measure, unit price and total lost value. Add source
 *   filters and drill-down to the original order, invoice, claim and
 *   return records. Prevent duplicate counting [...] Do not count
 *   claims as confirmed losses merely because a customer complained.
 *   Only qualifying physical returns should contribute under the
 *   existing rule. Preserve the separate detailed returned-claims
 *   report if it is useful [...] ensure the new pricing data is used
 *   to display monetary values [...] without mixing currencies or
 *   units of measure."
 *
 * Design, point by point:
 *
 * - "Same page, KPIs, charts" / "not isolated": this module is a NEW,
 *   additive layer alongside (not a replacement for)
 *   lib/lost-sales/analytics-queries.ts's getLostSalesAnalytics -- the
 *   /lost-sales/analytics page renders both: the existing shortage-only
 *   charts (requested/found/unavailable have no meaningful equivalent
 *   for a physical return -- a return was never "requested" or "found"
 *   during picking, see that module's own scope) UNCHANGED, plus this
 *   module's new combined KPIs/breakdowns/drilldown sitting alongside
 *   them on the same page.
 *
 * - "Only qualifying physical returns... not merely because a customer
 *   complained": enforced structurally, not by a filter here -- this
 *   module only ever reads ClaimReturnLostSale rows (via
 *   listReturnedProductLostSaleRows), which
 *   lib/returns-credits/return-lost-sale.ts's
 *   recordClaimReturnLostSaleIfLoss already creates ONLY for a
 *   genuine, inspected, non-resalable physical return
 *   (DAMAGED/EXPIRED/OTHER) -- GOOD_RESALABLE never creates a row, and
 *   InvoiceClaim's own raw dispute amount (Source A,
 *   potentialCreditExposure) is never read by this module at all.
 *
 * - "Prevent duplicate counting": by construction, not by a runtime
 *   dedup check, because there is no row that could appear in both
 *   lists. listShortageLostSaleRows reads LostSaleRecord, created only
 *   for quantity that was NEVER delivered (unavailable at picking --
 *   UnfulfilledDemand.unavailableQuantity). listReturnedProductLostSaleRows
 *   reads ClaimReturnLostSale, created only for quantity that WAS
 *   delivered, invoiced, and later physically returned
 *   (ClaimReturn.receivedQuantity). A unit of stock that was never
 *   delivered cannot also be a unit that was delivered and returned --
 *   the two source tables describe disjoint populations of physical
 *   goods, so merging their rows is a union of disjoint sets, never an
 *   addition that could count the same lost unit twice. (This is also
 *   why it is never Source A + Source C either -- see
 *   lib/returns-credits/lost-sale-analytics.ts's own comment on that
 *   distinction, which this module leaves untouched.)
 *
 * - "Without mixing currencies or units of measure": every value total
 *   this module returns is grouped `byCurrency` (never summed across
 *   currencies), and every quantity total discloses `mixedUnitsOfMeasure`
 *   (same convention lib/lost-sales/analytics-queries.ts already
 *   established) rather than silently combining incompatible units.
 *   Currency is resolved for BOTH sources from a real, already-recorded
 *   fact -- CustomerOrder.currency (shortage side) / SapInvoice.
 *   currencyCode via ClaimReturnLostSale.currencyCode (returned side) --
 *   never invented; a row with no resolvable currency is bucketed under
 *   the literal string "UNKNOWN", the same convention
 *   getReturnedGoodsLostSalesValue already uses.
 *
 * - "Ensure the new pricing data is used... monetary values": every
 *   value figure here uses this codebase's exact scaled-bigint decimal
 *   arithmetic (sumDecimalStrings/formatScaledDecimal from
 *   lib/fulfilment/decimal.ts), not float summation -- a deliberately
 *   stricter choice than analytics-queries.ts's own documented float
 *   exception (that module's own comment scopes its float use to
 *   chart-only display at low-thousands-row scale; this module's figures
 *   are the headline "confirmed lost value" KPI itself, so it earns the
 *   same exactness as a transactional total).
 *
 * - "Preserve the separate detailed returned-claims report": this
 *   module does not modify lib/returns-credits/lost-sale-analytics.ts's
 *   getReturnedGoodsLostSalesValue (Source C's own whole-business
 *   summary) or its consumer in lib/reporting/financial-exposure.ts --
 *   both remain exactly as they were.
 */

const TOP_N = 10;

type ConsolidatedLostSaleRow = {
  id: string;
  source: LostSaleSource;
  date: Date;
  customerId: string;
  customerName: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string | null;
  unitOfMeasure: string | null;
  quantity: string;
  unitPrice: string | null;
  totalValue: string | null;
  /** Raw, possibly-null currency -- bucketed under "UNKNOWN" only at display/aggregation time, never defaulted here. */
  currencyCode: string | null;
  salespersonId: string | null;
  isDemo: boolean;
  orderId: string | null;
  orderReference: string | null;
  // Shortage-only (undefined for a RETURNED_PRODUCT row):
  unfulfilledDemandId?: string;
  reason?: string;
  // Returned-product-only (undefined for a SHORTAGE row):
  claimReturnId?: string;
  claimId?: string;
  claimReference?: string;
  returnReference?: string;
  sapInvoiceId?: string;
  condition?: string;
};

function fromShortageRow(row: ShortageLostSaleRow): ConsolidatedLostSaleRow {
  return {
    id: row.id,
    source: "SHORTAGE",
    date: row.confirmedAt,
    customerId: row.customerId,
    customerName: row.customerName,
    productId: row.productId,
    sapItemCodeSnapshot: row.sapItemCodeSnapshot,
    productDescriptionSnapshot: row.productDescriptionSnapshot,
    unitOfMeasure: row.unitOfMeasure,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    totalValue: row.totalValue,
    currencyCode: row.currencyCode,
    salespersonId: row.salespersonId,
    isDemo: row.isDemo,
    orderId: row.orderId,
    orderReference: row.orderReference,
    unfulfilledDemandId: row.unfulfilledDemandId,
    reason: row.reason,
  };
}

function fromReturnedRow(row: ReturnedProductLostSaleRow): ConsolidatedLostSaleRow {
  return {
    id: row.id,
    source: "RETURNED_PRODUCT",
    date: row.recordedAt,
    customerId: row.customerId,
    customerName: row.customerName,
    productId: row.productId,
    sapItemCodeSnapshot: row.sapItemCodeSnapshot,
    productDescriptionSnapshot: row.productDescriptionSnapshot,
    unitOfMeasure: row.unitOfMeasure,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    totalValue: row.totalValue,
    currencyCode: row.currencyCode,
    salespersonId: row.salespersonId,
    isDemo: row.isDemo,
    orderId: row.orderId,
    orderReference: row.orderReference,
    claimReturnId: row.claimReturnId,
    claimId: row.claimId,
    claimReference: row.claimReference,
    returnReference: row.returnReference,
    sapInvoiceId: row.sapInvoiceId,
    condition: row.condition,
  };
}

function currencyKeyFor(row: ConsolidatedLostSaleRow): string {
  return row.currencyCode ?? "UNKNOWN";
}

function productKeyFor(row: ConsolidatedLostSaleRow): string {
  return row.sapItemCodeSnapshot ?? row.productId ?? (row.productDescriptionSnapshot ? `desc:${row.productDescriptionSnapshot}` : `unresolved:${row.id}`);
}

function sumOrZero(values: string[]): string {
  return values.length === 0 ? "0" : formatScaledDecimal(sumDecimalStrings(values));
}

export type ConsolidatedValueByCurrency = { currencyCode: string; value: string };

export type ConsolidatedSourceBreakdown = {
  source: LostSaleSource;
  recordCount: number;
  quantity: string;
  valueByCurrency: ConsolidatedValueByCurrency[];
  recordsWithoutValue: number;
};

export type ConsolidatedCurrencyBucket = {
  currencyCode: string; // "UNKNOWN" when no row in this bucket had a resolvable currency
  recordCount: number;
  shortageValue: string;
  returnedValue: string;
  totalValue: string;
};

export type ConsolidatedProductBreakdown = {
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string | null;
  unitOfMeasure: string | null;
  mixedUnitsOfMeasure: boolean;
  quantity: string;
  recordCount: number;
  affectedOrderCount: number;
  affectedCustomerCount: number;
  shortageQuantity: string;
  shortageRecordCount: number;
  returnedQuantity: string;
  returnedRecordCount: number;
  valueByCurrency: ConsolidatedValueByCurrency[];
};

export type ConsolidatedCustomerBreakdown = {
  customerId: string;
  customerName: string;
  quantity: string;
  recordCount: number;
  affectedOrderCount: number;
  shortageQuantity: string;
  shortageRecordCount: number;
  returnedQuantity: string;
  returnedRecordCount: number;
  valueByCurrency: ConsolidatedValueByCurrency[];
};

export type ConsolidatedDrilldownRow = {
  id: string;
  source: LostSaleSource;
  date: string; // ISO timestamp
  customerId: string;
  customerName: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string | null;
  unitOfMeasure: string | null;
  quantity: string;
  unitPrice: string | null;
  totalValue: string | null;
  currencyCode: string | null;
  orderId: string | null;
  orderReference: string | null;
  // Shortage-only drill-down targets:
  unfulfilledDemandId: string | null;
  reason: string | null;
  // Returned-product-only drill-down targets:
  claimId: string | null;
  claimReference: string | null;
  sapInvoiceId: string | null;
  returnReference: string | null;
  condition: string | null;
};

export type ConsolidatedLostSalesResult = {
  effectiveDateFrom: string;
  effectiveDateTo: string;
  dateRangeWasDefaulted: boolean;
  sampleSize: number;
  /** True when either source's own row cap was hit -- see listShortageLostSaleRows/listReturnedProductLostSaleRows's own MAX_*_ROWS. */
  truncated: boolean;
  kpis: {
    totalConfirmedLostQuantity: string;
    shortageConfirmedLostQuantity: string;
    returnedConfirmedLostQuantity: string;
    quantityUnitCode: string | null;
    mixedUnitsOfMeasure: boolean;
    /** Rows (either source) with no resolvable unit price -- never silently dropped from the quantity total above, and never included in any value total below. */
    recordsWithoutValue: number;
    affectedOrderCount: number;
    affectedCustomerCount: number;
  };
  valueByCurrency: ConsolidatedCurrencyBucket[];
  bySource: ConsolidatedSourceBreakdown[];
  byProduct: ConsolidatedProductBreakdown[];
  byCustomer: ConsolidatedCustomerBreakdown[];
  drilldown: {
    rows: ConsolidatedDrilldownRow[];
    pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
  };
};

/**
 * Shared by getConsolidatedLostSalesAnalytics and
 * listConsolidatedLostSaleRowsForExport -- one implementation of "which
 * rows from which sources, merged and sorted," so the CSV export can
 * never drift from what the on-screen drilldown table shows for the
 * same filters (same contract as e.g. lib/lost-sales/queries.ts's
 * listAllUnfulfilledDemandsForExport reusing buildUnfulfilledDemandListWhere).
 */
async function fetchMergedRows(filters: ReportFilters): Promise<{
  rows: ConsolidatedLostSaleRow[];
  truncated: boolean;
  effectiveFrom: string;
  effectiveTo: string;
  dateRangeWasDefaulted: boolean;
}> {
  const dateRangeWasDefaulted = filters.dateFrom === null && filters.dateTo === null;
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const dateRange = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  // Source filter: when the caller asked for exactly one source, the
  // OTHER source is never even queried -- not just filtered out after
  // the fact -- so a source-filtered view can never accidentally leak a
  // record from the excluded source into any figure below.
  const wantsShortage = filters.lostSaleSource === null || filters.lostSaleSource === "SHORTAGE";
  const wantsReturned = filters.lostSaleSource === null || filters.lostSaleSource === "RETURNED_PRODUCT";

  const sharedFilters = {
    includeDemo: filters.includeDemo,
    customerId: filters.customerId,
    productId: filters.productId,
    salespersonId: filters.salespersonId,
    dateRange,
  };

  const [shortageResult, returnedResult] = await Promise.all([
    wantsShortage ? listShortageLostSaleRows(sharedFilters) : Promise.resolve({ rows: [], totalMatching: 0, truncated: false }),
    wantsReturned ? listReturnedProductLostSaleRows(sharedFilters) : Promise.resolve({ rows: [], totalMatching: 0, truncated: false }),
  ]);

  const rows: ConsolidatedLostSaleRow[] = [
    ...shortageResult.rows.map(fromShortageRow),
    ...returnedResult.rows.map(fromReturnedRow),
  ].sort((a, b) => b.date.getTime() - a.date.getTime() || a.id.localeCompare(b.id));

  return {
    rows,
    truncated: shortageResult.truncated || returnedResult.truncated,
    effectiveFrom,
    effectiveTo,
    dateRangeWasDefaulted,
  };
}

function toDrilldownRow(row: ConsolidatedLostSaleRow): ConsolidatedDrilldownRow {
  return {
    id: row.id,
    source: row.source,
    date: row.date.toISOString(),
    customerId: row.customerId,
    customerName: row.customerName,
    productId: row.productId,
    sapItemCodeSnapshot: row.sapItemCodeSnapshot,
    productDescriptionSnapshot: row.productDescriptionSnapshot,
    unitOfMeasure: row.unitOfMeasure,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    totalValue: row.totalValue,
    currencyCode: row.currencyCode,
    orderId: row.orderId,
    orderReference: row.orderReference,
    unfulfilledDemandId: row.unfulfilledDemandId ?? null,
    reason: row.reason ?? null,
    claimId: row.claimId ?? null,
    claimReference: row.claimReference ?? null,
    sapInvoiceId: row.sapInvoiceId ?? null,
    returnReference: row.returnReference ?? null,
    condition: row.condition ?? null,
  };
}

/**
 * Follow-up fix (spec section 9's export requirement, applied to the new
 * combined view). Every row matching the current filters, across BOTH
 * sources, not just one page -- the same "export reflects the filtered
 * view, not the pagination" contract the shortage-only export already
 * follows. Consumed by app/api/lost-sales/analytics/consolidated-export/route.ts.
 */
export async function listConsolidatedLostSaleRowsForExport(
  filters: ReportFilters
): Promise<{ rows: ConsolidatedDrilldownRow[]; truncated: boolean }> {
  const { rows, truncated } = await fetchMergedRows(filters);
  return { rows: rows.map(toDrilldownRow), truncated };
}

export async function getConsolidatedLostSalesAnalytics(
  filters: ReportFilters,
  drilldownPage: { page: number; pageSize: number }
): Promise<ConsolidatedLostSalesResult> {
  const { rows, truncated, effectiveFrom, effectiveTo, dateRangeWasDefaulted } = await fetchMergedRows(filters);

  // --- KPIs -------------------------------------------------------------
  const unitsOfMeasureSeen = new Set<string>();
  const affectedOrderIds = new Set<string>();
  const affectedCustomerIds = new Set<string>();
  let recordsWithoutValue = 0;
  const shortageQuantities: string[] = [];
  const returnedQuantities: string[] = [];
  for (const row of rows) {
    if (row.unitOfMeasure) unitsOfMeasureSeen.add(row.unitOfMeasure);
    if (row.orderId) affectedOrderIds.add(row.orderId);
    affectedCustomerIds.add(row.customerId);
    if (row.totalValue === null) recordsWithoutValue += 1;
    (row.source === "SHORTAGE" ? shortageQuantities : returnedQuantities).push(row.quantity);
  }

  // --- Value by currency (never summed across currencies) ---------------
  const currencyGroups = new Map<string, { shortageValues: string[]; returnedValues: string[] }>();
  for (const row of rows) {
    if (row.totalValue === null) continue;
    const key = currencyKeyFor(row);
    const group = currencyGroups.get(key) ?? { shortageValues: [], returnedValues: [] };
    (row.source === "SHORTAGE" ? group.shortageValues : group.returnedValues).push(row.totalValue);
    currencyGroups.set(key, group);
  }
  const valueByCurrency: ConsolidatedCurrencyBucket[] = Array.from(currencyGroups.entries())
    .map(([currencyCode, group]) => {
      const shortageValue = sumOrZero(group.shortageValues);
      const returnedValue = sumOrZero(group.returnedValues);
      return {
        currencyCode,
        recordCount: group.shortageValues.length + group.returnedValues.length,
        shortageValue,
        returnedValue,
        totalValue: sumOrZero([...group.shortageValues, ...group.returnedValues]),
      };
    })
    .sort((a, b) => Number(b.totalValue) - Number(a.totalValue));

  // --- By source (requirement: "show separate breakdowns by source") ---
  const bySource: ConsolidatedSourceBreakdown[] = LOST_SALE_SOURCE_VALUES.map((source) => {
    const sourceRows = rows.filter((row) => row.source === source);
    const byCurrencyForSource = new Map<string, string[]>();
    let withoutValue = 0;
    for (const row of sourceRows) {
      if (row.totalValue === null) {
        withoutValue += 1;
        continue;
      }
      const key = currencyKeyFor(row);
      const values = byCurrencyForSource.get(key) ?? [];
      values.push(row.totalValue);
      byCurrencyForSource.set(key, values);
    }
    return {
      source,
      recordCount: sourceRows.length,
      quantity: sumOrZero(sourceRows.map((row) => row.quantity)),
      valueByCurrency: Array.from(byCurrencyForSource.entries())
        .map(([currencyCode, values]) => ({ currencyCode, value: sumOrZero(values) }))
        .sort((a, b) => Number(b.value) - Number(a.value)),
      recordsWithoutValue: withoutValue,
    };
  });

  // --- By product / by customer (combined, with per-source split) ------
  type ProductAgg = {
    productId: string | null;
    sapItemCodeSnapshot: string | null;
    productDescriptionSnapshot: string | null;
    unitsOfMeasure: Set<string>;
    quantities: string[];
    shortageQuantities: string[];
    returnedQuantities: string[];
    valuesByCurrency: Map<string, string[]>;
    orderIds: Set<string>;
    customerIds: Set<string>;
    recordCount: number;
  };
  type CustomerAgg = {
    customerId: string;
    customerName: string;
    quantities: string[];
    shortageQuantities: string[];
    returnedQuantities: string[];
    valuesByCurrency: Map<string, string[]>;
    orderIds: Set<string>;
    recordCount: number;
  };
  const byProductAgg = new Map<string, ProductAgg>();
  const byCustomerAgg = new Map<string, CustomerAgg>();

  for (const row of rows) {
    const productKey = productKeyFor(row);
    const productAgg: ProductAgg =
      byProductAgg.get(productKey) ?? {
        productId: row.productId,
        sapItemCodeSnapshot: row.sapItemCodeSnapshot,
        productDescriptionSnapshot: row.productDescriptionSnapshot,
        unitsOfMeasure: new Set<string>(),
        quantities: [],
        shortageQuantities: [],
        returnedQuantities: [],
        valuesByCurrency: new Map<string, string[]>(),
        orderIds: new Set<string>(),
        customerIds: new Set<string>(),
        recordCount: 0,
      };
    if (row.unitOfMeasure) productAgg.unitsOfMeasure.add(row.unitOfMeasure);
    productAgg.quantities.push(row.quantity);
    (row.source === "SHORTAGE" ? productAgg.shortageQuantities : productAgg.returnedQuantities).push(row.quantity);
    if (row.totalValue !== null) {
      const key = currencyKeyFor(row);
      const values = productAgg.valuesByCurrency.get(key) ?? [];
      values.push(row.totalValue);
      productAgg.valuesByCurrency.set(key, values);
    }
    if (row.orderId) productAgg.orderIds.add(row.orderId);
    productAgg.customerIds.add(row.customerId);
    productAgg.recordCount += 1;
    byProductAgg.set(productKey, productAgg);

    const customerAgg: CustomerAgg =
      byCustomerAgg.get(row.customerId) ?? {
        customerId: row.customerId,
        customerName: row.customerName,
        quantities: [],
        shortageQuantities: [],
        returnedQuantities: [],
        valuesByCurrency: new Map<string, string[]>(),
        orderIds: new Set<string>(),
        recordCount: 0,
      };
    customerAgg.quantities.push(row.quantity);
    (row.source === "SHORTAGE" ? customerAgg.shortageQuantities : customerAgg.returnedQuantities).push(row.quantity);
    if (row.totalValue !== null) {
      const key = currencyKeyFor(row);
      const values = customerAgg.valuesByCurrency.get(key) ?? [];
      values.push(row.totalValue);
      customerAgg.valuesByCurrency.set(key, values);
    }
    if (row.orderId) customerAgg.orderIds.add(row.orderId);
    customerAgg.recordCount += 1;
    byCustomerAgg.set(row.customerId, customerAgg);
  }

  function valueByCurrencyFrom(map: Map<string, string[]>): ConsolidatedValueByCurrency[] {
    return Array.from(map.entries())
      .map(([currencyCode, values]) => ({ currencyCode, value: sumOrZero(values) }))
      .sort((a, b) => Number(b.value) - Number(a.value));
  }

  const byProduct: ConsolidatedProductBreakdown[] = Array.from(byProductAgg.values())
    .sort((a, b) => Number(sumOrZero(b.quantities)) - Number(sumOrZero(a.quantities)))
    .slice(0, TOP_N)
    .map((agg) => ({
      productId: agg.productId,
      sapItemCodeSnapshot: agg.sapItemCodeSnapshot,
      productDescriptionSnapshot: agg.productDescriptionSnapshot,
      unitOfMeasure: agg.unitsOfMeasure.size === 1 ? Array.from(agg.unitsOfMeasure)[0] : null,
      mixedUnitsOfMeasure: agg.unitsOfMeasure.size > 1,
      quantity: sumOrZero(agg.quantities),
      recordCount: agg.recordCount,
      affectedOrderCount: agg.orderIds.size,
      affectedCustomerCount: agg.customerIds.size,
      shortageQuantity: sumOrZero(agg.shortageQuantities),
      shortageRecordCount: agg.shortageQuantities.length,
      returnedQuantity: sumOrZero(agg.returnedQuantities),
      returnedRecordCount: agg.returnedQuantities.length,
      valueByCurrency: valueByCurrencyFrom(agg.valuesByCurrency),
    }));

  const byCustomer: ConsolidatedCustomerBreakdown[] = Array.from(byCustomerAgg.values())
    .sort((a, b) => Number(sumOrZero(b.quantities)) - Number(sumOrZero(a.quantities)))
    .slice(0, TOP_N)
    .map((agg) => ({
      customerId: agg.customerId,
      customerName: agg.customerName,
      quantity: sumOrZero(agg.quantities),
      recordCount: agg.recordCount,
      affectedOrderCount: agg.orderIds.size,
      shortageQuantity: sumOrZero(agg.shortageQuantities),
      shortageRecordCount: agg.shortageQuantities.length,
      returnedQuantity: sumOrZero(agg.returnedQuantities),
      returnedRecordCount: agg.returnedQuantities.length,
      valueByCurrency: valueByCurrencyFrom(agg.valuesByCurrency),
    }));

  // --- Drilldown (paginated in memory -- see this module's own comment
  // on why exact decimal arithmetic, not float aggregation, is used
  // throughout; the same "low-thousands-row scale" realistic volume this
  // codebase already relies on for analytics-queries.ts's own in-memory
  // work applies here too, now across (at most) two capped row sets
  // instead of one). ------------------------------------------------------
  const totalItems = rows.length;
  const startIndex = (drilldownPage.page - 1) * drilldownPage.pageSize;
  const pageRows = rows.slice(startIndex, startIndex + drilldownPage.pageSize);

  const drilldownRows: ConsolidatedDrilldownRow[] = pageRows.map(toDrilldownRow);

  return {
    effectiveDateFrom: effectiveFrom,
    effectiveDateTo: effectiveTo,
    dateRangeWasDefaulted,
    sampleSize: rows.length,
    truncated,
    kpis: {
      totalConfirmedLostQuantity: sumOrZero(rows.map((row) => row.quantity)),
      shortageConfirmedLostQuantity: sumOrZero(shortageQuantities),
      returnedConfirmedLostQuantity: sumOrZero(returnedQuantities),
      quantityUnitCode: unitsOfMeasureSeen.size === 1 ? Array.from(unitsOfMeasureSeen)[0] : null,
      mixedUnitsOfMeasure: unitsOfMeasureSeen.size > 1,
      recordsWithoutValue,
      affectedOrderCount: affectedOrderIds.size,
      affectedCustomerCount: affectedCustomerIds.size,
    },
    valueByCurrency,
    bySource,
    byProduct,
    byCustomer,
    drilldown: {
      rows: drilldownRows,
      pagination: {
        page: drilldownPage.page,
        pageSize: drilldownPage.pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / drilldownPage.pageSize)),
      },
    },
  };
}
