import { dateOnlyStringToUtcDate, utcDateToDateOnlyString, isValidDateOnlyString } from "@/lib/dates";

/**
 * Milestone 14 (Product Intelligence). Pure relative-ranking logic for
 * the management Product Intelligence overview, plus the pure period-
 * comparison date arithmetic spec section 6 requires ("compare the
 * selected period with the immediately preceding period of equal
 * duration").
 *
 * Per the same explicit business decision Milestone 13 already made for
 * customers (reused here, never re-litigated): NO fixed thresholds, NO
 * percentile segmentation, NO composite score/tier. The overview ranks
 * products independently along each dimension named in spec section 4.B
 * -- never merged into one number (spec: "never combine these into one
 * composite score... never invent product tiers").
 *
 * rankByValue here is DELIBERATELY NOT a reuse of
 * lib/reporting/customer-segmentation.ts's own rankByValue: that
 * function's Rankable type hardcodes a `customerId` field name (used for
 * its own tie-break), so forcing product rows through it would mean
 * relabelling `sapItemCode` as `customerId` purely to satisfy an
 * unrelated field name -- more confusing than this small, honestly
 * product-keyed duplicate of the same ~10-line algorithm. The RANKING
 * RULE itself (sequential 1-based rank, ties broken deterministically,
 * no composite score) is identical and intentionally kept identical.
 */

export type Rankable = { sapItemCode: string; value: number };
export type Ranked<T extends Rankable> = T & { rank: number };

export type RankDirection =
  /** Higher value = rank 1 (used for SAP invoice line value, invoiced quantity, invoice frequency, distinct customer count, lost-sales activity, claim/return activity, credit-note value, delivery rejection quantity). */
  | "descending"
  /** Lower value = rank 1 -- reserved for any future recency-style product dimension; no current M14 ranking uses this direction, but the type is kept symmetrical with lib/reporting/customer-segmentation.ts's own RankDirection rather than narrowed to one literal. */
  | "ascending";

/**
 * Sequential 1-based ranking (1, 2, 3, ... -- never a shared/"competition"
 * rank for ties), with ties broken deterministically by sapItemCode so
 * the same input always produces the same output regardless of fetch
 * order. Every product's rank is traceable to one real, displayed
 * number (its own value), never a derived/weighted score.
 */
export function rankByValue<T extends Rankable>(items: readonly T[], direction: RankDirection): Ranked<T>[] {
  const sorted = [...items].sort((a, b) => {
    const diff = direction === "descending" ? b.value - a.value : a.value - b.value;
    if (diff !== 0) return diff;
    return a.sapItemCode.localeCompare(b.sapItemCode);
  });
  return sorted.map((item, index) => ({ ...item, rank: index + 1 }));
}

export type PreviousPeriod = { previousFrom: string; previousTo: string };

/**
 * The immediately preceding period of EQUAL DURATION (spec section 6,
 * for "products with declining invoice activity vs. the previous
 * comparable period"). Both the current period's dateFrom/dateTo are
 * inclusive calendar-day bounds (this project's existing convention --
 * see lib/reporting/filters.ts's dateRangeToDateOnlyFilter); the
 * previous period is the same inclusive-day COUNT, ending the day before
 * the current period starts, with no gap and no overlap:
 *
 *   current:  [dateFrom .......... dateTo]        (N days inclusive)
 *   previous: [previousFrom .. previousTo]         (same N days)
 *                                 previousTo = dateFrom - 1 day
 *
 * Returns null (never throws, never silently defaults) for an invalid
 * date-only string -- every caller already has a validated ReportFilters
 * range by the time this is called, but a pure date-math helper intended
 * for direct unit testing should never throw on a malformed literal.
 */
export function computePreviousPeriod(dateFrom: string, dateTo: string): PreviousPeriod | null {
  if (!isValidDateOnlyString(dateFrom) || !isValidDateOnlyString(dateTo)) return null;
  const from = dateOnlyStringToUtcDate(dateFrom)!;
  const to = dateOnlyStringToUtcDate(dateTo)!;
  if (from.getTime() > to.getTime()) return null;

  const durationDays = Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  const previousTo = new Date(from);
  previousTo.setUTCDate(previousTo.getUTCDate() - 1);

  const previousFrom = new Date(previousTo);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - (durationDays - 1));

  return {
    previousFrom: utcDateToDateOnlyString(previousFrom)!,
    previousTo: utcDateToDateOnlyString(previousTo)!,
  };
}
