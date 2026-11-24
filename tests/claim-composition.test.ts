import { describe, expect, it } from "vitest";
import { aggregateClaimComposition, type ClaimCompositionInputLine } from "@/lib/invoice-claims/composition";

function line(overrides: Partial<ClaimCompositionInputLine> = {}): ClaimCompositionInputLine {
  return {
    claimLineId: "l1",
    productKey: "TOM",
    sapItemCode: "TOM",
    description: "Tomatoes",
    unit: "KG",
    invoiceLineId: "il1",
    deliveredQuantity: "100.0000",
    acceptedQuantity: "90.0000",
    rejectedQuantity: "10.0000",
    returnedQuantity: "4.0000",
    reasonCategory: "POOR_QUALITY_PRODUCT",
    value: "25.0000",
    currency: "USD",
    ...overrides,
  };
}

describe("aggregateClaimComposition", () => {
  it("sums accepted, rejected and returned per product", () => {
    const { rows } = aggregateClaimComposition([
      line({ claimLineId: "a", invoiceLineId: "il1" }),
      line({ claimLineId: "b", invoiceLineId: "il2", deliveredQuantity: "50.0000", acceptedQuantity: "45.0000", rejectedQuantity: "5.0000", returnedQuantity: "0.0000", value: "12.5000" }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ delivered: "150", accepted: "135", rejected: "15", returned: "4", claimLineCount: 2, deliveredComplete: true, unit: "KG" });
    expect(rows[0].valueByCurrency).toEqual([{ currency: "USD", value: "37.5" }]);
  });

  it("counts an invoice line's delivered quantity once even when several claim lines reference it", () => {
    const { rows } = aggregateClaimComposition([
      line({ claimLineId: "a", invoiceLineId: "il1" }),
      line({ claimLineId: "b", invoiceLineId: "il1" }),
    ]);
    expect(rows[0].delivered).toBe("100");
    expect(rows[0].rejected).toBe("20");
  });

  it("flags delivered as incomplete when a line has no invoice line, instead of guessing", () => {
    const { rows } = aggregateClaimComposition([line({ invoiceLineId: null, deliveredQuantity: null })]);
    expect(rows[0].deliveredComplete).toBe(false);
    expect(rows[0].delivered).toBe("0");
  });

  it("keeps currencies apart and never sums them", () => {
    const { rows, summary } = aggregateClaimComposition([
      line({ claimLineId: "a", value: "10.0000", currency: "USD" }),
      line({ claimLineId: "b", invoiceLineId: "il2", value: "30.0000", currency: "ZWG" }),
    ]);
    expect(rows[0].valueByCurrency).toEqual([
      { currency: "ZWG", value: "30" },
      { currency: "USD", value: "10" },
    ]);
    expect(summary.valueByCurrency).toHaveLength(2);
  });

  it("counts lines whose value cannot be priced rather than treating them as zero value", () => {
    const { rows, summary } = aggregateClaimComposition([line({ value: null }), line({ claimLineId: "b", invoiceLineId: "il2", value: "5.0000" })]);
    expect(rows[0].valueIncompleteLines).toBe(1);
    expect(summary.valueIncompleteLines).toBe(1);
    expect(rows[0].valueByCurrency).toEqual([{ currency: "USD", value: "5" }]);
  });

  it("never mixes products or their units", () => {
    const { rows } = aggregateClaimComposition([
      line({ productKey: "TOM", rejectedQuantity: "10.0000" }),
      line({ claimLineId: "b", productKey: "EGG", sapItemCode: "EGG", description: "Eggs", unit: "TRAY", invoiceLineId: "il9", rejectedQuantity: "30.0000" }),
    ]);
    expect(rows.map((r) => [r.productKey, r.rejected, r.unit])).toEqual([
      ["EGG", "30", "TRAY"],
      ["TOM", "10", "KG"],
    ]);
  });

  it("reports the unit as null when one product's lines disagree", () => {
    const { rows } = aggregateClaimComposition([line({ unit: "KG" }), line({ claimLineId: "b", invoiceLineId: "il2", unit: "BOX" })]);
    expect(rows[0].unit).toBeNull();
  });

  it("returns the top reason per product and a reason summary that reconciles with the line count", () => {
    const { rows, summary } = aggregateClaimComposition([
      line({ claimLineId: "a", reasonCategory: "POOR_QUALITY_PRODUCT" }),
      line({ claimLineId: "b", invoiceLineId: "il2", reasonCategory: "POOR_QUALITY_PRODUCT" }),
      line({ claimLineId: "c", invoiceLineId: "il3", reasonCategory: "SHORT_DELIVERED" }),
      line({ claimLineId: "d", invoiceLineId: "il4", reasonCategory: null }),
    ]);
    expect(rows[0].topReason).toEqual({ reasonCategory: "POOR_QUALITY_PRODUCT", claimLineCount: 2 });
    expect(summary.byReason.reduce((s, r) => s + r.claimLineCount, 0)).toBe(summary.claimLineCount);
  });

  it("limits to the top products but keeps summary totals over everything", () => {
    const many = Array.from({ length: 5 }, (_, i) =>
      line({ claimLineId: `l${i}`, productKey: `P${i}`, invoiceLineId: `il${i}`, rejectedQuantity: `${i + 1}.0000` })
    );
    const { rows, summary } = aggregateClaimComposition(many, { topProducts: 2 });
    expect(rows.map((r) => r.productKey)).toEqual(["P4", "P3"]);
    expect(summary.productCount).toBe(5);
    expect(summary.claimLineCount).toBe(5);
  });

  it("handles no claims", () => {
    const { rows, summary } = aggregateClaimComposition([]);
    expect(rows).toEqual([]);
    expect(summary).toMatchObject({ claimLineCount: 0, productCount: 0, valueByCurrency: [], byReason: [] });
  });
});
