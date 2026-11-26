/** Pure display helpers for the administration UI (no React, no Prisma). Money is always shown from the stored decimal string; it is never recomputed. */

export const fmtDate = (d: Date | string | null | undefined): string => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "—" : date.toISOString().slice(0, 10);
};

export const fmtDateTime = (d: Date | string | null | undefined): string => {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "—" : `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;
};

export const humanize = (value: string | null | undefined): string => (value ? value.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : "—");

/** "$1,234.50" for USD ("ZWG 1,234.50" for other currencies) from a decimal string/number. Groups the integer part only; the fraction is kept exactly as stored (max 2 shown). */
export function fmtMoney(currency: string | null | undefined, amount: string | number | { toString(): string } | null | undefined): string {
  if (amount === null || amount === undefined) return "—";
  const raw = amount.toString();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return "—";
  const negative = raw.startsWith("-");
  const [int, frac = ""] = raw.replace("-", "").split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const cents = frac.padEnd(2, "0").slice(0, 2);
  const code = (currency ?? "USD").trim().toUpperCase();
  const prefix = code === "USD" || code === "" ? "$" : `${code} `;
  return `${negative ? "-" : ""}${prefix}${grouped}.${cents}`;
}

export const fmtInt = (n: number): string => n.toLocaleString("en-US");

/** Percentage change between two counts; null when the baseline is zero (a change from nothing is not a percentage). */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}
