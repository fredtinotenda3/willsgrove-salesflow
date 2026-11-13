import { describe, it, expect } from "vitest";
import {
  aggregateQuantityByUnit,
  aggregateCustomerDemandForProduct,
  itemKey,
  UNKNOWN_SAP_ITEM_CODE,
  type ProductQuantityLineRecord,
  type ProductCustomerDemandLineRecord,
} from "@/lib/reporting/product-purchasing";

/**
 * Milestone 14 (Product Intelligence), spec sections 4.2/4.3/5.3.
 * Unconditional unit tests for lib/reporting/product-purchasing.ts -- the
 * product-keyed twin of M13's customer-purchasing aggregation (no
 * @prisma/client import), runnable in this sandbox without
 * RUN_DB_INTEGRATION_TESTS.
 */

describe("aggregateQuantityByUnit", () => {
  it("groups quantity by the line's own recorded unitOfMeasure -- never combining incompatible units", () => {
    const records: ProductQuantityLineRecord[] = [
      { unitOfMeasure: "EA", quantityInvoiced: "10.0000" },
      { unitOfMeasure: "CTN", quantityInvoiced: "3.0000" },
    ];
    const result = aggregateQuantityByUnit(records);
    expect(result).toEqual([
      { unitOfMeasure: "CTN", quantityTotal: "3" },
      { unitOfMeasure: "EA", quantityTotal: "10" },
    ]);
    expect(result.some((u) => u.quantityTotal === "13")).toBe(false);
  });

  it("sums quantity correctly when the same unit repeats across lines", () => {
    const records: ProductQuantityLineRecord[] = [
      { unitOfMeasure: "EA", quantityInvoiced: "10.0000" },
      { unitOfMeasure: "EA", quantityInvoiced: "5.0000" },
    ];
    expect(aggregateQuantityByUnit(records)).toEqual([{ unitOfMeasure: "EA", quantityTotal: "15" }]);
  });

  it("normalizes a missing unitOfMeasure to an explicit UNKNOWN bucket, and uppercases/trims real units", () => {
    const records: ProductQuantityLineRecord[] = [
      { unitOfMeasure: null, quantityInvoiced: "1.0000" },
      { unitOfMeasure: " ea ", quantityInvoiced: "2.0000" },
      { unitOfMeasure: "ea", quantityInvoiced: "3.0000" },
    ];
    const result = aggregateQuantityByUnit(records);
    // " ea " and "ea" both normalize to "EA" and are summed together.
    const ea = result.find((r) => r.unitOfMeasure === "EA");
    expect(ea?.quantityTotal).toBe("5");
    expect(result.some((r) => r.unitOfMeasure.includes("UNKNOWN"))).toBe(true);
  });

  it("returns an empty array for no records at all", () => {
    expect(aggregateQuantityByUnit([])).toEqual([]);
  });
});

describe("itemKey", () => {
  it("returns the trimmed code unchanged when a real SAP item code is given", () => {
    expect(itemKey(" ITEM-1 ")).toBe("ITEM-1");
  });

  it("maps null/blank to the explicit UNKNOWN_SAP_ITEM_CODE constant, never an empty string", () => {
    expect(itemKey(null)).toBe(UNKNOWN_SAP_ITEM_CODE);
    expect(itemKey("")).toBe(UNKNOWN_SAP_ITEM_CODE);
    expect(itemKey("   ")).toBe(UNKNOWN_SAP_ITEM_CODE);
  });
});

describe("aggregateCustomerDemandForProduct", () => {
  it("counts purchase frequency as DISTINCT invoices, never lines -- two lines on one invoice is one purchase", () => {
    const records: ProductCustomerDemandLineRecord[] = [
      { customerId: "c1", invoiceId: "i1", invoiceDate: "2026-01-05" },
      { customerId: "c1", invoiceId: "i1", invoiceDate: "2026-01-05" },
      { customerId: "c1", invoiceId: "i2", invoiceDate: "2026-01-10" },
    ];
    const [row] = aggregateCustomerDemandForProduct(records);
    expect(row.purchaseFrequency).toBe(2);
  });

  it("computes lastPurchaseDate as the MAX invoiceDate for that customer", () => {
    const records: ProductCustomerDemandLineRecord[] = [
      { customerId: "c1", invoiceId: "i1", invoiceDate: "2026-01-05" },
      { customerId: "c1", invoiceId: "i2", invoiceDate: "2026-02-10" },
      { customerId: "c1", invoiceId: "i3", invoiceDate: "2026-01-20" },
    ];
    const [row] = aggregateCustomerDemandForProduct(records);
    expect(row.lastPurchaseDate).toBe("2026-02-10");
  });

  it("groups by customer independently -- one customer's figures never bleed into another's", () => {
    const records: ProductCustomerDemandLineRecord[] = [
      { customerId: "c1", invoiceId: "i1", invoiceDate: "2026-01-05" },
      { customerId: "c2", invoiceId: "i2", invoiceDate: "2026-01-10" },
      { customerId: "c2", invoiceId: "i3", invoiceDate: "2026-01-15" },
    ];
    const result = aggregateCustomerDemandForProduct(records);
    const c1 = result.find((r) => r.customerId === "c1")!;
    const c2 = result.find((r) => r.customerId === "c2")!;
    expect(c1.purchaseFrequency).toBe(1);
    expect(c2.purchaseFrequency).toBe(2);
  });

  it("returns rows sorted deterministically by customerId", () => {
    const records: ProductCustomerDemandLineRecord[] = [
      { customerId: "z-cust", invoiceId: "i1", invoiceDate: "2026-01-05" },
      { customerId: "a-cust", invoiceId: "i2", invoiceDate: "2026-01-10" },
    ];
    expect(aggregateCustomerDemandForProduct(records).map((r) => r.customerId)).toEqual(["a-cust", "z-cust"]);
  });

  it("returns an empty array for no records at all", () => {
    expect(aggregateCustomerDemandForProduct([])).toEqual([]);
  });
});
