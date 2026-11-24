/**
 * Pure rules behind the KPI card system (components/kpi/*). No React, no
 * Prisma: everything a card must DECIDE (is this change good or bad? is
 * there enough data for a sparkline? which status band?) lives here so it
 * is unit-tested and so no card ever invents a trend, target or status.
 */

/** Which direction of change is good for the business. Revenue "up-good"; lost sales, open claims, exposure "down-good". */
export type KpiPolarity = "up-good" | "down-good" | "neutral";
export type KpiTone = "favourable" | "unfavourable" | "neutral";
export type KpiDirection = "up" | "down" | "flat";
export type KpiStatus = "healthy" | "warning" | "critical";

/** Changes smaller than this (in percentage points / percent) read as "flat" -- avoids red/green flicker on noise. */
export const FLAT_CHANGE_THRESHOLD = 0.05;

export function deltaDirection(change: number | null | undefined): KpiDirection | null {
  if (change === null || change === undefined || !Number.isFinite(change)) return null;
  if (Math.abs(change) < FLAT_CHANGE_THRESHOLD) return "flat";
  return change > 0 ? "up" : "down";
}

/** Business meaning of a change: a rise in lost sales is UNFAVOURABLE even though the arrow points up. */
export function deltaTone(change: number | null | undefined, polarity: KpiPolarity): KpiTone | null {
  const direction = deltaDirection(change);
  if (direction === null) return null;
  if (direction === "flat" || polarity === "neutral") return "neutral";
  const rising = direction === "up";
  return (rising && polarity === "up-good") || (!rising && polarity === "down-good") ? "favourable" : "unfavourable";
}

/** Screen-reader sentence for a delta, e.g. "Up 12.5% vs previous 7 days, unfavourable." */
export function describeDelta(change: number | null | undefined, polarity: KpiPolarity, comparisonLabel?: string): string | null {
  const direction = deltaDirection(change);
  const tone = deltaTone(change, polarity);
  if (direction === null || tone === null || change === null || change === undefined) return null;
  const size = `${Math.abs(change).toFixed(1)}%`;
  const move = direction === "flat" ? "Unchanged" : `${direction === "up" ? "Up" : "Down"} ${size}`;
  const judged = tone === "neutral" ? "" : `, ${tone}`;
  return `${move}${comparisonLabel ? ` ${comparisonLabel}` : ""}${judged}.`;
}

export type KpiThresholds = { warnAt: number; criticalAt: number; higherIsWorse: boolean };

/**
 * Status band from explicit, caller-supplied thresholds only. With no
 * thresholds (or no value) there is NO status -- the card shows none,
 * rather than defaulting to a reassuring "healthy".
 */
export function statusFromThresholds(value: number | null | undefined, thresholds: KpiThresholds | undefined): KpiStatus | null {
  if (value === null || value === undefined || !Number.isFinite(value) || !thresholds) return null;
  const { warnAt, criticalAt, higherIsWorse } = thresholds;
  if (higherIsWorse) {
    if (value >= criticalAt) return "critical";
    if (value >= warnAt) return "warning";
    return "healthy";
  }
  if (value <= criticalAt) return "critical";
  if (value <= warnAt) return "warning";
  return "healthy";
}

/** Progress toward a real target. Null when the target is missing or non-positive (no progress bar rather than a made-up one). `percent` is uncapped; `barPercent` is clamped for drawing. */
export function targetProgress(actual: number | null | undefined, target: number | null | undefined): { percent: number; barPercent: number; reached: boolean } | null {
  if (actual === null || actual === undefined || target === null || target === undefined) return null;
  if (!Number.isFinite(actual) || !Number.isFinite(target) || target <= 0) return null;
  const percent = (actual / target) * 100;
  return { percent, barPercent: Math.max(0, Math.min(100, percent)), reached: actual >= target };
}

/** A sparkline needs at least `minPoints` real values; fewer reads as a trend that does not exist, so none is drawn. Nulls/NaN are dropped, never zero-filled. */
export function usableSparkline(points: ReadonlyArray<number | null | undefined> | undefined, minPoints = 3): number[] | null {
  if (!points) return null;
  const clean = points.filter((p): p is number => typeof p === "number" && Number.isFinite(p));
  return clean.length >= minPoints ? clean : null;
}

export const KPI_STATUS_LABELS: Record<KpiStatus, string> = { healthy: "Healthy", warning: "Warning", critical: "Critical" };
