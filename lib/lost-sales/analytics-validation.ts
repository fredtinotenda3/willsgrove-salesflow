/**
 * Additional Implementation Requirements (spec section 3: "Lost Sales
 * Analytics Overhaul"). Pure, DB-free helpers for the analytics module --
 * same split as lib/lost-sales/validation.ts (pure) vs.
 * lib/lost-sales/queries.ts (Prisma-backed): everything here is a plain
 * function of its inputs, independently unit-testable with no database.
 */
export const lostSalesAnalyticsPeriodValues = ["day", "week", "month"] as const;
export type LostSalesAnalyticsPeriod = (typeof lostSalesAnalyticsPeriodValues)[number];

/**
 * Spec section 3: histograms/box plots/percentiles are required "where
 * sample size is sufficient" -- the spec's own qualifier, not a free
 * choice. Below this many data points, a percentile or histogram bucket
 * is not a meaningful statistic (a handful of points can make any shape
 * look however you draw it) and the UI must say so rather than render a
 * misleading chart from too little data (spec section 3's own "avoid
 * misleading analytics" warning).
 */
export const MIN_SAMPLE_SIZE_FOR_DISTRIBUTION = 20;

/**
 * Buckets a UTC instant into its period key -- "YYYY-MM-DD" for day,
 * the Monday-starting ISO week's own "YYYY-MM-DD" for week, "YYYY-MM"
 * for month. Always computed in UTC (same discipline as
 * lib/dates.ts's own comment on why) so the same createdAt timestamp
 * buckets identically regardless of the server's or browser's local
 * offset.
 */
export function bucketKeyForDate(date: Date, period: LostSalesAnalyticsPeriod): string {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();

  if (period === "month") {
    return `${year}-${String(month + 1).padStart(2, "0")}`;
  }

  if (period === "day") {
    return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  // week: Monday-starting ISO week. getUTCDay() is 0 (Sun) .. 6 (Sat);
  // convert to a Monday-first offset so Sunday is treated as day 6 of the
  // PRECEDING Monday's week, not the start of a new one.
  const dayOfWeek = date.getUTCDay();
  const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const monday = new Date(Date.UTC(year, month, day - mondayOffset));
  return monday.toISOString().slice(0, 10);
}

/**
 * A human label for a bucket key produced by bucketKeyForDate -- kept
 * next to it so the two never drift out of sync with each other's
 * format.
 */
export function bucketLabelForKey(key: string, period: LostSalesAnalyticsPeriod): string {
  if (period === "month") {
    const [year, month] = key.split("-");
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
    return date.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
  }
  const date = new Date(`${key}T00:00:00.000Z`);
  if (period === "week") {
    return `Week of ${date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" })}`;
  }
  return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

/**
 * Spec section 3's required filter dimensions: "customer, product,
 * order, date range, loss reason, customer decision, status, time
 * period, salesperson." ("order" is handled by the drilldown table's own
 * search, not a top-level filter -- there is no sensible chart sliced by
 * a single order.) Every dimension except "time period" reuses
 * lib/reporting/types.ts's shared ReportFilters type and
 * lib/reporting/filters.ts's parseReportFilters -- the same centrally
 * validated date-range/customer/product/salesperson/enum parsing every
 * other /reports/* page already uses (that module now validates
 * unfulfilledDemandStatus/customerDecisionType too, added specifically
 * for this page -- see its own comment). "Time period" (day/week/month
 * trend-bucketing granularity) is NOT a row filter -- it never changes
 * which rows are in scope, only how they're grouped for the trend chart
 * -- so it is parsed here, as its own small, local, page-specific query
 * param, the same way `page`/`pageSize` live in their own
 * PaginationParams rather than inside ReportFilters.
 */
export function parseLostSalesAnalyticsPeriod(raw: string | null): LostSalesAnalyticsPeriod {
  if (raw && (lostSalesAnalyticsPeriodValues as readonly string[]).includes(raw)) {
    return raw as LostSalesAnalyticsPeriod;
  }
  return "month";
}

/**
 * Nearest-rank percentile over an ALREADY-SORTED-ASCENDING array of
 * numbers (sorting is the caller's job, so this stays O(1) rather than
 * re-sorting on every call when several percentiles are needed from the
 * same sample). Returns null for an empty sample rather than NaN/0 --
 * same "never invent a figure" discipline as
 * lib/lost-sales/estimate-value.ts. `p` is 0-100.
 */
export function percentileOfSorted(sortedAscending: number[], p: number): number | null {
  if (sortedAscending.length === 0) return null;
  if (p <= 0) return sortedAscending[0];
  if (p >= 100) return sortedAscending[sortedAscending.length - 1];
  const rank = (p / 100) * (sortedAscending.length - 1);
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  if (lowerIndex === upperIndex) return sortedAscending[lowerIndex];
  const weight = rank - lowerIndex;
  return sortedAscending[lowerIndex] * (1 - weight) + sortedAscending[upperIndex] * weight;
}

/**
 * Shortage rate = Unavailable / Requested, as a 0-1 fraction -- null
 * (never 0 or Infinity) when requested is zero, since a zero-requested
 * line has no meaningful rate (spec section 3's "avoid misleading
 * analytics... no misleading axes").
 */
export function computeShortageRate(unavailableQuantity: number, requestedQuantity: number): number | null {
  if (requestedQuantity <= 0) return null;
  return unavailableQuantity / requestedQuantity;
}

/**
 * Even-width histogram over an already-sorted-ascending numeric sample.
 * Returns null (rather than a near-empty/misleading chart) below
 * MIN_SAMPLE_SIZE_FOR_DISTRIBUTION or when every value is identical (no
 * meaningful width to bucket). `bucketCount` defaults to a sane, fixed
 * value rather than being derived from the sample size, so bucket width
 * does not quietly change shape as more data arrives.
 */
export function buildHistogram(
  sortedAscending: number[],
  bucketCount = 10
): { bucketStart: number; bucketEnd: number; count: number }[] | null {
  if (sortedAscending.length < MIN_SAMPLE_SIZE_FOR_DISTRIBUTION) return null;
  const min = sortedAscending[0];
  const max = sortedAscending[sortedAscending.length - 1];
  if (max <= min) return null;

  const width = (max - min) / bucketCount;
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    bucketStart: min + index * width,
    bucketEnd: min + (index + 1) * width,
    count: 0,
  }));

  for (const value of sortedAscending) {
    const index = Math.min(bucketCount - 1, Math.floor((value - min) / width));
    buckets[index].count += 1;
  }

  return buckets;
}
