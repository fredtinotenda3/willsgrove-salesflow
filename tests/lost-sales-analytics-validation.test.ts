import { describe, it, expect } from "vitest";
import {
  bucketKeyForDate,
  bucketLabelForKey,
  buildHistogram,
  computeShortageRate,
  MIN_SAMPLE_SIZE_FOR_DISTRIBUTION,
  parseLostSalesAnalyticsPeriod,
  percentileOfSorted,
} from "@/lib/lost-sales/analytics-validation";

/**
 * Additional Implementation Requirements (spec section 3: "Lost Sales
 * Analytics Overhaul" / spec section 14's testing requirements). Pure,
 * unconditional unit tests -- no @prisma/client import anywhere in
 * lib/lost-sales/analytics-validation.ts, so these run in every
 * environment, same convention as tests/lost-sales-validation.test.ts.
 */

describe("bucketKeyForDate", () => {
  it("buckets by day using the UTC calendar date", () => {
    expect(bucketKeyForDate(new Date("2026-03-15T23:59:00.000Z"), "day")).toBe("2026-03-15");
    expect(bucketKeyForDate(new Date("2026-03-15T00:00:01.000Z"), "day")).toBe("2026-03-15");
  });

  it("buckets by month using the UTC calendar month", () => {
    expect(bucketKeyForDate(new Date("2026-03-01T00:00:00.000Z"), "month")).toBe("2026-03");
    expect(bucketKeyForDate(new Date("2026-03-31T23:59:59.000Z"), "month")).toBe("2026-03");
  });

  it("buckets by week to the Monday that starts the ISO week", () => {
    // 2026-03-18 is a Wednesday; its week starts Monday 2026-03-16.
    expect(bucketKeyForDate(new Date("2026-03-18T12:00:00.000Z"), "week")).toBe("2026-03-16");
    // A Monday buckets to itself.
    expect(bucketKeyForDate(new Date("2026-03-16T00:00:00.000Z"), "week")).toBe("2026-03-16");
    // A Sunday belongs to the PRECEDING Monday's week, not a new one.
    expect(bucketKeyForDate(new Date("2026-03-22T23:00:00.000Z"), "week")).toBe("2026-03-16");
  });
});

describe("bucketLabelForKey", () => {
  it("formats each period shape as a readable label", () => {
    expect(bucketLabelForKey("2026-03", "month")).toContain("2026");
    expect(bucketLabelForKey("2026-03-16", "week")).toContain("Week of");
    expect(bucketLabelForKey("2026-03-16", "day")).toContain("2026");
  });
});

describe("parseLostSalesAnalyticsPeriod", () => {
  it("accepts a valid period and defaults to month otherwise", () => {
    expect(parseLostSalesAnalyticsPeriod("day")).toBe("day");
    expect(parseLostSalesAnalyticsPeriod("week")).toBe("week");
    expect(parseLostSalesAnalyticsPeriod("month")).toBe("month");
    expect(parseLostSalesAnalyticsPeriod(null)).toBe("month");
    expect(parseLostSalesAnalyticsPeriod("not-a-period")).toBe("month");
  });
});

describe("computeShortageRate", () => {
  it("computes unavailable/requested as a 0-1 fraction", () => {
    expect(computeShortageRate(40, 100)).toBeCloseTo(0.4);
    expect(computeShortageRate(0, 100)).toBe(0);
    expect(computeShortageRate(100, 100)).toBe(1);
  });

  it("returns null rather than Infinity/NaN when requested is zero", () => {
    expect(computeShortageRate(5, 0)).toBeNull();
    expect(computeShortageRate(0, 0)).toBeNull();
  });
});

describe("percentileOfSorted", () => {
  it("returns null for an empty sample", () => {
    expect(percentileOfSorted([], 50)).toBeNull();
  });

  it("returns the single value for a one-element sample at any percentile", () => {
    expect(percentileOfSorted([7], 25)).toBe(7);
    expect(percentileOfSorted([7], 90)).toBe(7);
  });

  it("computes the median and extremes of a known sample", () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentileOfSorted(sorted, 0)).toBe(1);
    expect(percentileOfSorted(sorted, 100)).toBe(10);
    expect(percentileOfSorted(sorted, 50)).toBeCloseTo(5.5);
  });
});

describe("buildHistogram", () => {
  it("returns null below the minimum sample size", () => {
    const small = Array.from({ length: MIN_SAMPLE_SIZE_FOR_DISTRIBUTION - 1 }, (_, i) => i);
    expect(buildHistogram(small)).toBeNull();
  });

  it("returns null when every value is identical (no width to bucket)", () => {
    const flat = Array.from({ length: MIN_SAMPLE_SIZE_FOR_DISTRIBUTION + 5 }, () => 10);
    expect(buildHistogram(flat)).toBeNull();
  });

  it("buckets a sufficient sample into the requested number of even-width buckets, accounting for every value", () => {
    const sample = Array.from({ length: 50 }, (_, i) => i); // 0..49
    const histogram = buildHistogram(sample, 5);
    expect(histogram).not.toBeNull();
    expect(histogram).toHaveLength(5);
    const totalCount = histogram!.reduce((sum, bucket) => sum + bucket.count, 0);
    expect(totalCount).toBe(sample.length);
    expect(histogram![0].bucketStart).toBe(0);
    expect(histogram![4].bucketEnd).toBe(49);
  });
});
