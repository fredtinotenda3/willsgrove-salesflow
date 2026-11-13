import { describe, it, expect } from "vitest";
import { aggregateProductPurchasing, UNKNOWN_SAP_ITEM_CODE, UNKNOWN_UNIT_OF_MEASURE, type ProductLineRecord } from "@/lib/reporting/customer-purchasing";

/**
 * Milestone 13 (Customer Intelligence). Unconditional unit tests for
 * lib/reporting/customer-purchasing.ts -- the pure product-purchasing-
 * pattern aggregation (no @prisma/client import), runnable in this
 * sandbox without RUN_DB_INTEGRATION_TESTS.
 */

describe("aggregateProductPurchasing", () => {
  it("groups quantity by (sapItemCode, unitOfMeasure) -- never combining incompatible units", () => {
    const records: ProductLineRecord[] = [
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-A", sapItemDescription: "Widget", unitOfMeasure: "EA", quantityInvoiced: "10.0000", lineTotal: "100.0000", currency: "USD" },
      { invoiceId: "i2", invoiceDate: "2026-01-10", sapItemCode: "ITEM-A", sapItemDescription: "Widget", unitOfMeasure: "CTN", quantityInvoiced: "3.0000", lineTotal: "90.0000", currency: "USD" },
    ];
    const [row] = aggregateProductPurchasing(records);
    expect(row.sapItemCode).toBe("ITEM-A");
    expect(row.quantityByUnit).toEqual([
      { unitOfMeasure: "CTN", quantityTotal: "3" },
      { unitOfMeasure: "EA", quantityTotal: "10" },
    ]);
    // Never a single combined "13" figure across incompatible units.
    expect(row.quantityByUnit.some((u) => u.quantityTotal === "13")).toBe(false);
  });

  it("sums quantity correctly when the same item+unit repeats across invoices", () => {
    const records: ProductLineRecord[] = [
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-A", sapItemDescription: "Widget", unitOfMeasure: "EA", quantityInvoiced: "10.0000", lineTotal: "100.0000", currency: "USD" },
      { invoiceId: "i2", invoiceDate: "2026-01-10", sapItemCode: "ITEM-A", sapItemDescription: "Widget", unitOfMeasure: "EA", quantityInvoiced: "5.0000", lineTotal: "50.0000", currency: "USD" },
    ];
    const [row] = aggregateProductPurchasing(records);
    expect(row.quantityByUnit).toEqual([{ unitOfMeasure: "EA", quantityTotal: "15" }]);
  });

  it("groups value by (sapItemCode, currency) -- never summed across currency", () => {
    const records: ProductLineRecord[] = [
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-A", sapItemDescription: "Widget", unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "100.0000", currency: "USD" },
      { invoiceId: "i2", invoiceDate: "2026-01-10", sapItemCode: "ITEM-A", sapItemDescription: "Widget", unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "900.0000", currency: "ZWG" },
    ];
    const [row] = aggregateProductPurchasing(records);
    expect(row.valueByCurrency.find((v) => v.currency === "USD")!.lineValueTotal).toBe("100");
    expect(row.valueByCurrency.find((v) => v.currency === "ZWG")!.lineValueTotal).toBe("900");
  });

  it("excludes null lineTotal from value sum and counts it", () => {
    const records: ProductLineRecord[] = [
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-A", sapItemDescription: null, unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: null, currency: "USD" },
    ];
    const [row] = aggregateProductPurchasing(records);
    expect(row.valueByCurrency).toEqual([{ currency: "USD", lineValueTotal: "0", excludedLineCount: 1 }]);
  });

  it("counts purchase frequency as DISTINCT invoices, never lines -- two lines on one invoice is one purchase", () => {
    const records: ProductLineRecord[] = [
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-A", sapItemDescription: null, unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "10.0000", currency: "USD" },
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-A", sapItemDescription: null, unitOfMeasure: "CTN", quantityInvoiced: "1.0000", lineTotal: "20.0000", currency: "USD" },
      { invoiceId: "i2", invoiceDate: "2026-01-10", sapItemCode: "ITEM-A", sapItemDescription: null, unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "10.0000", currency: "USD" },
    ];
    const [row] = aggregateProductPurchasing(records);
    expect(row.purchaseFrequency).toBe(2);
  });

  it("computes last-purchased as MAX(invoiceDate) among this item's records", () => {
    const records: ProductLineRecord[] = [
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-A", sapItemDescription: null, unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "10.0000", currency: "USD" },
      { invoiceId: "i2", invoiceDate: "2026-02-20", sapItemCode: "ITEM-A", sapItemDescription: null, unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "10.0000", currency: "USD" },
    ];
    const [row] = aggregateProductPurchasing(records);
    expect(row.lastPurchasedDate).toBe("2026-02-20");
  });

  it("carries the description from the line with the LATEST invoiceDate, never an arbitrary one", () => {
    const records: ProductLineRecord[] = [
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-A", sapItemDescription: "Old description", unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "10.0000", currency: "USD" },
      { invoiceId: "i2", invoiceDate: "2026-02-20", sapItemCode: "ITEM-A", sapItemDescription: "New description", unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "10.0000", currency: "USD" },
    ];
    const [row] = aggregateProductPurchasing(records);
    expect(row.latestLineDescription).toBe("New description");
  });

  it("buckets a missing sapItemCode/unitOfMeasure under their own explicit UNKNOWN markers, never merged with a real value", () => {
    const records: ProductLineRecord[] = [
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: null, sapItemDescription: "Mystery item", unitOfMeasure: null, quantityInvoiced: "1.0000", lineTotal: "10.0000", currency: "USD" },
    ];
    const [row] = aggregateProductPurchasing(records);
    expect(row.sapItemCode).toBe(UNKNOWN_SAP_ITEM_CODE);
    expect(row.quantityByUnit).toEqual([{ unitOfMeasure: UNKNOWN_UNIT_OF_MEASURE, quantityTotal: "1" }]);
  });

  it("returns an empty array for no records at all", () => {
    expect(aggregateProductPurchasing([])).toEqual([]);
  });

  it("returns multiple distinct products, sorted by sapItemCode", () => {
    const records: ProductLineRecord[] = [
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-B", sapItemDescription: null, unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "10.0000", currency: "USD" },
      { invoiceId: "i1", invoiceDate: "2026-01-05", sapItemCode: "ITEM-A", sapItemDescription: null, unitOfMeasure: "EA", quantityInvoiced: "1.0000", lineTotal: "10.0000", currency: "USD" },
    ];
    const result = aggregateProductPurchasing(records);
    expect(result.map((r) => r.sapItemCode)).toEqual(["ITEM-A", "ITEM-B"]);
  });
});
