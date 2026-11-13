import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToDateOnlyFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { utcDateToDateOnlyString } from "@/lib/dates";
import { qualifyingInvoiceWhere } from "@/lib/reporting/customer-activity-queries";
import { aggregateProductPurchasing, UNKNOWN_SAP_ITEM_CODE, type ProductLineRecord, type ProductQuantityByUnit, type ProductValueByCurrency } from "@/lib/reporting/customer-purchasing";
import { SAP_INVOICE_LINE_VALUE_LABEL } from "@/lib/reporting/sales-revenue";

/**
 * Milestone 13 (Customer Intelligence). The database-backed half of
 * lib/reporting/customer-purchasing.ts -- fetches one customer's
 * qualifying SapInvoiceLine rows for the SELECTED PERIOD (quantity,
 * value, frequency and last-purchased are all computed from the SAME
 * period-bounded fetch, per the explicit correction: "do not mix
 * all-time quantity figures with period-scoped purchase frequency" --
 * no all-time product view exists in this milestone), then joins
 * Product master data purely for match-status/category display -- never
 * for identity resolution, which is always sapItemCode-based and always
 * keeps the raw SAP line even when no Product row exists.
 *
 * Only exercised via RUN_DB_INTEGRATION_TESTS=1, same reason as every
 * other *-queries.ts file in this project.
 */

export const UNCATEGORIZED_LABEL = "Uncategorized";
export const PRODUCT_CATEGORY_DATA_QUALITY_NOTE =
  "Product categories are free text, sourced as-is from SAP master data (Product.category), and may contain inconsistent values across items. Categories are never normalized, fuzzy-matched, or silently merged.";

export type CustomerProductPurchasingRow = {
  sapItemCode: string;
  /** Product.itemName when a master-data match exists; otherwise the invoice line's own sapItemDescription (never dropped for a master-data gap). */
  description: string | null;
  productMasterMatch: { matched: true; productId: string; category: string } | { matched: false };
  quantityByUnit: ProductQuantityByUnit[];
  valueByCurrency: ProductValueByCurrency[];
  /** Distinct qualifying invoices containing this product, within the selected period. */
  purchaseFrequencyInPeriod: number;
  /** MAX(invoiceDate) among this product's qualifying invoices, within the selected period -- see this module's own top comment for why this is period-scoped here (not the separate, all-time/as-of-bounded customer-level recency figure in customer-revenue-queries.ts). */
  lastPurchasedDateInPeriod: string | null;
};

export type CustomerProductPurchasingReport = {
  periodFrom: string;
  periodTo: string;
  metricLabel: string;
  categoryDataQualityNote: string;
  products: CustomerProductPurchasingRow[];
};

export async function getCustomerProductPurchasing(customerId: string, filters: ReportFilters): Promise<CustomerProductPurchasingReport> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const customerFilter = { matchedCustomerId: customerId };

  const lines = await prisma.sapInvoiceLine.findMany({
    where: { ...demo, sapInvoice: { ...qualifyingInvoiceWhere(demo, customerFilter), invoiceDate: { not: null, ...periodDateRange } } },
    select: {
      sapItemCode: true,
      sapItemDescription: true,
      unitOfMeasure: true,
      quantityInvoiced: true,
      lineTotal: true,
      sapInvoiceId: true,
      sapInvoice: { select: { invoiceDate: true, currencyCode: true } },
    },
  });

  const records: ProductLineRecord[] = lines.map((line) => ({
    invoiceId: line.sapInvoiceId,
    invoiceDate: utcDateToDateOnlyString(line.sapInvoice.invoiceDate)!,
    sapItemCode: line.sapItemCode,
    sapItemDescription: line.sapItemDescription,
    unitOfMeasure: line.unitOfMeasure,
    quantityInvoiced: line.quantityInvoiced.toString(),
    lineTotal: line.lineTotal?.toString() ?? null,
    currency: line.sapInvoice.currencyCode,
  }));

  const aggregates = aggregateProductPurchasing(records);

  const itemCodes = aggregates.map((a) => a.sapItemCode).filter((code) => code !== UNKNOWN_SAP_ITEM_CODE);
  const products = itemCodes.length > 0 ? await prisma.product.findMany({ where: { sapItemCode: { in: itemCodes } }, select: { id: true, sapItemCode: true, itemName: true, category: true } }) : [];
  const productByItemCode = new Map(products.map((p) => [p.sapItemCode, p]));

  const rows: CustomerProductPurchasingRow[] = aggregates.map((agg) => {
    const product = productByItemCode.get(agg.sapItemCode);
    const category = product ? (product.category && product.category.trim() !== "" ? product.category : UNCATEGORIZED_LABEL) : undefined;
    return {
      sapItemCode: agg.sapItemCode,
      description: product?.itemName ?? agg.latestLineDescription,
      productMasterMatch: product ? { matched: true as const, productId: product.id, category: category! } : { matched: false as const },
      quantityByUnit: agg.quantityByUnit,
      valueByCurrency: agg.valueByCurrency,
      purchaseFrequencyInPeriod: agg.purchaseFrequency,
      lastPurchasedDateInPeriod: agg.lastPurchasedDate,
    };
  });

  return {
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    metricLabel: SAP_INVOICE_LINE_VALUE_LABEL,
    categoryDataQualityNote: PRODUCT_CATEGORY_DATA_QUALITY_NOTE,
    products: rows,
  };
}
