import { describe, it, expect } from "vitest";
import {
  resolveAsOfDate,
  currentBusinessDateInHarare,
  computeDaysSinceLastQualifyingInvoice,
  computeAverageInterPurchaseInterval,
} from "@/lib/reporting/customer-recency";

/**
 * Milestone 13 (Customer Intelligence). Unconditional unit tests for
 * lib/reporting/customer-recency.ts -- the pure as-of-date and recency
 * arithmetic (no @prisma/client import), runnable in this sandbox
 * without RUN_DB_INTEGRATION_TESTS.
 */

describe("resolveAsOfDate", () => {
  it("uses the selected dateTo when one is present -- historical report mode", () => {
    const result = resolveAsOfDate({ dateTo: "2026-06-30" }, new Date("2026-11-12T10:00:00.000Z"));
    expect(result).toEqual({ asOfDate: "2026-06-30", source: "selected-date-to" });
  });

  it("falls back to the live Africa/Harare business date when dateTo is null", () => {
    const result = resolveAsOfDate({ dateTo: null }, new Date("2026-11-12T10:00:00.000Z"));
    expect(result.source).toBe("live-business-date");
    expect(result.asOfDate).toBe("2026-11-12");
  });
});

describe("currentBusinessDateInHarare", () => {
  it("resolves the Africa/Harare (UTC+2) calendar date, not the server's UTC date", () => {
    // 23:30 UTC on 2026-11-11 is already 01:30 on 2026-11-12 in Harare (UTC+2).
    expect(currentBusinessDateInHarare(new Date("2026-11-11T23:30:00.000Z"))).toBe("2026-11-12");
  });

  it("stays on the same day when UTC and Harare agree", () => {
    expect(currentBusinessDateInHarare(new Date("2026-11-12T10:00:00.000Z"))).toBe("2026-11-12");
  });

  it("does not roll over at Harare midnight before UTC does -- 00:30 UTC is 02:30 Harare, still the same UTC day", () => {
    expect(currentBusinessDateInHarare(new Date("2026-11-12T00:30:00.000Z"))).toBe("2026-11-12");
  });
});

describe("computeDaysSinceLastQualifyingInvoice", () => {
  it("returns null -- never 0 -- when there is no qualifying invoice on record", () => {
    expect(computeDaysSinceLastQualifyingInvoice("2026-11-12", null)).toBeNull();
  });

  it("computes a whole-day difference", () => {
    expect(computeDaysSinceLastQualifyingInvoice("2026-11-12", "2026-11-02")).toBe(10);
  });

  it("returns 0 when the last qualifying invoice is exactly on the as-of date", () => {
    expect(computeDaysSinceLastQualifyingInvoice("2026-11-12", "2026-11-12")).toBe(0);
  });
});

describe("computeAverageInterPurchaseInterval", () => {
  it("reports insufficient_data for zero or one usable date, never 0", () => {
    expect(computeAverageInterPurchaseInterval([])).toEqual({ status: "insufficient_data" });
    expect(computeAverageInterPurchaseInterval(["2026-11-01"])).toEqual({ status: "insufficient_data" });
  });

  it("computes the average gap across consecutive dates", () => {
    // 2026-11-01 -> 2026-11-06 (5 days), 2026-11-06 -> 2026-11-16 (10 days) -> average 7.5
    const result = computeAverageInterPurchaseInterval(["2026-11-01", "2026-11-16", "2026-11-06"]);
    expect(result).toEqual({ status: "ok", averageDays: 7.5 });
  });

  it("legitimately produces a zero-day gap for two invoices on the same date, not an error", () => {
    const result = computeAverageInterPurchaseInterval(["2026-11-01", "2026-11-01"]);
    expect(result).toEqual({ status: "ok", averageDays: 0 });
  });

  it("sorts unsorted input before computing gaps", () => {
    const result = computeAverageInterPurchaseInterval(["2026-11-16", "2026-11-01"]);
    expect(result).toEqual({ status: "ok", averageDays: 15 });
  });
});
