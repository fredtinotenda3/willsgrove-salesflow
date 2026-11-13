/**
 * Milestone 13 (Customer Intelligence). Pure relative-ranking logic for
 * the management customer-intelligence overview.
 *
 * Per the explicit business decision for this milestone: NO fixed
 * financial thresholds, NO percentile segmentation, NO stored customer
 * segment field, and NO single composite score/tier. The overview ranks
 * customers independently along each of three dimensions -- SAP invoice
 * line value (within one currency), purchase frequency, and days since
 * last qualifying invoice -- and never merges them into one number.
 * Percentile-based segmentation was explicitly deferred out of this
 * milestone; this module intentionally does not implement it.
 *
 * Currency separation is NOT this module's job: ranking "SAP invoice
 * line value" across customers who transact in different currencies
 * would be meaningless (a USD customer must never be ranked against a
 * ZWG customer). The CALLER (the queries layer) is responsible for
 * grouping customers by currency first and calling rankByValue once per
 * currency group -- this module stays generic and reusable for every
 * ranking dimension, including the two (frequency, recency) that have
 * no currency at all.
 */

export type Rankable = { customerId: string; value: number };
export type Ranked<T extends Rankable> = T & { rank: number };

export type RankDirection =
  /** Higher value = rank 1 (used for SAP invoice line value, purchase frequency). */
  | "descending"
  /** Lower value = rank 1 (used for days since last qualifying invoice -- the most RECENT customer is rank 1). */
  | "ascending";

/**
 * Sequential 1-based ranking (1, 2, 3, ... -- never a shared/"competition"
 * rank for ties), with ties broken deterministically by customerId so
 * the same input always produces the same output regardless of fetch
 * order. Deliberately simple and fully explainable: every customer's
 * rank is traceable to one real, displayed number (their own value),
 * never a derived/weighted score.
 */
export function rankByValue<T extends Rankable>(items: readonly T[], direction: RankDirection): Ranked<T>[] {
  const sorted = [...items].sort((a, b) => {
    const diff = direction === "descending" ? b.value - a.value : a.value - b.value;
    if (diff !== 0) return diff;
    return a.customerId.localeCompare(b.customerId);
  });
  return sorted.map((item, index) => ({ ...item, rank: index + 1 }));
}
