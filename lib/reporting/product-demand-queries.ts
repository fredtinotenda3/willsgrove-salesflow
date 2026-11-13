import "server-only";
import type { LostSaleReason, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter, dateRangeToDateOnlyFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { qualifyingInvoiceWhere } from "@/lib/reporting/customer-activity-queries";
import { itemKey, aggregateCustomerDemandForProduct, type ProductCustomerDemandLineRecord, type ProductCustomerDemandRow } from "@/lib/reporting/product-purchasing";
import { sumMoneyRows } from "@/lib/reporting/sales-revenue";
import { rankByValue } from "@/lib/reporting/product-segmentation";

/**
 * Milestone 14 (Product Intelligence). Customer-demand, requested-demand
 * and lost-sales queries for one product (Product 360, spec section 4.3)
 * and the management overview's lost-sales ranking (spec section 4.B
 * item 5).
 *
 * Spec section 5.6 ("keep separate: requested quantity, ordered quantity,
 * invoiced quantity, recorded unfulfilled quantity, confirmed lost-sales
 * quantity. Never assume every unfulfilled order became a lost sale.
 * Never count the same underlying demand event twice") governs every
 * function in this file. The three demand signals this file reports --
 * (a) actually invoiced (via qualifying SapInvoiceLine), (b) requested
 * via quotation/order (via QuotationLine/OrderLine), and (c) recorded
 * unfulfilled / confirmed lost (via UnfulfilledDemand/LostSaleRecord) --
 * are reported as three SEPARATE figures, never summed into one "total
 * demand" number and never used to compute a derived "conversion rate":
 * this schema has no reliable quotation -> order -> invoice linkage
 * chain (Quotation and CustomerOrder are not directly linked by a
 * foreign key anywhere in this schema), so "requested but not converted"
 * cannot be reliably computed and is NOT attempted here -- the reader is
 * shown both figures side by side and left to draw their own comparison,
 * per spec section 15's instruction to implement the closest defensible
 * alternative and document the limitation rather than invent an
 * unsupported one.
 *
 * Product identity for QuotationLine/OrderLine/UnfulfilledDemand uses
 * the line's own FROZEN sapItemCodeSnapshot as the primary match (spec
 * section 3: "preserve historical invoice-line product codes even if
 * current product master changes"), OR'd with productId when a live
 * Product row is known for this item code -- catching the rare case
 * where a snapshot and the current master's own code have since
 * diverged, without ever trusting productId alone (a FK can point at a
 * row whose own sapItemCode has since changed).
 *
 * Only exercised via RUN_DB_INTEGRATION_TESTS=1, same reason as every
 * other *-queries.ts file in this project.
 */

/**
 * Builds the shared `{ OR: [{ sapItemCodeSnapshot }, { productId }?] }`
 * product-match clause used by QuotationLine/OrderLine/UnfulfilledDemand
 * -- all three models carry the exact same two fields for this purpose.
 * Returned as a plain object and cast to the specific WhereInput type at
 * each call site, since Prisma generates a structurally-identical (but
 * nominally distinct) WhereInput type per model for what is otherwise
 * the same shape.
 */
function productMatchWhere(sapItemCode: string, productId: string | null): { OR: ({ sapItemCodeSnapshot: string } | { productId: string })[] } {
  const clauses: ({ sapItemCodeSnapshot: string } | { productId: string })[] = [{ sapItemCodeSnapshot: sapItemCode }];
  if (productId) clauses.push({ productId });
  return { OR: clauses };
}

// ---------------------------------------------------------------------------
// (a) Customers who actually purchased this product (invoiced demand).
// ---------------------------------------------------------------------------

export type ProductCustomerDemandSummary = {
  periodFrom: string;
  periodTo: string;
  customers: (ProductCustomerDemandRow & { customerName: string })[];
};

export async function getProductCustomerDemand(sapItemCode: string, filters: ReportFilters): Promise<ProductCustomerDemandSummary> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  const lines = await prisma.sapInvoiceLine.findMany({
    where: {
      sapItemCode,
      ...demo,
      sapInvoice: { ...qualifyingInvoiceWhere(demo, {}), invoiceDate: { not: null, ...periodDateRange } },
    },
    select: { sapInvoice: { select: { id: true, invoiceDate: true, matchedCustomerId: true } } },
  });

  const records: ProductCustomerDemandLineRecord[] = lines
    .filter((l) => l.sapInvoice.matchedCustomerId !== null)
    .map((l) => ({
      customerId: l.sapInvoice.matchedCustomerId!,
      invoiceId: l.sapInvoice.id,
      invoiceDate: l.sapInvoice.invoiceDate!.toISOString().slice(0, 10),
    }));

  const rows = aggregateCustomerDemandForProduct(records);
  const customerIds = rows.map((r) => r.customerId);
  const customers = customerIds.length > 0 ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(customers.map((c) => [c.id, c.name]));

  return {
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    customers: rows.map((r) => ({ ...r, customerName: nameById.get(r.customerId) ?? r.customerId })),
  };
}

// ---------------------------------------------------------------------------
// (b) Requested-but-not-necessarily-invoiced demand: quotations and orders.
// ---------------------------------------------------------------------------

export type ProductRequestedDemand = {
  quotationLineCount: number;
  quotationRequestedQuantityByUnit: { unitOfMeasure: string; quantityTotal: string }[];
  distinctQuotingCustomerCount: number;
  orderLineCount: number;
  orderRequestedQuantityByUnit: { unitOfMeasure: string; quantityTotal: string }[];
  distinctOrderingCustomerCount: number;
};

export async function getProductRequestedDemand(sapItemCode: string, productId: string | null, filters: ReportFilters): Promise<ProductRequestedDemand> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  // Quotation.quotationDate and CustomerOrder.orderDate are both
  // `DateTime @db.Date` columns (date-only, no time component) --
  // dateRangeToDateOnlyFilter (inclusive gte/lte), never
  // dateRangeToTimestampFilter (which is for @db.Timestamptz columns
  // only), is the correct bound for both.
  const dateOnlyRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  const quotationLines = await prisma.quotationLine.findMany({
    where: {
      ...(productMatchWhere(sapItemCode, productId) as Prisma.QuotationLineWhereInput),
      quotation: { ...demo, supersededAt: null, quotationDate: dateOnlyRange },
    },
    select: { quantity: true, unitOfMeasure: true, quotation: { select: { customerId: true } } },
  });

  const orderLines = await prisma.orderLine.findMany({
    where: {
      ...(productMatchWhere(sapItemCode, productId) as Prisma.OrderLineWhereInput),
      order: { ...demo, orderDate: dateOnlyRange },
    },
    select: { requestedQuantity: true, requestedUnitCode: true, order: { select: { customerId: true } } },
  });

  function groupByUnit(rows: { quantity: Prisma.Decimal | null; unit: string | null }[]) {
    const byUnit = new Map<string, string[]>();
    for (const row of rows) {
      if (row.quantity === null) continue;
      const unit = (row.unit ?? "").trim() === "" ? "UNKNOWN_UOM" : row.unit!.trim().toUpperCase();
      const bucket = byUnit.get(unit) ?? [];
      bucket.push(row.quantity.toString());
      byUnit.set(unit, bucket);
    }
    return [...byUnit.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([unitOfMeasure, values]) => ({ unitOfMeasure, quantityTotal: formatScaledDecimal(sumDecimalStrings(values)) }));
  }

  return {
    quotationLineCount: quotationLines.length,
    quotationRequestedQuantityByUnit: groupByUnit(quotationLines.map((l) => ({ quantity: l.quantity, unit: l.unitOfMeasure }))),
    distinctQuotingCustomerCount: new Set(quotationLines.map((l) => l.quotation.customerId)).size,
    orderLineCount: orderLines.length,
    orderRequestedQuantityByUnit: groupByUnit(orderLines.map((l) => ({ quantity: l.requestedQuantity, unit: l.requestedUnitCode }))),
    distinctOrderingCustomerCount: new Set(orderLines.map((l) => l.order.customerId)).size,
  };
}

// ---------------------------------------------------------------------------
// (c) Recorded unfulfilled demand and confirmed lost sales.
// ---------------------------------------------------------------------------

export type ProductLostSalesSummary = {
  /** UnfulfilledDemand rows for this product, in the period -- the raw "a pick couldn't fully satisfy this line" count, never conflated with a confirmed lost sale. */
  unfulfilledDemandRecordCount: number;
  outstandingQuantityTotal: string;
  confirmedLostQuantityTotal: string;
  confirmedLostSaleCount: number;
  confirmedLostSaleQuantityTotal: string;
  byReason: Record<string, { count: number; quantity: string }>;
  /** Estimated, never authoritative SAP data -- same estimation precedent lib/reporting/customer-insights-queries.ts already established, reused unchanged here. */
  estimatedValueByCurrency: { currency: string; totalEstimatedValue: string; excludedCount: number }[];
};

export async function getProductLostSalesSummary(sapItemCode: string, productId: string | null, filters: ReportFilters): Promise<ProductLostSalesSummary> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const timestampRange = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  const unfulfilled = await prisma.unfulfilledDemand.findMany({
    where: { ...(productMatchWhere(sapItemCode, productId) as Prisma.UnfulfilledDemandWhereInput), ...demo },
    select: { id: true, outstandingQuantity: true, confirmedLostQuantity: true },
  });

  const lostSales = await prisma.lostSaleRecord.findMany({
    where: {
      ...demo,
      confirmedAt: timestampRange,
      ...(filters.lostSalesReason ? { reason: filters.lostSalesReason as LostSaleReason } : {}),
      unfulfilledDemand: { ...(productMatchWhere(sapItemCode, productId) as Prisma.UnfulfilledDemandWhereInput), ...demo },
    },
    select: { quantity: true, reason: true, estimatedValue: true, unfulfilledDemand: { select: { orderId: true } } },
  });

  const orderIds = [...new Set(lostSales.map((r) => r.unfulfilledDemand.orderId))];
  const orders = orderIds.length > 0 ? await prisma.customerOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, currency: true } }) : [];
  const currencyByOrderId = new Map(orders.map((o) => [o.id, o.currency]));

  const byReason = new Map<string, { count: number; quantities: string[] }>();
  const valueByCurrency = new Map<string, (string | null)[]>();
  for (const r of lostSales) {
    const acc = byReason.get(r.reason) ?? { count: 0, quantities: [] };
    acc.count += 1;
    acc.quantities.push(r.quantity.toString());
    byReason.set(r.reason, acc);

    const currency = currencyByOrderId.get(r.unfulfilledDemand.orderId) ?? "USD";
    const bucket = valueByCurrency.get(currency) ?? [];
    bucket.push(r.estimatedValue?.toString() ?? null);
    valueByCurrency.set(currency, bucket);
  }

  return {
    unfulfilledDemandRecordCount: unfulfilled.length,
    outstandingQuantityTotal: formatScaledDecimal(sumDecimalStrings(unfulfilled.map((u) => u.outstandingQuantity.toString()))),
    confirmedLostQuantityTotal: formatScaledDecimal(sumDecimalStrings(unfulfilled.map((u) => u.confirmedLostQuantity.toString()))),
    confirmedLostSaleCount: lostSales.length,
    confirmedLostSaleQuantityTotal: lostSales.length > 0 ? formatScaledDecimal(sumDecimalStrings(lostSales.map((r) => r.quantity.toString()))) : "0",
    byReason: Object.fromEntries([...byReason.entries()].map(([reason, acc]) => [reason, { count: acc.count, quantity: formatScaledDecimal(sumDecimalStrings(acc.quantities)) }])),
    estimatedValueByCurrency: [...valueByCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, values]) => {
        const { total, excludedCount } = sumMoneyRows(values);
        return { currency, totalEstimatedValue: total, excludedCount };
      }),
  };
}

// ---------------------------------------------------------------------------
// Management overview: products ranked by recorded lost-sales activity
// (spec section 4.B item 5).
// ---------------------------------------------------------------------------

export type ProductLostSalesRankingRow = {
  sapItemCode: string;
  productId: string | null;
  confirmedLostSaleCount: number;
  confirmedLostSaleQuantityTotal: string;
  rank: number;
};

export async function getProductLostSalesRanking(filters: ReportFilters): Promise<{ periodFrom: string; periodTo: string; rows: ProductLostSalesRankingRow[] }> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const timestampRange = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  const lostSales = await prisma.lostSaleRecord.findMany({
    where: {
      ...demo,
      confirmedAt: timestampRange,
      ...(filters.lostSalesReason ? { reason: filters.lostSalesReason as LostSaleReason } : {}),
      unfulfilledDemand: { ...demo },
    },
    select: { quantity: true, unfulfilledDemand: { select: { sapItemCodeSnapshot: true, productId: true } } },
  });

  const byItem = new Map<string, { productId: string | null; count: number; quantities: string[] }>();
  for (const r of lostSales) {
    const item = itemKey(r.unfulfilledDemand.sapItemCodeSnapshot);
    const acc = byItem.get(item) ?? { productId: r.unfulfilledDemand.productId, count: 0, quantities: [] };
    acc.count += 1;
    acc.quantities.push(r.quantity.toString());
    if (!acc.productId) acc.productId = r.unfulfilledDemand.productId;
    byItem.set(item, acc);
  }

  const ranked = rankByValue([...byItem.entries()].map(([sapItemCode, acc]) => ({ sapItemCode, value: acc.count })), "descending");
  const rankByItem = new Map(ranked.map((r) => [r.sapItemCode, r.rank]));

  const rows: ProductLostSalesRankingRow[] = [...byItem.entries()]
    .map(([sapItemCode, acc]) => ({
      sapItemCode,
      productId: acc.productId,
      confirmedLostSaleCount: acc.count,
      confirmedLostSaleQuantityTotal: formatScaledDecimal(sumDecimalStrings(acc.quantities)),
      rank: rankByItem.get(sapItemCode)!,
    }))
    .sort((a, b) => a.rank - b.rank);

  return { periodFrom: effectiveFrom, periodTo: effectiveTo, rows };
}
