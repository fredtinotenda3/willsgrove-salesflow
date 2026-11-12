import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToDateOnlyFilter, defaultDateRange } from "@/lib/reporting/filters";
import { classifyOrderAttributions, type OrderForAttribution } from "@/lib/reporting/attribution-queries";
import {
  groupRevenueByCurrencyAndSalesperson,
  sumMoneyRows,
  SAP_INVOICE_LINE_VALUE_LABEL,
  type RevenueLineRecord,
  type CurrencyRevenueBreakdown,
} from "@/lib/reporting/sales-revenue";

/**
 * Milestone 12 (Sales Performance Intelligence). The database-backed
 * half of lib/reporting/sales-revenue.ts -- see that module's own
 * comment for the "SAP invoice line value" labelling decision and the
 * line-level (never header-level) attribution join, and lib/reporting/
 * attribution-queries.ts's own comment for why this file is only
 * exercised via RUN_DB_INTEGRATION_TESTS=1.
 */

export type SalesRevenueReport = {
  dateFrom: string;
  dateTo: string;
  metricLabel: string;
  byCurrency: CurrencyRevenueBreakdown[];
  /** SapInvoice.total/taxTotal/subtotal, summed separately at HEADER level -- never implied to reconcile exactly against totalLineValue above (rounding and header-only discounts can legitimately differ). Per currency, same never-summed-across-currencies rule. */
  headerTotalsByCurrency: { currency: string; totalSapInvoiceTotal: string; totalSapTaxTotal: string; totalSapSubtotal: string; missingHeaderTotalCount: number }[];
  salespeople: { id: string; name: string }[];
};

export async function getSalesRevenueReport(filters: ReportFilters): Promise<SalesRevenueReport> {
  const { dateFrom, dateTo } = defaultDateRange();
  const effectiveFrom = filters.dateFrom ?? dateFrom;
  const effectiveTo = filters.dateTo ?? dateTo;
  const dateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  const demo = demoWhere(filters);
  const customerFilter: Prisma.SapInvoiceWhereInput = filters.customerId ? { matchedCustomerId: filters.customerId } : {};
  // Milestone 12. currency narrows to exactly one SapInvoice.currencyCode --
  // applied at the invoice-header level (every line on one invoice shares
  // its parent's currencyCode; there is no per-line currency field), so
  // this filter is equivalent whether read as "only this currency's
  // invoices" or "only this currency's lines."
  const currencyFilter: Prisma.SapInvoiceWhereInput = filters.currency ? { currencyCode: filters.currency } : {};

  const invoiceWhere: Prisma.SapInvoiceWhereInput = { ...demo, isCancelledOrReversed: false, invoiceDate: { not: null, ...dateRange }, ...customerFilter, ...currencyFilter };

  // --- Line-level value, attributed via matchedOrderId (never the
  // invoice header's own matchedOrderId -- see this file's own module
  // comment). ---
  const lines = await prisma.sapInvoiceLine.findMany({
    where: { ...demoWhere(filters), sapInvoice: invoiceWhere },
    select: { lineTotal: true, matchedOrderId: true, sapInvoice: { select: { currencyCode: true } } },
  });

  const orderIds = [...new Set(lines.map((l) => l.matchedOrderId).filter((id): id is string => id !== null))];
  const orders =
    orderIds.length > 0
      ? await prisma.customerOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, salespersonId: true, createdById: true, source: true, createdBy: { select: { role: true } } },
        })
      : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const forAttribution: OrderForAttribution[] = orders.map((o) => ({
    id: o.id,
    salespersonId: o.salespersonId,
    createdById: o.createdById,
    createdByRole: o.createdBy.role,
    source: o.source,
  }));
  const attributionByOrderId = await classifyOrderAttributions(forAttribution);

  // Salesperson filter, applied AFTER the join (lines carry no
  // salespersonId of their own) -- a filtered report's totals then
  // genuinely represent only that one salesperson's value, same
  // "filter narrows what's summed" behavior every other M11/M12 report
  // gives.
  const records: RevenueLineRecord[] = lines
    .map((line) => {
      const order = line.matchedOrderId ? orderById.get(line.matchedOrderId) : undefined;
      const salespersonId = order?.salespersonId ?? null;
      const attributionBucket = line.matchedOrderId ? attributionByOrderId.get(line.matchedOrderId) ?? "UNVERIFIED_NO_PROVENANCE" : "UNASSIGNED";
      return {
        orderId: line.matchedOrderId,
        salespersonId,
        currency: line.sapInvoice.currencyCode,
        lineTotal: line.lineTotal?.toString() ?? null,
        attributionBucket,
      } satisfies RevenueLineRecord;
    })
    .filter((record) => !filters.salespersonId || record.salespersonId === filters.salespersonId);

  const byCurrency = groupRevenueByCurrencyAndSalesperson(records);

  // --- Header-level totals, kept separately available -- never implied
  // to reconcile against totalLineValue above. ---
  const headerRows = await prisma.sapInvoice.findMany({ where: invoiceWhere, select: { total: true, taxTotal: true, subtotal: true, currencyCode: true } });
  const headerByCurrency = new Map<string, { total: (string | null)[]; tax: (string | null)[]; subtotal: (string | null)[] }>();
  for (const row of headerRows) {
    const currency = row.currencyCode?.trim().toUpperCase() || "UNKNOWN";
    let bucket = headerByCurrency.get(currency);
    if (!bucket) {
      bucket = { total: [], tax: [], subtotal: [] };
      headerByCurrency.set(currency, bucket);
    }
    bucket.total.push(row.total?.toString() ?? null);
    bucket.tax.push(row.taxTotal?.toString() ?? null);
    bucket.subtotal.push(row.subtotal?.toString() ?? null);
  }
  const headerTotalsByCurrency = [...headerByCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, bucket]) => {
      const total = sumMoneyRows(bucket.total);
      const tax = sumMoneyRows(bucket.tax);
      const subtotal = sumMoneyRows(bucket.subtotal);
      return {
        currency,
        totalSapInvoiceTotal: total.total,
        totalSapTaxTotal: tax.total,
        totalSapSubtotal: subtotal.total,
        missingHeaderTotalCount: total.excludedCount,
      };
    });

  const salespersonIds = [...new Set(orders.map((o) => o.salespersonId).filter((id): id is string => id !== null))];
  const salespeople = salespersonIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: salespersonIds } }, select: { id: true, name: true } }) : [];

  return {
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    metricLabel: SAP_INVOICE_LINE_VALUE_LABEL,
    byCurrency,
    headerTotalsByCurrency,
    salespeople,
  };
}
