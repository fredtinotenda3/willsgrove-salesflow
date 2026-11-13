import { describe, it, expect } from "vitest";
import { groupRevenueByCurrencyAndProduct, summarizeProductRevenueByCurrency, type ProductRevenueLineRecord } from "@/lib/reporting/product-revenue";
import { UNKNOWN_CURRENCY } from "@/lib/reporting/sales-revenue";

/**
 * Milestone 14 (Product Intelligence). Unconditional unit tests for
 * lib/reporting/product-revenue.ts -- the pure, product-keyed money
 * aggregation (no @prisma/client import), runnable in this sandbox
 * without RUN_DB_INTEGRATION_TESTS. Mirrors tests/customer-revenue.test.ts
 * exactly, one level down: grouped by SAP item code instead of customer id.
 */

describe("groupRevenueByCurrencyAndProduct", () => {
  const records: ProductRevenueLineRecord[] = [
    { sapItemCode: "ITEM-A", currency: "USD", lineTotal: "100.0000" },
    { sapItemCode: "ITEM-A", currency: "USD", lineTotal: "50.0000" },
    { sapItemCode: "ITEM-B", currency: "USD", lineTotal: "25.0000" },
    { sapItemCode: "ITEM-A", currency: "ZWG", lineTotal: "1000.0000" },
    { sapItemCode: "ITEM-B", currency: "USD", lineTotal: null },
    { sapItemCode: "ITEM-C", currency: null, lineTotal: "5.0000" },
  ];
  const result = groupRevenueByCurrencyAndProduct(records);

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

  it("groups by SAP item code within each currency, never by description or Product.id", () => {
    const usd = result.find((r) => r.currency === "USD")!;
    const itemA = usd.byProduct.find((p) => p.sapItemCode === "ITEM-A")!;
    expect(itemA.lineValueTotal).toBe("150");

    const itemB = usd.byProduct.find((p) => p.sapItemCode === "ITEM-B")!;
    expect(itemB.lineValueTotal).toBe("25");
    expect(itemB.excludedLineCount).toBe(1);
  });

  it("maps a missing currency to its own explicit UNKNOWN bucket, never merged into a real currency", () => {
    const unknown = result.find((r) => r.currency === UNKNOWN_CURRENCY)!;
    expect(unknown).toBeDefined();
    expect(unknown.byProduct.find((p) => p.sapItemCode === "ITEM-C")!.lineValueTotal).toBe("5");
  });

  it("sorts both currency entries and per-currency product rows deterministically", () => {
    expect(result.map((r) => r.currency)).toEqual([...result.map((r) => r.currency)].sort((a, b) => a.localeCompare(b)));
    for (const currencyRow of result) {
      expect(currencyRow.byProduct.map((p) => p.sapItemCode)).toEqual(
        [...currencyRow.byProduct.map((p) => p.sapItemCode)].sort((a, b) => a.localeCompare(b))
      );
    }
  });

  it("returns an empty array for no records at all", () => {
    expect(groupRevenueByCurrencyAndProduct([])).toEqual([]);
  });

  it("a currency bucket with only excluded (null-lineTotal) lines reports a zero total, never NaN or a crash", () => {
    const onlyExcluded: ProductRevenueLineRecord[] = [{ sapItemCode: "ITEM-D", currency: "EUR", lineTotal: null }];
    const r = groupRevenueByCurrencyAndProduct(onlyExcluded);
    const eur = r.find((row) => row.currency === "EUR")!;
    expect(eur.totalLineValue).toBe("0");
    expect(eur.excludedLineCount).toBe(1);
    expect(eur.byProduct[0].lineValueTotal).toBe("0");
    expect(eur.byProduct[0].excludedLineCount).toBe(1);
  });
});

describe("summarizeProductRevenueByCurrency", () => {
  const records: ProductRevenueLineRecord[] = [
    { sapItemCode: "ITEM-A", currency: "USD", lineTotal: "100.0000" },
    { sapItemCode: "ITEM-B", currency: "USD", lineTotal: "25.0000" },
    { sapItemCode: "ITEM-A", currency: "ZWG", lineTotal: "1000.0000" },
  ];

  it("returns only the one product's own currency rows, never another product's figures", () => {
    const result = summarizeProductRevenueByCurrency("ITEM-A", records);
    expect(result).toEqual([
      { currency: "USD", lineValueTotal: "100", excludedLineCount: 0 },
      { currency: "ZWG", lineValueTotal: "1000", excludedLineCount: 0 },
    ]);
  });

  it("returns an empty array for a product with no qualifying lines at all", () => {
    expect(summarizeProductRevenueByCurrency("ITEM-NONE", records)).toEqual([]);
  });

  it("never drifts from groupRevenueByCurrencyAndProduct -- it is a read-back of the same grouping, not a separate algorithm", () => {
    const full = groupRevenueByCurrencyAndProduct(records);
    const viaConvenience = summarizeProductRevenueByCurrency("ITEM-B", records);
    const viaFull = full
      .map((currencyRow) => {
        const row = currencyRow.byProduct.find((p) => p.sapItemCode === "ITEM-B");
        return row ? { currency: currencyRow.currency, lineValueTotal: row.lineValueTotal, excludedLineCount: row.excludedLineCount } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    expect(viaConvenience).toEqual(viaFull);
  });
});
