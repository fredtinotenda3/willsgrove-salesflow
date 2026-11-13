import { isValidDateOnlyString, dateOnlyStringToUtcDate } from "@/lib/dates";

/**
 * Milestone 13 (Customer Intelligence). Pure as-of-date resolution and
 * recency arithmetic -- the piece of the Customer 360 / overview spec
 * that replaces an earlier, rejected design where "days since last
 * purchase" was always computed against today's date, which would have
 * made a historical report non-reproducible (re-running it next week
 * would silently change its own past numbers).
 *
 * The as-of-date rule, exactly as specified:
 *   - A historical report (an explicit dateTo was selected): asOfDate =
 *     that dateTo. Re-running the same report later with the same
 *     dateTo must return the same recency figures, provided the
 *     underlying SapInvoice records themselves haven't changed.
 *   - A live Customer 360 profile with no historical dateTo selected:
 *     asOfDate = the CURRENT business date in Africa/Harare, never the
 *     server's own UTC calendar date -- a server running in another
 *     timezone (or simply past UTC midnight while Harare is still the
 *     previous day, since Harare is UTC+2) must not silently shift
 *     which calendar day "today" means for this business.
 *
 * All dates in this module are "YYYY-MM-DD" strings (never Date
 * objects with an implied timezone) -- lib/dates.ts's own
 * isValidDateOnlyString/dateOnlyStringToUtcDate are reused for the one
 * place a real Date is needed (day-difference arithmetic), never
 * reimplemented.
 */

export type AsOfDateSource = "selected-date-to" | "live-business-date";

export type ResolvedAsOfDate = {
  asOfDate: string;
  source: AsOfDateSource;
};

/**
 * Resolves the current business date for this business in Africa/Harare,
 * via the IANA tz database (Intl.DateTimeFormat) rather than a hardcoded
 * UTC+2 offset -- Zimbabwe currently observes no daylight saving, but
 * resolving it through the real tz database is still the correct,
 * self-documenting choice rather than assuming that never changes.
 * `now` is injectable (defaults to the real clock) purely so this is
 * testable without mocking global Date.
 */
export function currentBusinessDateInHarare(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Harare",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

/**
 * The single as-of-date resolution rule used by both the Customer 360
 * profile and the management overview. `dateTo` is the caller's already-
 * resolved ReportFilters.dateTo (null means "no explicit historical
 * period was selected").
 */
export function resolveAsOfDate(input: { dateTo: string | null }, now: Date = new Date()): ResolvedAsOfDate {
  if (input.dateTo) {
    return { asOfDate: input.dateTo, source: "selected-date-to" };
  }
  return { asOfDate: currentBusinessDateInHarare(now), source: "live-business-date" };
}

/**
 * Whole-day difference between two "YYYY-MM-DD" strings, computed via
 * UTC-midnight Date arithmetic (dateOnlyStringToUtcDate) so neither
 * string's "day" can be shifted by a local timezone offset. Returns
 * null, rather than throwing, for an invalid date-only string -- a
 * caller is expected to have validated both strings already (every
 * caller in this module gets them from either a parsed ReportFilters or
 * a query result, both already guaranteed valid), but a date-math
 * helper intended for direct unit testing should never throw on a
 * malformed literal typed into a test case.
 */
function daysBetween(fromDateOnly: string, toDateOnly: string): number | null {
  if (!isValidDateOnlyString(fromDateOnly) || !isValidDateOnlyString(toDateOnly)) return null;
  const from = dateOnlyStringToUtcDate(fromDateOnly)!;
  const to = dateOnlyStringToUtcDate(toDateOnly)!;
  return Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Days since the last qualifying invoice, as of `asOfDate`.
 * `lastQualifyingInvoiceDateAsOf` must already be bounded by asOfDate
 * at the query layer (MAX(invoiceDate) WHERE invoiceDate <= asOfDate) --
 * this function performs no bounding of its own, only the subtraction.
 * Returns null -- rendered as "no qualifying invoice on record," never
 * 0 -- when the customer has no qualifying invoice at or before
 * asOfDate at all.
 */
export function computeDaysSinceLastQualifyingInvoice(asOfDate: string, lastQualifyingInvoiceDateAsOf: string | null): number | null {
  if (lastQualifyingInvoiceDateAsOf === null) return null;
  return daysBetween(lastQualifyingInvoiceDateAsOf, asOfDate);
}

export type InterPurchaseInterval = { status: "ok"; averageDays: number } | { status: "insufficient_data" };

/**
 * Average gap, in days, between consecutive qualifying-invoice dates
 * WITHIN the selected period -- fewer than two usable dates reports
 * "insufficient data" explicitly, never 0 (0 is a real, meaningful
 * answer reserved for two invoices that genuinely share the same
 * date -- a legitimate same-day repeat purchase, not a data defect).
 * `datesWithinPeriod` need not be pre-sorted or de-duplicated; this
 * function sorts (duplicates are kept -- two invoices on the same date
 * correctly contribute a 0-day gap between them).
 */
export function computeAverageInterPurchaseInterval(datesWithinPeriod: readonly string[]): InterPurchaseInterval {
  const sorted = [...datesWithinPeriod].sort();
  if (sorted.length < 2) return { status: "insufficient_data" };

  let totalGapDays = 0;
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = daysBetween(sorted[i - 1], sorted[i]);
    totalGapDays += gap ?? 0;
  }
  return { status: "ok", averageDays: totalGapDays / (sorted.length - 1) };
}
