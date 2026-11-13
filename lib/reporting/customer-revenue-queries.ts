import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToDateOnlyFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { dateOnlyStringToUtcDate, utcDateToDateOnlyString } from "@/lib/dates";
import { qualifyingInvoiceWhere } from "@/lib/reporting/customer-activity-queries";
import {
  groupRevenueByCurrencyAndCustomer,
  summarizeCustomerRevenueByCurrency,
  type CustomerRevenueLineRecord,
} from "@/lib/reporting/customer-revenue";
import { SAP_INVOICE_LINE_VALUE_LABEL, sumMoneyRows } from "@/lib/reporting/sales-revenue";
import { resolveAsOfDate, computeDaysSinceLastQualifyingInvoice, computeAverageInterPurchaseInterval, type AsOfDateSource } from "@/lib/reporting/customer-recency";
import { rankByValue } from "@/lib/reporting/customer-segmentation";
import { getOpenClaimsCountByCustomer } from "@/lib/reporting/customer-commercial-health-queries";

/**
 * Milestone 13 (Customer Intelligence). The database-backed half of
 * lib/reporting/customer-revenue.ts, plus the customer-level invoice-
 * history metrics (all-time-first/as-of-bounded-last/period-frequency/
 * inter-purchase-interval) and the management overview's ranked
 * assembly -- all three share the same qualifying-invoice fetch, so they
 * are kept in one file rather than split and forced to re-derive each
 * other's intermediate results.
 *
 * Only exercised via RUN_DB_INTEGRATION_TESTS=1, same reason as every
 * other *-queries.ts file in this project (@prisma/client-stub sandbox
 * limitation -- see lib/reporting/attribution-queries.ts's own comment).
 *
 * Reuses lib/reporting/customer-activity-queries.ts's own
 * qualifyingInvoiceWhere (now exported) as the single source of truth
 * for the qualifying-invoice rule -- never re-typed here.
 */

// ---------------------------------------------------------------------------
// Customer 360 profile: one customer's own revenue + invoice-history figures.
// ---------------------------------------------------------------------------

export type CustomerInvoiceHistory = {
  /** All-time, unbounded by any as-of date -- MIN(invoiceDate) across every qualifying invoice this customer has ever had. */
  firstQualifyingInvoiceDate: string | null;
  /** MAX(invoiceDate) among qualifying invoices with invoiceDate <= asOfDate -- bounded, reproducible. */
  lastQualifyingInvoiceDateAsOf: string | null;
  asOfDate: string;
  asOfDateSource: AsOfDateSource;
  /** Whole days between lastQualifyingInvoiceDateAsOf and asOfDate -- null, never 0, when there is no qualifying invoice at all as of asOfDate. */
  daysSinceLastQualifyingInvoice: number | null;
  /** COUNT of qualifying invoices with invoiceDate inside [periodFrom, periodTo]. */
  purchaseFrequencyInPeriod: number;
  /** Average day-gap between consecutive qualifying invoice dates INSIDE the period -- "insufficient_data" (never 0) when fewer than 2 such dates exist. */
  averageInterPurchaseIntervalInPeriod: { status: "ok"; averageDays: number } | { status: "insufficient_data" };
  periodFrom: string;
  periodTo: string;
};

export type CustomerRevenueProfile = {
  metricLabel: string;
  byCurrency: { currency: string; lineValueTotal: string; excludedLineCount: number }[];
  history: CustomerInvoiceHistory;
};

export async function getCustomerRevenueProfile(customerId: string, filters: ReportFilters): Promise<CustomerRevenueProfile> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const { asOfDate, source: asOfDateSource } = resolveAsOfDate({ dateTo: filters.dateTo });
  const asOfDateUtc = dateOnlyStringToUtcDate(asOfDate)!;

  const customerFilter: Prisma.SapInvoiceWhereInput = { matchedCustomerId: customerId };

  // Period-scoped lines, for this customer's own SAP invoice line value
  // by currency AND for the within-period dates used by purchase
  // frequency / inter-purchase interval.
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const periodInvoices = await prisma.sapInvoice.findMany({
    where: { ...qualifyingInvoiceWhere(demo, customerFilter), invoiceDate: { not: null, ...periodDateRange } },
    select: { id: true, invoiceDate: true, currencyCode: true, lines: { select: { lineTotal: true } } },
  });

  const records: CustomerRevenueLineRecord[] = periodInvoices.flatMap((invoice) =>
    invoice.lines.map((line) => ({ customerId, currency: invoice.currencyCode, lineTotal: line.lineTotal?.toString() ?? null }))
  );
  const byCurrency = summarizeCustomerRevenueByCurrency(customerId, records);

  const periodDatesOnly = periodInvoices.map((i) => utcDateToDateOnlyString(i.invoiceDate)!);
  const averageInterPurchaseIntervalInPeriod = computeAverageInterPurchaseInterval(periodDatesOnly);

  // All-time first (unbounded) and as-of-bounded last qualifying invoice
  // date -- two SEPARATE, deliberately differently-scoped queries, never
  // conflated (see lib/reporting/customer-recency.ts's own top comment).
  const [firstRow, lastRow] = await Promise.all([
    prisma.sapInvoice.aggregate({ where: qualifyingInvoiceWhere(demo, customerFilter), _min: { invoiceDate: true } }),
    prisma.sapInvoice.aggregate({
      where: { ...qualifyingInvoiceWhere(demo, customerFilter), invoiceDate: { not: null, lte: asOfDateUtc } },
      _max: { invoiceDate: true },
    }),
  ]);

  const firstQualifyingInvoiceDate = utcDateToDateOnlyString(firstRow._min.invoiceDate ?? null);
  const lastQualifyingInvoiceDateAsOf = utcDateToDateOnlyString(lastRow._max.invoiceDate ?? null);

  return {
    metricLabel: SAP_INVOICE_LINE_VALUE_LABEL,
    byCurrency,
    history: {
      firstQualifyingInvoiceDate,
      lastQualifyingInvoiceDateAsOf,
      asOfDate,
      asOfDateSource,
      daysSinceLastQualifyingInvoice: computeDaysSinceLastQualifyingInvoice(asOfDate, lastQualifyingInvoiceDateAsOf),
      purchaseFrequencyInPeriod: periodInvoices.length,
      averageInterPurchaseIntervalInPeriod,
      periodFrom: effectiveFrom,
      periodTo: effectiveTo,
    },
  };
}

// ---------------------------------------------------------------------------
// Management overview: all eligible customers, ranked independently along
// three dimensions. No per-customer loop -- a bounded number of queries
// regardless of how many customers exist.
// ---------------------------------------------------------------------------

export type CustomerIntelligenceOverviewRow = {
  customerId: string;
  customerName: string;
  revenueByCurrency: { currency: string; lineValueTotal: string; rank: number }[];
  purchaseFrequencyInPeriod: number;
  purchaseFrequencyRank: number;
  daysSinceLastQualifyingInvoice: number | null;
  /** Null when the customer has no qualifying invoice at all as of asOfDate -- a customer who has never purchased cannot be meaningfully ranked by recency. */
  daysSinceLastQualifyingInvoiceRank: number | null;
  /** Calculated, approximated from InvoiceClaim.claimDate/closedAt only (no event-sourced status history exists) -- see lib/reporting/customer-commercial-health-queries.ts's own comment. */
  openClaimsCountAsOfReportingDate: number;
};

export type CustomerIntelligenceOverviewReport = {
  periodFrom: string;
  periodTo: string;
  asOfDate: string;
  asOfDateSource: AsOfDateSource;
  /** Milestone 13 default: minimumActivityOnly is OFF unless the caller explicitly requests it -- i.e. every eligible customer (any status, excluding demo unless includeDemo) is shown by default, including those with zero qualifying invoices in the selected period. See this function's own comment for why. */
  minimumActivityOnly: boolean;
  metricLabel: string;
  rows: CustomerIntelligenceOverviewRow[];
  dataQuality: {
    unattributedInvoiceCount: number;
    unattributedInvoiceValueLabel: string;
    unattributedInvoiceValue: string;
    invoicesWithNoUsableDateCount: number;
  };
};

export async function getCustomerIntelligenceOverview(filters: ReportFilters, minimumActivityOnly: boolean): Promise<CustomerIntelligenceOverviewReport> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const { asOfDate, source: asOfDateSource } = resolveAsOfDate({ dateTo: filters.dateTo });
  const asOfDateUtc = dateOnlyStringToUtcDate(asOfDate)!;
  const currencyFilter: Prisma.SapInvoiceWhereInput = filters.currency ? { currencyCode: filters.currency } : {};
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });

  // Period-scoped qualifying invoices (header + lines) -- ONE query,
  // drives both revenue-by-currency and period purchase frequency.
  const periodInvoices = await prisma.sapInvoice.findMany({
    where: { ...qualifyingInvoiceWhere(demo, {}), ...currencyFilter, invoiceDate: { not: null, ...periodDateRange } },
    select: { id: true, matchedCustomerId: true, currencyCode: true, lines: { select: { lineTotal: true } } },
  });

  const revenueRecords: CustomerRevenueLineRecord[] = periodInvoices.flatMap((invoice) =>
    invoice.lines.map((line) => ({ customerId: invoice.matchedCustomerId!, currency: invoice.currencyCode, lineTotal: line.lineTotal?.toString() ?? null }))
  );
  const revenueBreakdown = groupRevenueByCurrencyAndCustomer(revenueRecords);

  const frequencyByCustomer = new Map<string, number>();
  for (const invoice of periodInvoices) {
    const id = invoice.matchedCustomerId!;
    frequencyByCustomer.set(id, (frequencyByCustomer.get(id) ?? 0) + 1);
  }

  // As-of-bounded last qualifying invoice date, per customer -- ALL-TIME
  // lower bound, upper-bounded only by asOfDate (never by the period's
  // own dateFrom), so a customer's recency figure reflects their real
  // last purchase even if that falls outside the selected period.
  const recencyRows = await prisma.sapInvoice.groupBy({
    by: ["matchedCustomerId"],
    where: { ...qualifyingInvoiceWhere(demo, {}), ...currencyFilter, invoiceDate: { not: null, lte: asOfDateUtc } },
    _max: { invoiceDate: true },
  });
  const lastInvoiceDateByCustomer = new Map<string, string>();
  for (const row of recencyRows) {
    if (row.matchedCustomerId && row._max.invoiceDate) {
      lastInvoiceDateByCustomer.set(row.matchedCustomerId, utcDateToDateOnlyString(row._max.invoiceDate)!);
    }
  }

  // Customer universe: either only customers active in the period
  // (minimumActivityOnly), or every eligible customer regardless of
  // status -- a customer that has gone INACTIVE but still has real
  // invoice history is deliberately NOT hidden from an intelligence
  // report (unlike the plain filter-dropdown in lib/reporting/
  // filter-options.ts, which is ACTIVE-only for a different, UX reason).
  let universeIds: string[];
  let customerNameById: Map<string, string>;
  if (minimumActivityOnly) {
    universeIds = [...frequencyByCustomer.keys()];
    const names = universeIds.length > 0 ? await prisma.customer.findMany({ where: { id: { in: universeIds } }, select: { id: true, name: true } }) : [];
    customerNameById = new Map(names.map((c) => [c.id, c.name]));
  } else {
    const allCustomers = await prisma.customer.findMany({ where: { ...demo }, select: { id: true, name: true } });
    universeIds = allCustomers.map((c) => c.id);
    customerNameById = new Map(allCustomers.map((c) => [c.id, c.name]));
  }

  const openClaimsByCustomer = await getOpenClaimsCountByCustomer(universeIds, asOfDate, filters);

  // Rank revenue PER CURRENCY, among only the customers who actually
  // have a value in that currency -- a customer with no activity in a
  // given currency is simply absent from that currency's ranking, never
  // ranked against a currency it never transacted in.
  const revenueRankByCurrencyAndCustomer = new Map<string, Map<string, number>>();
  for (const currencyRow of revenueBreakdown) {
    const ranked = rankByValue(
      currencyRow.byCustomer.map((c) => ({ customerId: c.customerId, value: Number(c.lineValueTotal) })),
      "descending"
    );
    revenueRankByCurrencyAndCustomer.set(currencyRow.currency, new Map(ranked.map((r) => [r.customerId, r.rank])));
  }

  const frequencyRanked = rankByValue(universeIds.map((id) => ({ customerId: id, value: frequencyByCustomer.get(id) ?? 0 })), "descending");
  const frequencyRankByCustomer = new Map(frequencyRanked.map((r) => [r.customerId, r.rank]));

  const recencyCandidates = universeIds.filter((id) => lastInvoiceDateByCustomer.has(id));
  const recencyRanked = rankByValue(
    recencyCandidates.map((id) => ({ customerId: id, value: computeDaysSinceLastQualifyingInvoice(asOfDate, lastInvoiceDateByCustomer.get(id)!)! })),
    "ascending"
  );
  const recencyRankByCustomer = new Map(recencyRanked.map((r) => [r.customerId, r.rank]));

  const rows: CustomerIntelligenceOverviewRow[] = universeIds
    .map((customerId) => {
      const revenueByCurrency = revenueBreakdown
        .map((currencyRow) => {
          const row = currencyRow.byCustomer.find((c) => c.customerId === customerId);
          if (!row) return null;
          return { currency: currencyRow.currency, lineValueTotal: row.lineValueTotal, rank: revenueRankByCurrencyAndCustomer.get(currencyRow.currency)!.get(customerId)! };
        })
        .filter((r): r is { currency: string; lineValueTotal: string; rank: number } => r !== null);

      const lastDate = lastInvoiceDateByCustomer.get(customerId) ?? null;

      return {
        customerId,
        customerName: customerNameById.get(customerId) ?? customerId,
        revenueByCurrency,
        purchaseFrequencyInPeriod: frequencyByCustomer.get(customerId) ?? 0,
        purchaseFrequencyRank: frequencyRankByCustomer.get(customerId)!,
        daysSinceLastQualifyingInvoice: computeDaysSinceLastQualifyingInvoice(asOfDate, lastDate),
        daysSinceLastQualifyingInvoiceRank: recencyRankByCustomer.get(customerId) ?? null,
        openClaimsCountAsOfReportingDate: openClaimsByCustomer.get(customerId) ?? 0,
      };
    })
    .sort((a, b) => a.customerName.localeCompare(b.customerName));

  // Data-quality panel -- reuses the EXACT unmatched/no-usable-date
  // definitions lib/reporting/customer-activity-queries.ts already
  // established in Milestone 12, never redefined here.
  const unattributedInvoices = await prisma.sapInvoice.findMany({
    where: { ...demo, isCancelledOrReversed: false, matchedCustomerId: null, invoiceDate: { not: null, ...periodDateRange } },
    select: { id: true },
  });
  const unattributedLines =
    unattributedInvoices.length > 0
      ? await prisma.sapInvoiceLine.findMany({ where: { sapInvoiceId: { in: unattributedInvoices.map((i) => i.id) } }, select: { lineTotal: true } })
      : [];
  const { total: unattributedInvoiceValue } = sumMoneyRows(unattributedLines.map((l) => l.lineTotal?.toString() ?? null));
  const invoicesWithNoUsableDateCount = await prisma.sapInvoice.count({ where: { ...demo, isCancelledOrReversed: false, invoiceDate: null } });

  return {
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    asOfDate,
    asOfDateSource,
    minimumActivityOnly,
    metricLabel: SAP_INVOICE_LINE_VALUE_LABEL,
    rows,
    dataQuality: {
      unattributedInvoiceCount: unattributedInvoices.length,
      unattributedInvoiceValueLabel: SAP_INVOICE_LINE_VALUE_LABEL,
      unattributedInvoiceValue,
      invoicesWithNoUsableDateCount,
    },
  };
}
