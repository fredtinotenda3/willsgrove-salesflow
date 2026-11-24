/**
 * Shared, client-safe number formatting for KPI cards, charts, tooltips
 * and exports. One place so a dollar amount, a quantity and a percentage
 * look the same on every report. Pure (no imports) so it is usable from
 * server components, client components and unit tests alike.
 *
 * Money rule: USD renders with a "$" prefix; any other currency renders
 * with its ISO code ("ZWG 1,234.50") rather than a guessed symbol. Amounts
 * in different currencies are never combined here -- callers keep one
 * figure per currency.
 */

const EM_DASH = "—";

function toFiniteNumber(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function groupedFixed(abs: number, minFrac: number, maxFrac: number): string {
  return abs.toLocaleString("en-US", { minimumFractionDigits: minFrac, maximumFractionDigits: maxFrac });
}

export function currencyPrefix(currency: string | null | undefined): string {
  const code = (currency ?? "USD").toUpperCase();
  return code === "USD" ? "$" : `${code} `;
}

/** "$1,234.50", "-$12.00", "ZWG 1,234.50"; "—" for null/NaN. */
export function formatMoney(value: number | string | null | undefined, currency: string | null | undefined = "USD"): string {
  const n = toFiniteNumber(value);
  if (n === null) return EM_DASH;
  const sign = n < 0 ? "-" : "";
  return `${sign}${currencyPrefix(currency)}${groupedFixed(Math.abs(n), 2, 2)}`;
}

/** Axis-tick form: "$1.2K", "$3.4M", "$850". Never used for exact figures. */
export function formatCompactMoney(value: number | string | null | undefined, currency: string | null | undefined = "USD"): string {
  const n = toFiniteNumber(value);
  if (n === null) return EM_DASH;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const prefix = currencyPrefix(currency);
  if (abs >= 1_000_000) return `${sign}${prefix}${groupedFixed(abs / 1_000_000, 0, 1)}M`;
  if (abs >= 1_000) return `${sign}${prefix}${groupedFixed(abs / 1_000, 0, 1)}K`;
  return `${sign}${prefix}${groupedFixed(abs, 0, 0)}`;
}

/** "1,234.5 KG"; the unit is always shown when known so a quantity never floats free of what it counts. */
export function formatQuantity(value: number | string | null | undefined, unit?: string | null, maxFractionDigits = 2): string {
  const n = toFiniteNumber(value);
  if (n === null) return EM_DASH;
  const text = groupedFixed(n, 0, maxFractionDigits);
  return unit ? `${text} ${unit}` : text;
}

/** "12.3%"; "—" for null. The input is already a percentage (12.3), not a ratio. */
export function formatPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return `${value.toFixed(fractionDigits)}%`;
}

export function formatCount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return value.toLocaleString("en-US");
}

/**
 * Percentage change from `previous` to `current`. Null (never 0, never
 * Infinity) when there is no reliable baseline: a missing or zero
 * previous value makes a percentage meaningless and showing one would be
 * a fabricated trend.
 */
export function percentChange(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}
