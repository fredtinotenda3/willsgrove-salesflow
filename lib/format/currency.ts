/**
 * Single money formatter for every screen, report, export and message.
 *
 *   USD  -> "$1,234.50"        (every USD amount carries the $ sign)
 *   other -> "ZWG 1,234.50"    (a non-USD currency is never mislabelled as dollars)
 *
 * Pure and client-safe. Accepts the decimal strings Prisma returns, so no precision is lost to
 * Number() for the integer part; the fraction is rounded half-up to `fractionDigits`.
 * Returns "—" for null/undefined/non-numeric input (never "$0.00" for a missing value).
 */
export function currencySymbolPrefix(currency: string | null | undefined): string {
  const code = (currency ?? "USD").trim().toUpperCase();
  return code === "" || code === "USD" ? "$" : `${code} `;
}

export function formatCurrencyAmount(
  currency: string | null | undefined,
  amount: string | number | { toString(): string } | null | undefined,
  fractionDigits = 2
): string {
  if (amount === null || amount === undefined) return "—";
  const raw = amount.toString().trim();
  if (!/^-?\d+(\.\d+)?$/.test(raw)) return "—";
  const negative = raw.startsWith("-");
  const [intPart, fracPart = ""] = raw.replace("-", "").split(".");
  const scale = BigInt(10) ** BigInt(fractionDigits);
  let units = BigInt(intPart) * scale;
  if (fractionDigits > 0) {
    const padded = (fracPart + "0".repeat(fractionDigits + 1)).slice(0, fractionDigits + 1);
    units += BigInt(padded.slice(0, fractionDigits));
    if (Number(padded[fractionDigits]) >= 5) units += BigInt(1);
  } else if (fracPart && Number(fracPart[0]) >= 5) {
    units += BigInt(1);
  }
  const whole = (units / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = fractionDigits > 0 ? `.${(units % scale).toString().padStart(fractionDigits, "0")}` : "";
  const isZero = units === BigInt(0);
  return `${negative && !isZero ? "-" : ""}${currencySymbolPrefix(currency)}${whole}${frac}`;
}
