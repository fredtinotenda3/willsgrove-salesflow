import { describe, it, expect } from "vitest";
import { sumMoneyRows, currencyKey, groupRevenueByCurrencyAndSalesperson, UNKNOWN_CURRENCY, type RevenueLineRecord } from "@/lib/reporting/sales-revenue";

/**
 * Milestone 12 (Sales Performance Intelligence). Unconditional unit
 * tests for lib/reporting/sales-revenue.ts -- the pure money-aggregation
 * half of the salesperson-revenue report (no @prisma/client import; see
 * that module's own top comment), runnable in this sandbox without
 * RUN_DB_INTEGRATION_TESTS.
 */

describe("currencyKey", () => {
  it("trims and uppercases a real currency code", () => {
    expect(currencyKey(" usd ")).toBe("USD");
    expect(currencyKey("zwg")).toBe("ZWG");
  });

  it("maps null/undefined/blank to the explicit UNKNOWN_CURRENCY bucket, never merging it into a real currency", () => {
    expect(currencyKey(null)).toBe(UNKNOWN_CURRENCY);
    expect(currencyKey(undefined)).toBe(UNKNOWN_CURRENCY);
    expect(currencyKey("   ")).toBe(UNKNOWN_CURRENCY);
    expect(currencyKey("")).toBe(UNKNOWN_CURRENCY);
  });
});

describe("sumMoneyRows", () => {
  it("sums present values exactly, as a decimal string", () => {
    const result = sumMoneyRows(["10.5000", "20.2500"]);
    expect(result.total).toBe("30.75");
    expect(result.excludedCount).toBe(0);
  });

  it("excludes null rows from the sum entirely -- never coerced to 0", () => {
    const result = sumMoneyRows(["10.0000", null, "5.0000", null]);
    expect(result.total).toBe("15");
    expect(result.excludedCount).toBe(2);
  });

  it("returns \"0\" with excludedCount 0 for an empty input", () => {
    expect(sumMoneyRows([])).toEqual({ total: "0", excludedCount: 0 });
  });

  it("returns \"0\" with the full count excluded when every row is null", () => {
    expect(sumMoneyRows([null, null])).toEqual({ total: "0", excludedCount: 2 });
  });
});

describe("groupRevenueByCurrencyAndSalesperson", () => {
  const records: RevenueLineRecord[] = [
    { orderId: "o1", salespersonId: "sp1", currency: "USD", lineTotal: "100.0000", attributionBucket: "VERIFIED" },
    { orderId: "o1", salespersonId: "sp1", currency: "USD", lineTotal: "50.0000", attributionBucket: "VERIFIED" },
    { orderId: "o2", salespersonId: "sp2", currency: "USD", lineTotal: "25.0000", attributionBucket: "UNVERIFIED_LIKELY" },
    { orderId: "o3", salespersonId: null, currency: "USD", lineTotal: "10.0000", attributionBucket: "UNASSIGNED" },
    { orderId: "o4", salespersonId: "sp1", currency: "ZWG", lineTotal: "1000.0000", attributionBucket: "VERIFIED" },
    { orderId: null, salespersonId: null, currency: "USD", lineTotal: null, attributionBucket: "UNASSIGNED" },
  ];
  const result = groupRevenueByCurrencyAndSalesperson(records);

  it("never sums across currency -- USD and ZWG are entirely separate top-level entries", () => {
    expect(result.map((r) => r.currency)).toEqual(["USD", "ZWG"]);
  });

  it("sums each currency's total line value correctly, excluding the one null-lineTotal row", () => {
    const usd = result.find((r) => r.currency === "USD")!;
    expect(usd.totalLineValue).toBe("185"); // 100 + 50 + 25 + 10
    expect(usd.excludedLineCount).toBe(1);

    const zwg = result.find((r) => r.currency === "ZWG")!;
    expect(zwg.totalLineValue).toBe("1000");
    expect(zwg.excludedLineCount).toBe(0);
  });

  it("groups by salesperson within each currency, counting DISTINCT order ids (not line rows)", () => {
    const usd = result.find((r) => r.currency === "USD")!;
    const sp1 = usd.bySalesperson.find((s) => s.salespersonId === "sp1")!;
    expect(sp1.orderCount).toBe(1); // o1 appears twice (2 lines), counted once
    expect(sp1.lineValueTotal).toBe("150");

    const sp2 = usd.bySalesperson.find((s) => s.salespersonId === "sp2")!;
    expect(sp2.orderCount).toBe(1);
    expect(sp2.lineValueTotal).toBe("25");
  });

  it("groups null salespersonId under its own explicit null bucket, never merged with a real salesperson", () => {
    const usd = result.find((r) => r.currency === "USD")!;
    const unassigned = usd.bySalesperson.find((s) => s.salespersonId === null)!;
    expect(unassigned).toBeDefined();
    // The two UNASSIGNED rows: one with a real lineTotal (10), one null.
    expect(unassigned.lineValueTotal).toBe("10");
    expect(unassigned.excludedLineCount).toBe(1);
  });

  it("carries the attribution-bucket breakdown through per salesperson", () => {
    const usd = result.find((r) => r.currency === "USD")!;
    const sp1 = usd.bySalesperson.find((s) => s.salespersonId === "sp1")!;
    expect(sp1.attributionBreakdown).toEqual({ VERIFIED: 2 });

    const sp2 = usd.bySalesperson.find((s) => s.salespersonId === "sp2")!;
    expect(sp2.attributionBreakdown).toEqual({ UNVERIFIED_LIKELY: 1 });
  });

  it("returns an empty array for no records at all", () => {
    expect(groupRevenueByCurrencyAndSalesperson([])).toEqual([]);
  });
});
