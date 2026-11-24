/**
 * Weekly / monthly management pack: period resolution. Pure and DB-free.
 *
 * Weeks are ISO-style calendar weeks (Monday to Sunday, UTC); months are
 * calendar months (UTC). The prior period is the immediately preceding
 * calendar week / month, so comparisons are like-for-like by construction.
 * (The generic dashboard's "previous N days" comparison differs: it slides
 * a window of equal length. A calendar period is what a management pack is
 * expected to report on.)
 *
 * A period that has not finished yet (the current week/month) is returned
 * with `isComplete: false` so the pack can say "to date" instead of
 * presenting a part-period as a full one.
 */
export type PackPeriodKind = "week" | "month";

export type PackPeriod = {
  kind: PackPeriodKind;
  dateFrom: string;
  dateTo: string;
  label: string;
  isComplete: boolean;
  prior: { dateFrom: string; dateTo: string; label: string };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || iso(date) !== value ? null : date;
}

function mondayOf(date: Date): Date {
  const day = date.getUTCDay(); // 0 = Sunday
  const offset = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset));
}

function weekLabel(from: Date, to: Date): string {
  const f = `${from.getUTCDate()} ${MONTHS[from.getUTCMonth()]}`;
  const t = `${to.getUTCDate()} ${MONTHS[to.getUTCMonth()]} ${to.getUTCFullYear()}`;
  return `Week ${f} - ${t}`;
}

function monthLabel(from: Date): string {
  return `${FULL_MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}`;
}

/**
 * @param anchor  any date inside the wanted period (YYYY-MM-DD), or for
 *                months also YYYY-MM. Omitted/invalid -> `now`'s period.
 * @param now     injectable for tests.
 */
export function resolvePackPeriod(kind: PackPeriodKind, anchor?: string | null, now: Date = new Date()): PackPeriod {
  let anchorDate: Date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (anchor) {
    const parsed = parseDateOnly(anchor) ?? (kind === "month" && /^\d{4}-\d{2}$/.test(anchor) ? parseDateOnly(`${anchor}-01`) : null);
    if (parsed) anchorDate = parsed;
  }
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  let from: Date;
  let to: Date;
  let priorFrom: Date;
  let priorTo: Date;
  if (kind === "week") {
    from = mondayOf(anchorDate);
    to = new Date(from.getTime() + 6 * DAY_MS);
    priorFrom = new Date(from.getTime() - 7 * DAY_MS);
    priorTo = new Date(from.getTime() - DAY_MS);
  } else {
    from = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), 1));
    to = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth() + 1, 0));
    priorFrom = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - 1, 1));
    priorTo = new Date(from.getTime() - DAY_MS);
  }

  const isComplete = to.getTime() < today.getTime();
  return {
    kind,
    dateFrom: iso(from),
    dateTo: iso(to),
    label: kind === "week" ? weekLabel(from, to) : monthLabel(from),
    isComplete,
    prior: { dateFrom: iso(priorFrom), dateTo: iso(priorTo), label: kind === "week" ? weekLabel(priorFrom, priorTo) : monthLabel(priorFrom) },
  };
}

export function isPackPeriodKind(value: string | null | undefined): value is PackPeriodKind {
  return value === "week" || value === "month";
}

/** Anchor for the previous/next period, for the page's navigation links. */
export function shiftPackAnchor(period: PackPeriod, direction: -1 | 1): string {
  const from = new Date(`${period.dateFrom}T00:00:00.000Z`);
  if (period.kind === "week") return iso(new Date(from.getTime() + direction * 7 * DAY_MS));
  return iso(new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + direction, 1)));
}
