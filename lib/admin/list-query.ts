/**
 * Pure helpers shared by every admin list page and its data table: sort
 * parsing against an explicit allow-list (a client can never choose an
 * arbitrary column), query-string building, and date-range parsing.
 */
import { firstParam, readPaging } from "./paging";

export type SortDir = "asc" | "desc";
export type SortState = { key: string; dir: SortDir };
export type RawParams = Record<string, string | string[] | undefined>;

/** `?sort=total&dir=desc` -> a validated SortState. Unknown keys fall back to the default. */
export function parseSort(raw: RawParams, allowed: readonly string[], fallback: SortState): SortState {
  const key = firstParam(raw.sort);
  const dir = firstParam(raw.dir);
  return { key: key && allowed.includes(key) ? key : fallback.key, dir: dir === "asc" || dir === "desc" ? dir : key && allowed.includes(key) ? "asc" : fallback.dir };
}

/** Prisma orderBy from a sort state with a stable `id` tiebreaker so paging never repeats or skips rows. */
export function orderByFor<T extends string>(sort: SortState, map: Record<string, (dir: SortDir) => Record<string, unknown>>, fallbackKey: T): Record<string, unknown>[] {
  const build = map[sort.key] ?? map[fallbackKey];
  return [build(sort.dir), { id: sort.dir === "asc" ? "asc" : "desc" }];
}

/** Flattens Next's searchParams to single strings, dropping empties; keeps only the keys named (so unknown params never reach a query). */
export function pickParams(raw: RawParams, keys: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of keys) {
    const v = firstParam(raw[k]);
    if (v) out[k] = v;
  }
  return out;
}

export function buildQuery(params: Record<string, string | undefined>, overrides: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...overrides })) if (v) q.set(k, v);
  const s = q.toString();
  return s ? `?${s}` : "";
}

export function pagingFrom(raw: RawParams) {
  return readPaging({ page: firstParam(raw.page), pageSize: firstParam(raw.pageSize) });
}

export function totalPagesFor(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `from`/`to` (YYYY-MM-DD) -> [inclusive start, exclusive end) in UTC; invalid or inverted input yields no bounds. */
export function parseDateRange(rawFrom?: string, rawTo?: string): { gte?: Date; lt?: Date } {
  const from = rawFrom && ISO_DAY.test(rawFrom) && !Number.isNaN(Date.parse(`${rawFrom}T00:00:00Z`)) ? new Date(`${rawFrom}T00:00:00.000Z`) : undefined;
  let to: Date | undefined;
  if (rawTo && ISO_DAY.test(rawTo) && !Number.isNaN(Date.parse(`${rawTo}T00:00:00Z`))) {
    to = new Date(`${rawTo}T00:00:00.000Z`);
    to.setUTCDate(to.getUTCDate() + 1);
  }
  if (from && to && to.getTime() <= from.getTime()) return {};
  return { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) };
}

/** The equally long window immediately before [from, to) -- used for "versus previous period" comparisons. */
export function previousWindow(range: { gte: Date; lt: Date }): { gte: Date; lt: Date } {
  const span = range.lt.getTime() - range.gte.getTime();
  return { gte: new Date(range.gte.getTime() - span), lt: new Date(range.gte.getTime()) };
}

export type PresetKey = "7d" | "30d" | "90d" | "mtd" | "ytd";
export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "7d", label: "Last 7 days" }, { key: "30d", label: "Last 30 days" }, { key: "90d", label: "Last 90 days" }, { key: "mtd", label: "Month to date" }, { key: "ytd", label: "Year to date" },
];

/** A preset resolved against `now` into a [gte, lt) window ending at the end of today (UTC). */
export function resolvePreset(preset: string | undefined, now: Date): { key: PresetKey; gte: Date; lt: Date } {
  const key = (PRESETS.find((p) => p.key === preset)?.key ?? "30d") as PresetKey;
  const lt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const day = 24 * 60 * 60 * 1000;
  const gte =
    key === "7d" ? new Date(lt.getTime() - 7 * day) :
    key === "30d" ? new Date(lt.getTime() - 30 * day) :
    key === "90d" ? new Date(lt.getTime() - 90 * day) :
    key === "mtd" ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) :
    new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  return { key, gte, lt };
}

/** The instant `days` days from now (negative = in the past). Kept as a helper so server pages do not call Date.now() inline during render. */
export const daysFromNow = (days: number): Date => new Date(Date.now() + days * 86_400_000);
