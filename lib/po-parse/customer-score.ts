/** Pure customer-name scoring (no DB) so it can be unit-tested. */
import { normalizeMatchText } from "@/lib/matching/normalize";

const CUSTOMER_STOP = new Set(["the", "and", "t/a", "ta", "pvt", "ltd", "limited", "co", "company", "inc", "cc", "of", "store", "branch"]);

export function customerTokens(text: string): string[] {
  return normalizeMatchText(text.replace(/[-/&]/g, " "))
    .split(" ")
    .filter((t) => t.length > 1 && !/^\d+$/.test(t) && !CUSTOMER_STOP.has(t))
    .map((t) => (t.length > 4 && t.endsWith("s") ? t.slice(0, -1) : t));
}

export function scoreCustomerName(query: string, candidateName: string): number {
  const q = customerTokens(query);
  const c = customerTokens(candidateName);
  if (q.length === 0 || c.length === 0) return 0;
  const cSet = new Set(c);
  const covered = q.filter((t) => cSet.has(t)).length;
  const coverage = covered / q.length;
  if (coverage === 0) return 0;
  const reverse = new Set(q);
  const precision = c.filter((t) => reverse.has(t)).length / c.length;
  return Math.min(1, coverage * 0.7 + precision * 0.3);
}

