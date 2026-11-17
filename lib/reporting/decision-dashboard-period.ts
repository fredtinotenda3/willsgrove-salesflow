import type { ReportFilters } from "@/lib/reporting/types";
import { utcDateToDateOnlyString } from "@/lib/dates";

/**
 * Final completion phase, section 3 (decision-support dashboard rebuild).
 * Pure, DB-free helpers split out of lib/reporting/decision-dashboard.ts
 * for exactly the same reason lib/lost-sales/analytics-validation.ts is
 * split from lib/lost-sales/analytics-queries.ts: everything here is a
 * plain function of its inputs with no Prisma import, so it is
 * independently unit-testable (tests/decision-dashboard.test.ts) without
 * a database or a generated Prisma client -- unlike every OTHER
 * lib/reporting/*.ts composition file (operational-dashboard.ts,
 * sales-pipeline.ts, fulfilment-intelligence.ts, financial-exposure.ts),
 * which import "server-only"+prisma directly and have no such split,
 * because none of their business logic is this cleanly separable from
 * the database query that feeds it. The period-comparison math here
 * genuinely is.
 */

/** Percent change from `prior` to `current`, to one decimal place. Returns null (never Infinity/NaN) for a change off a zero base -- there is no meaningful percent change to report there. */
export function deltaPercent(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? 0 : null;
  return Math.round(((current - prior) / prior) * 1000) / 10;
}

export type ComparisonRanges = {
  current: { dateFrom: string; dateTo: string };
  prior: { dateFrom: string; dateTo: string };
  periodLabel: string;
};

/**
 * Current period = the caller's own filters.dateFrom/dateTo when given
 * (so the dashboard's own date-range control, same filter bar every
 * other /reports page uses, genuinely changes what's compared); when no
 * range is given, defaults to the trailing 7 UTC calendar days (a week
 * being the smallest period a "period comparison" reads as meaningful
 * for a daily-operations business, as opposed to
 * lib/reporting/filters.ts's defaultDateRange()'s 30-day default used by
 * the unbounded report pages). Prior period = the immediately preceding
 * period of the exact same length -- never a mismatched-length or
 * overlapping comparison.
 */
export function resolveComparisonRanges(filters: Pick<ReportFilters, "dateFrom" | "dateTo">): ComparisonRanges {
  const today = new Date();
  const toDate = filters.dateTo ? new Date(`${filters.dateTo}T00:00:00.000Z`) : today;
  const fromDate = filters.dateFrom ? new Date(`${filters.dateFrom}T00:00:00.000Z`) : new Date(toDate.getTime() - 6 * 24 * 60 * 60 * 1000);

  const spanMs = toDate.getTime() - fromDate.getTime();
  const priorTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
  const priorFrom = new Date(priorTo.getTime() - spanMs);

  const dayCount = Math.round(spanMs / (24 * 60 * 60 * 1000)) + 1;

  return {
    current: { dateFrom: utcDateToDateOnlyString(fromDate)!, dateTo: utcDateToDateOnlyString(toDate)! },
    prior: { dateFrom: utcDateToDateOnlyString(priorFrom)!, dateTo: utcDateToDateOnlyString(priorTo)! },
    periodLabel: `vs. previous ${dayCount} day${dayCount === 1 ? "" : "s"}`,
  };
}
