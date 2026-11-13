import "server-only";
import { prisma } from "@/lib/prisma";
import type { ReportFilters } from "@/lib/reporting/types";
import { demoWhere, dateRangeToDateOnlyFilter, dateRangeToTimestampFilter, resolveEffectiveDateRange } from "@/lib/reporting/filters";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import { computeExposureByCurrency, type CurrencyExposureBucket } from "@/lib/invoice-claims/financial";
import { currencyKey } from "@/lib/reporting/sales-revenue";
import { sumDecimalStrings, formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { resolveAsOfDate, type AsOfDateSource } from "@/lib/reporting/customer-recency";

/**
 * Milestone 13 (Customer Intelligence). Customer-level commercial-health
 * aggregation -- claims, physical returns, actual credit notes (PRIMARY
 * evidence), and a separate delivery-outcome-rejection signal
 * (SECONDARY, operational, never combined with the primary figures).
 *
 * Reuses lib/invoice-claims/financial.ts's computeExposureByCurrency
 * verbatim for the potential/approved/actual-credited exposure figures
 * -- zero new financial logic for claims. Only exercised via
 * RUN_DB_INTEGRATION_TESTS=1, same reason as every other *-queries.ts
 * file in this project.
 *
 * "Open as of the reporting date" limitation, stated honestly: this
 * schema has no event-sourced claim-status history (AuditEvent records
 * every change, but -- per this codebase's own established convention,
 * see Quotation's schema comment -- is never replayed into a point-in-
 * time reconstruction anywhere). "Open as of D" is therefore CALCULATED,
 * approximated from the only two timestamps the schema actually has:
 *   open-as-of-D  :=  claimDate <= D  AND  (closedAt IS NULL OR closedAt is on/after the day after D)
 * This is an approximation, not a true historical replay of `status` --
 * documented here and in docs/milestones/m13-metric-definitions.md, and
 * never presented as "actual."
 */

const OPEN_CLAIM_GROUP_SIZE = 500; // prisma `in:` filters stay well-formed at this size; batched purely for driver-level safety on an unusually large customerIds list, never a sign of a per-customer loop.

/**
 * Bulk open-claims-count for a set of customers, in ONE query (batched
 * only if customerIds exceeds OPEN_CLAIM_GROUP_SIZE) -- used by the
 * management overview (lib/reporting/customer-revenue-queries.ts), never
 * called once per customer.
 */
export async function getOpenClaimsCountByCustomer(customerIds: readonly string[], asOfDate: string, filters: Pick<ReportFilters, "includeDemo">): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (customerIds.length === 0) return counts;

  const asOfDateUtc = dateOnlyStringToUtcDate(asOfDate)!;
  const dayAfterAsOf = new Date(asOfDateUtc);
  dayAfterAsOf.setUTCDate(dayAfterAsOf.getUTCDate() + 1);

  for (let i = 0; i < customerIds.length; i += OPEN_CLAIM_GROUP_SIZE) {
    const batch = customerIds.slice(i, i + OPEN_CLAIM_GROUP_SIZE);
    const rows = await prisma.invoiceClaim.findMany({
      where: {
        customerId: { in: batch },
        ...demoWhere(filters),
        claimDate: { lte: asOfDateUtc },
        OR: [{ closedAt: null }, { closedAt: { gte: dayAfterAsOf } }],
      },
      select: { customerId: true },
    });
    for (const row of rows) counts.set(row.customerId, (counts.get(row.customerId) ?? 0) + 1);
  }
  return counts;
}

export type CustomerCommercialHealth = {
  periodFrom: string;
  periodTo: string;
  asOfDate: string;
  asOfDateSource: AsOfDateSource;
  claims: {
    raisedInPeriodCount: number;
    /** Calculated -- see this module's own top comment on the "open as of" approximation. */
    openAsOfReportingDateCount: number;
    /** All-time, current-state exposure by currency -- potential/approved/actual-credited, reused verbatim from lib/invoice-claims/financial.ts. Never period-scoped: exposure is a running state, not a flow, same treatment the whole-business M6A dashboard already gives it. */
    exposureByCurrency: CurrencyExposureBucket[];
  };
  returns: {
    inPeriodByCondition: { condition: string; count: number }[];
  };
  actualCreditNotes: {
    inPeriodByCurrency: { currency: string; total: string }[];
    /** Explicitly labelled cumulative -- all-time, never implied to be "this period's" figure. */
    allTimeCumulativeByCurrency: { currency: string; total: string }[];
    /** Credit notes with no creditNoteDate at all -- excluded from the in-period figure (can't be period-scoped), counted only in the all-time cumulative total, never silently dropped. */
    excludedFromPeriodNoDateCount: number;
  };
  delivery: {
    label: "Delivery outcomes — operational signal, not a commercial dispute.";
    rejectionsInPeriod: { outcome: "PARTIALLY_REJECTED" | "FULLY_REJECTED"; count: number }[];
  };
};

export async function getCustomerCommercialHealth(customerId: string, filters: ReportFilters): Promise<CustomerCommercialHealth> {
  const { effectiveFrom, effectiveTo } = resolveEffectiveDateRange(filters);
  const demo = demoWhere(filters);
  const periodDateRange = dateRangeToDateOnlyFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo });
  const { asOfDate, source: asOfDateSource } = resolveAsOfDate({ dateTo: filters.dateTo });
  const asOfDateUtc = dateOnlyStringToUtcDate(asOfDate)!;
  const dayAfterAsOf = new Date(asOfDateUtc);
  dayAfterAsOf.setUTCDate(dayAfterAsOf.getUTCDate() + 1);

  // --- Claims (primary evidence) ---
  const claims = await prisma.invoiceClaim.findMany({
    where: { customerId, ...demo },
    select: { id: true, claimDate: true, closedAt: true },
  });
  const claimIds = claims.map((c) => c.id);
  const raisedInPeriodCount = claims.filter((c) => {
    const d = c.claimDate;
    return (!periodDateRange.gte || d >= periodDateRange.gte) && (!periodDateRange.lte || d <= periodDateRange.lte);
  }).length;
  const openAsOfReportingDateCount = claims.filter((c) => c.claimDate <= asOfDateUtc && (c.closedAt === null || c.closedAt >= dayAfterAsOf)).length;
  const exposureByCurrency = claimIds.length > 0 ? await computeExposureByCurrency(claimIds) : [];

  // --- Physical returns (primary evidence), in period, by ReturnCondition ---
  const returns =
    claimIds.length > 0
      ? await prisma.claimReturn.findMany({
          where: { claimId: { in: claimIds }, ...demo, receivedDate: periodDateRange },
          select: { condition: true },
        })
      : [];
  const returnsByCondition = new Map<string, number>();
  for (const r of returns) returnsByCondition.set(r.condition, (returnsByCondition.get(r.condition) ?? 0) + 1);

  // --- Actual credit notes (primary evidence): the UNION of
  // claim-linked credit notes and directly-invoice-linked credit notes
  // with claimId: null -- closing the gap the whole-business, claim-
  // centric computeExposureByCurrency walk cannot see on its own (a
  // credit note imported straight against an invoice, with no claim at
  // all, per lib/returns-credits/plan-import.ts's own CSV-match path).
  // The two branches are mutually exclusive by construction (one
  // requires a linked claim whose customerId matches; the other
  // requires claimId: null), so this single query can never double-count
  // a credit note under both paths.
  const creditNotes = await prisma.creditNote.findMany({
    where: {
      ...demo,
      OR: [{ claim: { customerId } }, { claimId: null, sapInvoice: { matchedCustomerId: customerId } }],
    },
    select: { amount: true, currencyCode: true, creditNoteDate: true },
  });

  type CurrencyBucket = { inPeriod: string[]; allTime: string[] };
  const creditByCurrency = new Map<string, CurrencyBucket>();
  let excludedFromPeriodNoDateCount = 0;
  for (const note of creditNotes) {
    const currency = currencyKey(note.currencyCode);
    const bucket = creditByCurrency.get(currency) ?? { inPeriod: [], allTime: [] };
    const amount = note.amount.toString();
    bucket.allTime.push(amount);
    if (note.creditNoteDate === null) {
      excludedFromPeriodNoDateCount += 1;
    } else if ((!periodDateRange.gte || note.creditNoteDate >= periodDateRange.gte) && (!periodDateRange.lte || note.creditNoteDate <= periodDateRange.lte)) {
      bucket.inPeriod.push(amount);
    }
    creditByCurrency.set(currency, bucket);
  }
  const inPeriodByCurrency = [...creditByCurrency.entries()]
    .filter(([, b]) => b.inPeriod.length > 0)
    .map(([currency, b]) => ({ currency, total: formatScaledDecimal(sumDecimalStrings(b.inPeriod)) }));
  const allTimeCumulativeByCurrency = [...creditByCurrency.entries()].map(([currency, b]) => ({
    currency,
    total: b.allTime.length > 0 ? formatScaledDecimal(sumDecimalStrings(b.allTime)) : "0",
  }));

  // --- Delivery outcomes (SECONDARY, operational signal only) ---
  // DeliveryRecord -> DispatchRecord.orderId -> CustomerOrder.customerId.
  const deliveryRows = await prisma.deliveryRecord.findMany({
    where: {
      ...demo,
      outcome: { in: ["PARTIALLY_REJECTED", "FULLY_REJECTED"] },
      dispatchRecord: { order: { customerId } },
      recordedAt: dateRangeToTimestampFilter({ dateFrom: effectiveFrom, dateTo: effectiveTo }),
    },
    select: { outcome: true },
  });
  const rejectionsByOutcome = new Map<string, number>();
  for (const row of deliveryRows) rejectionsByOutcome.set(row.outcome, (rejectionsByOutcome.get(row.outcome) ?? 0) + 1);

  return {
    periodFrom: effectiveFrom,
    periodTo: effectiveTo,
    asOfDate,
    asOfDateSource,
    claims: { raisedInPeriodCount, openAsOfReportingDateCount, exposureByCurrency },
    returns: { inPeriodByCondition: [...returnsByCondition.entries()].map(([condition, count]) => ({ condition, count })) },
    actualCreditNotes: { inPeriodByCurrency, allTimeCumulativeByCurrency, excludedFromPeriodNoDateCount },
    delivery: {
      label: "Delivery outcomes — operational signal, not a commercial dispute.",
      rejectionsInPeriod: [...rejectionsByOutcome.entries()].map(([outcome, count]) => ({ outcome: outcome as "PARTIALLY_REJECTED" | "FULLY_REJECTED", count })),
    },
  };
}
