import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import type { AttributionBucket } from "@/lib/reporting/attribution";

/**
 * Milestone 12 (Sales Performance Intelligence). Pure money-aggregation
 * logic for the salesperson-performance/revenue report -- split out from
 * lib/reporting/sales-revenue-queries.ts for the same @prisma/client-
 * stub reason as lib/reporting/attribution.ts's own module comment
 * explains. Imports lib/fulfilment/decimal.ts (also prisma-free) for
 * exact fixed-point decimal summation, never floating point.
 *
 * "SAP invoice line value" -- deliberately NOT called "revenue," "gross
 * revenue," or "revenue excluding VAT." SapInvoiceLine.lineTotal's VAT
 * treatment (tax-inclusive vs. tax-exclusive) cannot be established from
 * this codebase or its documentation: lib/invoice-reconciliation/csv.ts's
 * importer treats it as a raw, operator-mapped CSV pass-through, never
 * computed or normalized, and a repository-wide search for inclusive/
 * exclusive VAT terminology (lib/, docs/, CHANGES.md, MILESTONE*.md,
 * prisma/schema.prisma) returns no matches. The one real, independently-
 * confirmed invoice example this project has ever examined (HRE580108,
 * item 0228) is VAT-zero-rated, which cannot resolve the question either
 * way. See docs/milestones/m12-metric-definitions.md. Every money figure
 * this module (and its callers) surface uses this exact label; this is a
 * deliberate decision and must never be silently reverted to "revenue."
 *
 * Attributed at LINE level (SapInvoiceLine.matchedOrderId/
 * matchedOrderLineId), never at invoice-HEADER level
 * (SapInvoice.matchedOrderId) -- an invoice spanning several SalesFlow
 * orders (explicitly supported by the schema) leaves the header-level
 * matchedOrderId null, so a header-level join would silently lose that
 * invoice's value attribution entirely. See SapInvoice.matchedOrderId's
 * own schema comment.
 *
 * Never summed across currency -- see groupRevenueByCurrencyAndSalesperson
 * below, which groups by currency FIRST and never produces a single
 * cross-currency total, the same "per-currency, never summed" precedent
 * lib/invoice-claims/financial.ts's exposureByCurrency already
 * established in this codebase.
 */

export const SAP_INVOICE_LINE_VALUE_LABEL = "SAP invoice line value";

export const UNKNOWN_CURRENCY = "UNKNOWN";

/** Normalizes a currency code for grouping -- trims/uppercases, and maps a missing/blank value to the explicit UNKNOWN_CURRENCY bucket rather than silently merging it into any one real currency. */
export function currencyKey(currencyCode: string | null | undefined): string {
  const trimmed = (currencyCode ?? "").trim().toUpperCase();
  return trimmed === "" ? UNKNOWN_CURRENCY : trimmed;
}

/**
 * Sums a list of possibly-null decimal strings (typically
 * Decimal.toString() values already read from the database), treating
 * null/missing as EXCLUDED from the sum -- never coerced to 0 ("never
 * invent missing SAP fields," the same rule this codebase's SAP-sourced
 * models already follow). Returns the sum as a decimal string plus how
 * many rows were excluded, so a caller never mistakes "sum of what we
 * have" for "sum of everything."
 */
export function sumMoneyRows(rows: readonly (string | null)[]): { total: string; excludedCount: number } {
  const present = rows.filter((r): r is string => r !== null);
  const excludedCount = rows.length - present.length;
  const total = present.length > 0 ? formatScaledDecimal(sumDecimalStrings(present)) : "0";
  return { total, excludedCount };
}

export type RevenueLineRecord = {
  /** Null only when this SapInvoiceLine has no matchedOrderId at all -- genuinely unattributed to any SalesFlow order. */
  orderId: string | null;
  /** The matched order's own salespersonId -- null for an unassigned order, and always null when orderId is null. */
  salespersonId: string | null;
  currency: string | null;
  lineTotal: string | null;
  /** The matched order's classification from lib/reporting/attribution.ts -- "UNASSIGNED" whenever salespersonId is null, whether because the order itself is unassigned or because there is no matched order at all. */
  attributionBucket: AttributionBucket;
};

export type SalespersonRevenueBreakdown = {
  salespersonId: string | null;
  orderCount: number;
  lineValueTotal: string;
  excludedLineCount: number;
  attributionBreakdown: Partial<Record<AttributionBucket, number>>;
};

export type CurrencyRevenueBreakdown = {
  currency: string;
  totalLineValue: string;
  excludedLineCount: number;
  bySalesperson: SalespersonRevenueBreakdown[];
};

/**
 * Groups already-fetched, already-attribution-classified revenue line
 * records by currency (never summed across currencies -- see this
 * module's own top comment), then by salesperson within each currency.
 * Pure data transformation; every value this returns is a decimal
 * STRING, computed via sumDecimalStrings/formatScaledDecimal, never a
 * floating-point addition.
 */
export function groupRevenueByCurrencyAndSalesperson(records: readonly RevenueLineRecord[]): CurrencyRevenueBreakdown[] {
  type SalespersonAccumulator = { orderIds: Set<string>; lineValues: string[]; excludedCount: number; breakdown: Map<AttributionBucket, number> };
  type CurrencyAccumulator = { lineValues: string[]; excludedCount: number; bySalesperson: Map<string, SalespersonAccumulator> };

  const UNASSIGNED_KEY = "__unassigned__";
  const byCurrency = new Map<string, CurrencyAccumulator>();

  for (const record of records) {
    const currency = currencyKey(record.currency);
    let currencyAcc = byCurrency.get(currency);
    if (!currencyAcc) {
      currencyAcc = { lineValues: [], excludedCount: 0, bySalesperson: new Map() };
      byCurrency.set(currency, currencyAcc);
    }
    if (record.lineTotal === null) currencyAcc.excludedCount += 1;
    else currencyAcc.lineValues.push(record.lineTotal);

    const salespersonKey = record.salespersonId ?? UNASSIGNED_KEY;
    let salespersonAcc = currencyAcc.bySalesperson.get(salespersonKey);
    if (!salespersonAcc) {
      salespersonAcc = { orderIds: new Set(), lineValues: [], excludedCount: 0, breakdown: new Map() };
      currencyAcc.bySalesperson.set(salespersonKey, salespersonAcc);
    }
    if (record.orderId) salespersonAcc.orderIds.add(record.orderId);
    if (record.lineTotal === null) salespersonAcc.excludedCount += 1;
    else salespersonAcc.lineValues.push(record.lineTotal);
    salespersonAcc.breakdown.set(record.attributionBucket, (salespersonAcc.breakdown.get(record.attributionBucket) ?? 0) + 1);
  }

  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, currencyAcc]) => ({
      currency,
      totalLineValue: currencyAcc.lineValues.length > 0 ? formatScaledDecimal(sumDecimalStrings(currencyAcc.lineValues)) : "0",
      excludedLineCount: currencyAcc.excludedCount,
      bySalesperson: [...currencyAcc.bySalesperson.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([salespersonKey, salespersonAcc]) => ({
          salespersonId: salespersonKey === UNASSIGNED_KEY ? null : salespersonKey,
          orderCount: salespersonAcc.orderIds.size,
          lineValueTotal: salespersonAcc.lineValues.length > 0 ? formatScaledDecimal(sumDecimalStrings(salespersonAcc.lineValues)) : "0",
          excludedLineCount: salespersonAcc.excludedCount,
          attributionBreakdown: Object.fromEntries(salespersonAcc.breakdown),
        })),
    }));
}
