import { describe, expect, it } from "vitest";
import { deltaPercent, resolveComparisonRanges } from "@/lib/reporting/decision-dashboard-period";
import type { ReportFilters } from "@/lib/reporting/types";

/**
 * Final completion phase, section 3 (decision-support dashboard rebuild)
 * / section 15 ("tests for every new/changed rule"). Covers the two pure,
 * DB-free helpers lib/reporting/decision-dashboard-period.ts exports --
 * deltaPercent (the period-over-period comparison math) and
 * resolveComparisonRanges (the current-vs-prior-period window logic) --
 * which lib/reporting/decision-dashboard.ts (Prisma-backed, no unit test
 * possible without a real database/generated client) composes together
 * with the rest of the M11 reporting layer. Same pure/impure split this
 * codebase already uses throughout lib/lost-sales/ (e.g.
 * analytics-validation.ts vs. analytics-queries.ts).
 */

function emptyFilters(overrides: Partial<ReportFilters> = {}): ReportFilters {
  return {
    dateFrom: null,
    dateTo: null,
    customerId: null,
    productId: null,
    salespersonId: null,
    orderStatus: null,
    quotationStatus: null,
    fulfilmentStatus: null,
    claimStatus: null,
    communicationStatus: null,
    includeDemo: false,
    currency: null,
    lostSalesReason: null,
    productCategory: null,
    productSearch: null,
    sapItemCode: null,
    decisionCategory: null,
    priority: null,
    recommendationStatus: null,
    unfulfilledDemandStatus: null,
    lostSaleSource: null,
    ...overrides,
  };
}

describe("deltaPercent", () => {
  it("computes a signed percent change to one decimal place", () => {
    expect(deltaPercent(110, 100)).toBe(10);
    expect(deltaPercent(90, 100)).toBe(-10);
    expect(deltaPercent(133, 100)).toBe(33);
    expect(deltaPercent(100, 100)).toBe(0);
  });

  it("returns null for a change off a zero base, rather than dividing by zero or fabricating Infinity/NaN", () => {
    expect(deltaPercent(5, 0)).toBeNull();
  });

  it("returns 0 (not null) when both current and prior are zero -- a genuine, reportable 'no change'", () => {
    expect(deltaPercent(0, 0)).toBe(0);
  });

  it("rounds to one decimal place", () => {
    expect(deltaPercent(103, 100)).toBe(3);
    expect(deltaPercent(1, 3)).toBe(-66.7);
  });
});

describe("resolveComparisonRanges", () => {
  it("defaults to the trailing 7 UTC calendar days ending today when no dateFrom/dateTo is given", () => {
    const { current, prior } = resolveComparisonRanges(emptyFilters());
    const today = new Date().toISOString().slice(0, 10);
    expect(current.dateTo).toBe(today);

    const from = new Date(`${current.dateFrom}T00:00:00.000Z`);
    const to = new Date(`${current.dateTo}T00:00:00.000Z`);
    const spanDays = Math.round((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24));
    expect(spanDays).toBe(6); // 7 inclusive days spans a 6-day difference, same convention as defaultDateRange()'s own test

    // Prior period is the immediately preceding window of the SAME length --
    // its own dateTo is exactly one day before current's dateFrom, never
    // overlapping and never a different-length comparison.
    const priorTo = new Date(`${prior.dateTo}T00:00:00.000Z`);
    expect(priorTo.getTime()).toBe(from.getTime() - 24 * 60 * 60 * 1000);
    const priorFrom = new Date(`${prior.dateFrom}T00:00:00.000Z`);
    const priorSpanDays = Math.round((priorTo.getTime() - priorFrom.getTime()) / (1000 * 60 * 60 * 24));
    expect(priorSpanDays).toBe(spanDays);
  });

  it("uses the caller's own dateFrom/dateTo when given, so the dashboard's own filter bar genuinely changes the comparison window", () => {
    const { current, prior, periodLabel } = resolveComparisonRanges(emptyFilters({ dateFrom: "2026-03-10", dateTo: "2026-03-12" }));
    expect(current).toEqual({ dateFrom: "2026-03-10", dateTo: "2026-03-12" });
    // A 3-day current window (10th-12th inclusive) compares against the
    // immediately preceding 3-day window (7th-9th inclusive), not the 9th
    // (which would double-count the 9th/10th boundary) and not a
    // different-length window.
    expect(prior).toEqual({ dateFrom: "2026-03-07", dateTo: "2026-03-09" });
    expect(periodLabel).toBe("vs. previous 3 days");
  });

  it("never lets the prior period overlap the current period", () => {
    const { current, prior } = resolveComparisonRanges(emptyFilters({ dateFrom: "2026-01-01", dateTo: "2026-01-01" }));
    expect(prior.dateTo < current.dateFrom).toBe(true);
  });
});
