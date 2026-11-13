import { describe, it, expect } from "vitest";
import { groupRevenueByCurrencyAndCustomer, summarizeCustomerRevenueByCurrency, type CustomerRevenueLineRecord } from "@/lib/reporting/customer-revenue";
import { UNKNOWN_CURRENCY } from "@/lib/reporting/sales-revenue";

/**
 * Milestone 13 (Customer Intelligence). Unconditional unit tests for
 * lib/reporting/customer-revenue.ts -- the pure, customer-keyed money
 * aggregation (no @prisma/client import), runnable in this sandbox
 * without RUN_DB_INTEGRATION_TESTS.
 */

describe("groupRevenueByCurrencyAndCustomer", () => {
  const records: CustomerRevenueLineRecord[] = [
    { customerId: "c1", currency: "USD", lineTotal: "100.0000" },
    { customerId: "c1", currency: "USD", lineTotal: "50.0000" },
    { customerId: "c2", currency: "USD", lineTotal: "25.0000" },
    { customerId: "c1", currency: "ZWG", lineTotal: "1000.0000" },
    { customerId: "c2", currency: "USD", lineTotal: null },
    { customerId: "c3", currency: null, lineTotal: "5.0000" },
  ];
  const result = groupRevenueByCurrencyAndCustomer(records);

  it("never sums across currency -- USD, ZWG and UNKNOWN are entirely separate top-level entries", () => {
    expect(result.map((r) => r.currency).sort()).toEqual([UNKNOWN_CURRENCY, "USD", "ZWG"].sort());
  });

  it("sums each currency's total line value correctly, excluding the one null-lineTotal row", () => {
    const usd = result.find((r) => r.currency === "USD")!;
    expect(usd.totalLineValue).toBe("175"); // 100 + 50 + 25
    expect(usd.excludedLineCount).toBe(1);

    const zwg = result.find((r) => r.currency === "ZWG")!;
    expect(zwg.totalLineValue).toBe("1000");
  });

  it("groups by customer within each currency", () => {
    const usd = result.find((r) => r.currency === "USD")!;
    const c1 = usd.byCustomer.find((c) => c.customerId === "c1")!;
    expect(c1.lineValueTotal).toBe("150");

    const c2 = usd.byCustomer.find((c) => c.customerId === "c2")!;
    expect(c2.lineValueTotal).toBe("25");
    expect(c2.excludedLineCount).toBe(1);
  });

  it("maps a missing currency to its own explicit UNKNOWN bucket, never merged into a real currency", () => {
    const unknown = result.find((r) => r.currency === UNKNOWN_CURRENCY)!;
    expect(unknown).toBeDefined();
    expect(unknown.byCustomer.find((c) => c.customerId === "c3")!.lineValueTotal).toBe("5");
  });

  it("returns an empty array for no records at all", () => {
    expect(groupRevenueByCurrencyAndCustomer([])).toEqual([]);
  });
});

describe("summarizeCustomerRevenueByCurrency", () => {
  const records: CustomerRevenueLineRecord[] = [
    { customerId: "c1", currency: "USD", lineTotal: "100.0000" },
    { customerId: "c2", currency: "USD", lineTotal: "25.0000" },
    { customerId: "c1", currency: "ZWG", lineTotal: "1000.0000" },
  ];

  it("returns only the one customer's own currency rows, never another customer's figures", () => {
    const result = summarizeCustomerRevenueByCurrency("c1", records);
    expect(result).toEqual([
      { currency: "USD", lineValueTotal: "100", excludedLineCount: 0 },
      { currency: "ZWG", lineValueTotal: "1000", excludedLineCount: 0 },
    ]);
  });

  it("returns an empty array for a customer with no qualifying lines at all", () => {
    expect(summarizeCustomerRevenueByCurrency("nobody", records)).toEqual([]);
  });
});
