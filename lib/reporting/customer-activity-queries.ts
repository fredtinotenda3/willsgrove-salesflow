import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToDateOnlyFilter, defaultDateRange } from "@/lib/reporting/filters";
import { classifyCustomerPeriodActivity } from "@/lib/reporting/customer-activity";
import { sumMoneyRows, SAP_INVOICE_LINE_VALUE_LABEL } from "@/lib/reporting/sales-revenue";

/**
 * Milestone 12 (Sales Performance Intelligence). The database-backed
 * half of lib/reporting/customer-activity.ts -- see that module's own
 * comment for the qualifying-invoice/NEW/REPEAT definitions this file
 * implements, and lib/reporting/attribution-queries.ts's own comment
 * for why this file (unlike customer-activity.ts) is only exercised via
 * RUN_DB_INTEGRATION_TESTS=1.
 */

export type CustomerActivityRow = { customerId: string; customerName: string; firstQualifyingInvoiceDate: string };

export type CustomerActivityReport = {
  dateFrom: string;
  dateTo: string;
  newCustomers: CustomerActivityRow[];
  repeatCustomers: CustomerActivityRow[];
  newCustomerCount: number;
  repeatCustomerCount: number;
  /** Qualifying-invoice-eligible rows (isCancelledOrReversed: false, invoiceDate set) with no resolved matchedCustomerId -- excluded from NEW/REPEAT entirely, reported separately for transparency rather than silently dropped. */
  unattributedInvoiceCount: number;
  /** {@link SAP_INVOICE_LINE_VALUE_LABEL} summed across those same unattributed invoices' lines. */
  unattributedInvoiceValueLabel: string;
  unattributedInvoiceValue: string;
  /** isCancelledOrReversed: false invoices with NO invoiceDate at all -- can't be placed in any period, so never approximated from createdAt; counted all-time (not period-scoped), for the same reason. */
  invoicesWithNoUsableDateCount: number;
};

/** The one qualifying-invoice where-clause, reused by every query in this file -- see this module's own top comment for the definition. `customerFilter`/`demo` are spread in by callers so this stays the single source of truth for the business rule itself. */
function qualifyingInvoiceWhere(demo: Prisma.SapInvoiceWhereInput, customerFilter: Prisma.SapInvoiceWhereInput): Prisma.SapInvoiceWhereInput {
  return { ...demo, isCancelledOrReversed: false, matchedCustomerId: { not: null }, invoiceDate: { not: null }, ...customerFilter };
}

export async function getCustomerActivityReport(filters: ReportFilters): Promise<CustomerActivityReport> {
  const { dateFrom, dateTo } = defaultDateRange();
  const effectiveFrom = filters.dateFrom ?? dateFrom;
  const effectiveTo = filters.dateTo ?? dateTo;
  const dateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const periodFromDate = dateOnlyStringToUtcDate(effectiveFrom)!;
  const periodToDate = dateOnlyStringToUtcDate(effectiveTo)!;

  const demo = demoWhere(filters);
  const customerFilter: Prisma.SapInvoiceWhereInput = filters.customerId ? { matchedCustomerId: filters.customerId } : {};

  // Step 1: which customers have >=1 qualifying invoice INSIDE the
  // period at all -- only these are ever classified (see this module's
  // "NEITHER" rule).
  const activeThisPeriod = await prisma.sapInvoice.findMany({
    where: { ...qualifyingInvoiceWhere(demo, customerFilter), invoiceDate: { not: null, ...dateRange } },
    select: { matchedCustomerId: true },
    distinct: ["matchedCustomerId"],
  });
  const activeCustomerIds = activeThisPeriod.map((r) => r.matchedCustomerId).filter((id): id is string => id !== null);

  // Step 2: each active customer's ALL-TIME earliest qualifying invoice
  // date -- never scoped to the period (see classifyCustomerPeriodActivity's
  // own precondition comment for why this is always resolvable here).
  const earliestRows =
    activeCustomerIds.length > 0
      ? await prisma.sapInvoice.groupBy({
          by: ["matchedCustomerId"],
          where: { ...qualifyingInvoiceWhere(demo, {}), matchedCustomerId: { in: activeCustomerIds } },
          _min: { invoiceDate: true },
        })
      : [];

  const customers =
    activeCustomerIds.length > 0 ? await prisma.customer.findMany({ where: { id: { in: activeCustomerIds } }, select: { id: true, name: true } }) : [];
  const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

  const newCustomers: CustomerActivityRow[] = [];
  const repeatCustomers: CustomerActivityRow[] = [];
  for (const row of earliestRows) {
    const customerId = row.matchedCustomerId;
    const firstDate = row._min.invoiceDate;
    if (!customerId || !firstDate) continue; // unreachable given qualifyingInvoiceWhere's own filters
    const activity = classifyCustomerPeriodActivity(firstDate, periodFromDate, periodToDate);
    const entry: CustomerActivityRow = { customerId, customerName: customerNameById.get(customerId) ?? customerId, firstQualifyingInvoiceDate: firstDate.toISOString().slice(0, 10) };
    if (activity === "NEW") newCustomers.push(entry);
    else repeatCustomers.push(entry);
  }
  newCustomers.sort((a, b) => a.customerName.localeCompare(b.customerName));
  repeatCustomers.sort((a, b) => a.customerName.localeCompare(b.customerName));

  // Unattributed: an otherwise-qualifying invoice (not cancelled/reversed,
  // has an invoiceDate) with no resolved customer match at all, inside
  // the period -- excluded from NEW/REPEAT above, reported separately.
  const unattributedInvoices = await prisma.sapInvoice.findMany({
    where: { ...demo, isCancelledOrReversed: false, matchedCustomerId: null, invoiceDate: { not: null, ...dateRange } },
    select: { id: true },
  });
  const unattributedInvoiceCount = unattributedInvoices.length;
  const unattributedLines =
    unattributedInvoiceCount > 0
      ? await prisma.sapInvoiceLine.findMany({ where: { sapInvoiceId: { in: unattributedInvoices.map((i) => i.id) } }, select: { lineTotal: true } })
      : [];
  const { total: unattributedInvoiceValue } = sumMoneyRows(unattributedLines.map((l) => l.lineTotal?.toString() ?? null));

  // Invoices with no usable date at all -- cannot be placed in ANY
  // period, so this count is all-time (not period-scoped), and the
  // customer filter still applies when given.
  const invoicesWithNoUsableDateCount = await prisma.sapInvoice.count({
    where: { ...demo, isCancelledOrReversed: false, invoiceDate: null, ...customerFilter },
  });

  return {
    dateFrom: effectiveFrom,
    dateTo: effectiveTo,
    newCustomers,
    repeatCustomers,
    newCustomerCount: newCustomers.length,
    repeatCustomerCount: repeatCustomers.length,
    unattributedInvoiceCount,
    unattributedInvoiceValueLabel: SAP_INVOICE_LINE_VALUE_LABEL,
    unattributedInvoiceValue,
    invoicesWithNoUsableDateCount,
  };
}
