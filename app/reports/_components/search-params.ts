/**
 * Milestone 11 (Operational BI). Next's App Router hands a Server
 * Component page's `searchParams` as `Record<string, string | string[] |
 * undefined>` (a repeated query key like `?a=1&a=2` arrives as an
 * array). Every /reports/* page needs that as a flat `Record<string,
 * string>` to build a URLSearchParams for lib/reporting/filters.ts's
 * parseReportFilters, and as the same flat shape to hand back to
 * ReportFilterBar so its fields default to the current filter values --
 * one small, shared, correctly-typed conversion instead of five pages
 * each doing their own ad hoc cast.
 */
export type ReportSearchParams = Record<string, string | string[] | undefined>;

export function toFlatSearchParams(params: ReportSearchParams): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) flat[key] = first;
  }
  return flat;
}

export function toURLSearchParams(params: ReportSearchParams): URLSearchParams {
  return new URLSearchParams(toFlatSearchParams(params));
}

/** The filter values only, with any `page` dropped -- for a link that carries today's filters into a DIFFERENT report/page (e.g. a drill-down from fulfilment into the picking-shortages management report), where this page's own pagination position would be meaningless on the other side. */
export function filtersOnly(params: ReportSearchParams): Record<string, string> {
  const flat = toFlatSearchParams(params);
  delete flat.page;
  return flat;
}
