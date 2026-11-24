import { describe, expect, it } from "vitest";
import { isPackPeriodKind, resolvePackPeriod, shiftPackAnchor } from "@/lib/reporting/management-pack-period";

const NOW = new Date("2026-11-24T10:00:00.000Z"); // a Tuesday

describe("resolvePackPeriod", () => {
  it("resolves the current week Monday-Sunday and flags it incomplete", () => {
    const p = resolvePackPeriod("week", null, NOW);
    expect([p.dateFrom, p.dateTo]).toEqual(["2026-11-23", "2026-11-29"]);
    expect(p.isComplete).toBe(false);
    expect([p.prior.dateFrom, p.prior.dateTo]).toEqual(["2026-11-16", "2026-11-22"]);
  });
  it("puts a Sunday anchor in the week that ENDS on it", () => {
    const p = resolvePackPeriod("week", "2026-11-22", NOW);
    expect([p.dateFrom, p.dateTo]).toEqual(["2026-11-16", "2026-11-22"]);
    expect(p.isComplete).toBe(true);
  });
  it("resolves a calendar month including leap February", () => {
    const p = resolvePackPeriod("month", "2028-02-10", NOW);
    expect([p.dateFrom, p.dateTo]).toEqual(["2028-02-01", "2028-02-29"]);
    expect([p.prior.dateFrom, p.prior.dateTo]).toEqual(["2028-01-01", "2028-01-31"]);
    expect(p.label).toBe("February 2028");
  });
  it("accepts YYYY-MM for months and crosses the year boundary for the prior month", () => {
    const p = resolvePackPeriod("month", "2026-01", NOW);
    expect([p.dateFrom, p.dateTo]).toEqual(["2026-01-01", "2026-01-31"]);
    expect([p.prior.dateFrom, p.prior.dateTo]).toEqual(["2025-12-01", "2025-12-31"]);
  });
  it("falls back to the current period for an invalid anchor, never throwing", () => {
    expect(resolvePackPeriod("month", "2026-13-45", NOW).dateFrom).toBe("2026-11-01");
    expect(resolvePackPeriod("week", "garbage", NOW).dateFrom).toBe("2026-11-23");
  });
  it("marks a finished month complete and the running month incomplete", () => {
    expect(resolvePackPeriod("month", "2026-10", NOW).isComplete).toBe(true);
    expect(resolvePackPeriod("month", "2026-11", NOW).isComplete).toBe(false);
  });
});

describe("shiftPackAnchor / isPackPeriodKind", () => {
  it("steps weeks by 7 days and months by calendar month", () => {
    expect(shiftPackAnchor(resolvePackPeriod("week", "2026-11-24", NOW), -1)).toBe("2026-11-16");
    expect(shiftPackAnchor(resolvePackPeriod("month", "2026-01", NOW), -1)).toBe("2025-12-01");
    expect(shiftPackAnchor(resolvePackPeriod("month", "2026-12", NOW), 1)).toBe("2027-01-01");
  });
  it("validates the kind", () => {
    expect(isPackPeriodKind("week")).toBe(true);
    expect(isPackPeriodKind("year")).toBe(false);
    expect(isPackPeriodKind(null)).toBe(false);
  });
});
