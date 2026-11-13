import "server-only";
import type { LostSaleReason } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToTimestampFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { getCustomerById } from "@/lib/customer-queries";
import { getCustomerRevenueProfile, type CustomerRevenueProfile } from "@/lib/reporting/customer-revenue-queries";
import { getCustomerProductPurchasing, type CustomerProductPurchasingReport } from "@/lib/reporting/customer-purchasing-queries";
import { getCustomerCommercialHealth, type CustomerCommercialHealth } from "@/lib/reporting/customer-commercial-health-queries";
import { getCustomerActivityReport } from "@/lib/reporting/customer-activity-queries";
import { classifyOrderAttributions, type OrderForAttribution } from "@/lib/reporting/attribution-queries";
import { ATTRIBUTION_BUCKET_LABELS, type AttributionBucket } from "@/lib/reporting/attribution";
import { sumMoneyRows } from "@/lib/reporting/sales-revenue";

/**
 * Milestone 13 (Customer Intelligence). The composite Customer 360 read
 * function -- assembles (never re-derives) every section this
 * milestone's spec requires, each from its own already-built M12/M13
 * module. Nothing in this file computes a business rule of its own; it
 * is pure composition plus two small, genuinely new joins
 * (lost-sales-by-customer, orders/quotations-by-customer) that have no
 * existing per-customer query anywhere else to reuse.
 *
 * Only exercised via RUN_DB_INTEGRATION_TESTS=1, same reason as every
 * other *-queries.ts file in this project.
 */

export type CustomerLostSalesSummary = {
  confirmedCount: number;
  confirmedQuantity: string;
  byReason: Record<string, { count: number; quantity: string }>;
  /** Estimated, never authoritative SAP data -- excludes rows with no estimatedValue (never coerced to 0), grouped by currency, never summed across currency. Reuses the exact LostSaleRecord.confirmedAt anchor and estimation precedent Milestone 12/4 already established -- no new estimation formula. */
  estimatedValueByCurrency: { currency: string; totalEstimatedValue: string; excludedCount: number }[];
};

async function getCustomerLostSales(customerId: string, filters: ReportFilters, effectiveFrom: string, effectiveTo: string): Promise<CustomerLostSalesSummary> {
  const demo = demoWhere(filters);
  const range = dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  const records = await prisma.lostSaleRecord.findMany({
    where: {
      confirmedAt: range,
      ...(filters.lostSalesReason ? { reason: filters.lostSalesReason as LostSaleReason } : {}),
      unfulfilledDemand: { ...demo, customerId },
    },
    select: { quantity: true, reason: true, estimatedValue: true, unfulfilledDemand: { select: { orderId: true } } },
  });

  const orderIds = [...new Set(records.map((r) => r.unfulfilledDemand.orderId))];
  const orders = orderIds.length > 0 ? await prisma.customerOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, currency: true } }) : [];
  const currencyByOrderId = new Map(orders.map((o) => [o.id, o.currency]));

  const byReason = new Map<string, { count: number; quantities: string[] }>();
  const valueByCurrency = new Map<string, (string | null)[]>();
  for (const r of records) {
    const acc = byReason.get(r.reason) ?? { count: 0, quantities: [] };
    acc.count += 1;
    acc.quantities.push(r.quantity.toString());
    byReason.set(r.reason, acc);

    const currency = currencyByOrderId.get(r.unfulfilledDemand.orderId) ?? "USD";
    if (!filters.currency || currency === filters.currency) {
      const bucket = valueByCurrency.get(currency) ?? [];
      bucket.push(r.estimatedValue?.toString() ?? null);
      valueByCurrency.set(currency, bucket);
    }
  }

  return {
    confirmedCount: records.length,
    confirmedQuantity: records.length > 0 ? formatScaledDecimal(sumDecimalStrings(records.map((r) => r.quantity.toString()))) : "0",
    byReason: Object.fromEntries([...byReason.entries()].map(([reason, acc]) => [reason, { count: acc.count, quantity: formatScaledDecimal(sumDecimalStrings(acc.quantities)) }])),
    estimatedValueByCurrency: [...valueByCurrency.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, values]) => {
        const { total, excludedCount } = sumMoneyRows(values);
        return { currency, totalEstimatedValue: total, excludedCount };
      }),
  };
}

export type CustomerOrderAttributionRow = {
  salespersonId: string | null;
  salespersonName: string;
  orderCount: number;
  attributionBreakdown: Partial<Record<AttributionBucket, number>>;
};

export type CustomerQuotationProvenanceRow = {
  quotationId: string;
  quotationNumber: string;
  revisionNumber: number;
  /** Quotation.salespersonId -- a REQUIRED field on this schema, unlike CustomerOrder.salespersonId, so it is shown as-is, never run through the order-attribution-confidence classifier (spec: "do not invent a quotation confidence classification"). */
  salespersonId: string;
  salespersonName: string;
  preparedById: string;
  preparedByName: string;
  status: string;
};

/**
 * This customer's orders, grouped by salesperson and M12 attribution-
 * confidence bucket -- REUSES classifyOrderAttributions verbatim
 * (lib/reporting/attribution-queries.ts), never a re-derived
 * classification. Separately, this customer's quotations with their
 * salespersonId/preparedById shown plainly -- no classification applied
 * to quotations at all, per the explicit instruction not to invent one.
 */
async function getCustomerSalespersonRelationship(customerId: string, filters: ReportFilters) {
  const demo = demoWhere(filters);

  const orders = await prisma.customerOrder.findMany({
    where: { customerId, ...demo },
    select: { id: true, salespersonId: true, createdById: true, source: true, createdBy: { select: { role: true } } },
  });
  const forAttribution: OrderForAttribution[] = orders.map((o) => ({ id: o.id, salespersonId: o.salespersonId, createdById: o.createdById, createdByRole: o.createdBy.role, source: o.source }));
  const attributionByOrderId = await classifyOrderAttributions(forAttribution);

  const salespersonIds = [...new Set(orders.map((o) => o.salespersonId).filter((id): id is string => id !== null))];
  const UNASSIGNED_KEY = "__unassigned__";
  type Acc = { orderCount: number; breakdown: Map<AttributionBucket, number> };
  const bySalesperson = new Map<string, Acc>();
  for (const order of orders) {
    const key = order.salespersonId ?? UNASSIGNED_KEY;
    const acc = bySalesperson.get(key) ?? { orderCount: 0, breakdown: new Map() };
    acc.orderCount += 1;
    const bucket = attributionByOrderId.get(order.id) ?? "UNVERIFIED_NO_PROVENANCE";
    acc.breakdown.set(bucket, (acc.breakdown.get(bucket) ?? 0) + 1);
    bySalesperson.set(key, acc);
  }

  const quotations = await prisma.quotation.findMany({
    where: { customerId, ...demo, supersededAt: null },
    select: { id: true, quotationNumber: true, revisionNumber: true, salespersonId: true, preparedById: true, status: true },
    orderBy: { quotationDate: "desc" },
  });
  const preparedByIds = [...new Set(quotations.map((q) => q.preparedById))];
  const peopleIds = [...new Set([...salespersonIds, ...quotations.map((q) => q.salespersonId), ...preparedByIds])];
  const people = peopleIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true } }) : [];
  const nameById = new Map(people.map((p) => [p.id, p.name]));

  const ordersBySalesperson: CustomerOrderAttributionRow[] = [...bySalesperson.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, acc]) => ({
      salespersonId: key === UNASSIGNED_KEY ? null : key,
      salespersonName: key === UNASSIGNED_KEY ? "Unassigned" : nameById.get(key) ?? key,
      orderCount: acc.orderCount,
      attributionBreakdown: Object.fromEntries(acc.breakdown),
    }));

  const quotationProvenance: CustomerQuotationProvenanceRow[] = quotations.map((q) => ({
    quotationId: q.id,
    quotationNumber: q.quotationNumber,
    revisionNumber: q.revisionNumber,
    salespersonId: q.salespersonId,
    salespersonName: nameById.get(q.salespersonId) ?? q.salespersonId,
    preparedById: q.preparedById,
    preparedByName: nameById.get(q.preparedById) ?? q.preparedById,
    status: q.status,
  }));

  return { ordersBySalesperson, quotationProvenance };
}

export type CustomerProfile = {
  customer: NonNullable<Awaited<ReturnType<typeof getCustomerById>>>;
  revenue: CustomerRevenueProfile;
  purchasing: CustomerProductPurchasingReport;
  lostSales: CustomerLostSalesSummary;
  commercialHealth: CustomerCommercialHealth;
  salespersonRelationship: Awaited<ReturnType<typeof getCustomerSalespersonRelationship>>;
  /** Scoped to this customer -- reuses lib/reporting/customer-activity-queries.ts's own unmatched/no-usable-date figures via its existing customerId filter, never a re-derived data-quality rule. */
  dataQuality: {
    unattributedInvoiceCount: number;
    unattributedInvoiceValueLabel: string;
    unattributedInvoiceValue: string;
    invoicesWithNoUsableDateCount: number;
  };
};

export async function getCustomerProfile(customerId: string, filters: ReportFilters): Promise<CustomerProfile | null> {
  const customer = await getCustomerById(customerId);
  if (!customer) return null;

  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);

  const [revenue, purchasing, lostSales, commercialHealth, salespersonRelationship, activity] = await Promise.all([
    getCustomerRevenueProfile(customerId, filters),
    getCustomerProductPurchasing(customerId, filters),
    getCustomerLostSales(customerId, filters, effectiveFrom, effectiveTo),
    getCustomerCommercialHealth(customerId, filters),
    getCustomerSalespersonRelationship(customerId, filters),
    getCustomerActivityReport({ ...filters, customerId }),
  ]);

  return {
    customer,
    revenue,
    purchasing,
    lostSales,
    commercialHealth,
    salespersonRelationship,
    dataQuality: {
      unattributedInvoiceCount: activity.unattributedInvoiceCount,
      unattributedInvoiceValueLabel: activity.unattributedInvoiceValueLabel,
      unattributedInvoiceValue: activity.unattributedInvoiceValue,
      invoicesWithNoUsableDateCount: activity.invoicesWithNoUsableDateCount,
    },
  };
}

export { ATTRIBUTION_BUCKET_LABELS };
