import { firstParam as one } from "@/lib/admin/paging";
import { pagingFrom, parseDateRange, parseSort, pickParams, type RawParams, type SortState } from "@/lib/admin/list-query";

/**
 * Shared parsing for admin list pages. Everything the table needs is derived
 * from the URL: validated text filters, an allow-listed sort, paging and a
 * date window. `params` is exactly what must be carried by sort/page links.
 */
export function parseListParams(raw: RawParams, opts: { filterKeys: readonly string[]; sortKeys: readonly string[]; fallbackSort: SortState }) {
  const { page, pageSize } = pagingFrom(raw);
  const sort = parseSort(raw, opts.sortKeys, opts.fallbackSort);
  const range = parseDateRange(one(raw.from), one(raw.to));
  const params = pickParams(raw, [...opts.filterKeys, "from", "to", "sort", "dir", "pageSize"]);
  return { raw, q: one(raw.q)?.slice(0, 100), page, pageSize, sort, from: range.gte, to: range.lt, params, get: (k: string) => one(raw[k]) };
}

/** A plain GET form (works without JavaScript) that adds a date window to the current filters. */
export function DateRangeFilter({ action, params }: { action: string; params: Record<string, string | undefined> }) {
  const keep = Object.entries(params).filter(([k, v]) => v && k !== "from" && k !== "to" && k !== "page");
  const cls = "rounded-lg border border-[#DDE3DC] bg-white px-2.5 py-1.5 text-xs";
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {keep.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="flex items-center gap-1.5 text-xs text-[#5E6B63]">From <input type="date" name="from" defaultValue={params.from} className={cls} /></label>
      <label className="flex items-center gap-1.5 text-xs text-[#5E6B63]">To <input type="date" name="to" defaultValue={params.to} className={cls} /></label>
      <button className="rounded-lg border border-[#DDE3DC] bg-white px-3 py-1.5 text-xs font-semibold hover:bg-[#F7F8F6]">Apply</button>
      {params.from || params.to ? <a href={`${action}${keep.length ? `?${new URLSearchParams(keep as [string, string][])}` : ""}`} className="text-xs font-semibold text-[#1F7A4D]">Clear dates</a> : null}
    </form>
  );
}

export const opts = (values: readonly string[]) => values.map((v) => ({ value: v, label: v.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }));
