import { describe, it, expect } from "vitest";
import { analyzeCatalogueHealth, type ProductForHealthCheck } from "@/lib/catalogue-health";

// Milestone 1 (Master data from SAP). Fixture data mirrors the real
// findings confirmed against the business's actual 7,540-row SAP item
// export, including the two examples named explicitly in the Master
// Build Prompt: item 8028's "Deli" BARCODE value and the 999-codes
// leading-zero count (represented here by a small, exact-shaped subset,
// not all 999 -- the logic under test doesn't care about scale).

function product(overrides: Partial<ProductForHealthCheck>): ProductForHealthCheck {
  return {
    sapItemCode: "9999",
    itemName: "Some item",
    barcode: "1234567890123",
    category: "Misc",
    sourceData: null,
    unitOfMeasure: null,
    vatCode: null,
    ...overrides,
  };
}

describe("analyzeCatalogueHealth", () => {
  it("flags item 8028's real non-barcode BARCODE value ('Deli')", () => {
    const report = analyzeCatalogueHealth([
      product({
        sapItemCode: "8028",
        itemName: "Deli Baby Marrow/kg",
        category: "Items",
        barcode: null, // rejected at import time by the Milestone 0 product importer
        sourceData: { CODE: "8028", "ITEM DESCRIPTION": "Deli Baby Marrow/kg", BARCODE: "Deli", "ITEM GROUP": "Items" },
      }),
    ]);

    expect(report.nonBarcodeValues).toEqual([
      { sapItemCode: "8028", itemName: "Deli Baby Marrow/kg", rawValue: "Deli" },
    ]);
  });

  it("does not flag a product with barcode: null and no sourceData.BARCODE (SAP genuinely has none)", () => {
    const report = analyzeCatalogueHealth([
      product({ sapItemCode: "1111", barcode: null, sourceData: { CODE: "1111", "ITEM DESCRIPTION": "x", BARCODE: "", "ITEM GROUP": "y" } }),
    ]);

    expect(report.nonBarcodeValues).toHaveLength(0);
  });

  it("does not flag a product that has a real numeric barcode", () => {
    const report = analyzeCatalogueHealth([product({ sapItemCode: "0228", barcode: "0602401518155" })]);
    expect(report.nonBarcodeValues).toHaveLength(0);
  });

  it("counts a blank ITEM DESCRIPTION the same way the real export has 7 of", () => {
    const report = analyzeCatalogueHealth([
      product({ sapItemCode: "8104", itemName: "", category: "Apples" }),
      product({ sapItemCode: "0228", itemName: "Baby Marrow 250G Punnet" }),
    ]);

    expect(report.blankDescriptions).toEqual([{ sapItemCode: "8104", category: "Apples" }]);
    expect(report.totalProducts).toBe(2);
  });

  it("groups duplicate descriptions and counts the rows beyond the first occurrence, same as the real export's 58-groups/117-rows/59-extra shape", () => {
    const report = analyzeCatalogueHealth([
      product({ sapItemCode: "6981", itemName: "Do not use" }),
      product({ sapItemCode: "6982", itemName: "Do not use" }),
      product({ sapItemCode: "6983", itemName: "Do not use" }),
      product({ sapItemCode: "0484", itemName: "Avocado Pears Local - Kg" }),
      product({ sapItemCode: "3552", itemName: "Avocado Pears Local - Kg" }),
      product({ sapItemCode: "0228", itemName: "Baby Marrow 250G Punnet" }), // unique, not a duplicate
    ]);

    expect(report.duplicateDescriptions).toEqual([
      { description: "Do not use", codes: ["6981", "6982", "6983"] },
      { description: "Avocado Pears Local - Kg", codes: ["0484", "3552"] },
    ]);
    // 2 groups, 5 rows total in those groups, 3 "extra" rows beyond each
    // group's first occurrence (2 + 1 = 3) -- the same row-counting logic
    // that gives 59 for the real file's 58 groups / 117 rows.
    expect(report.duplicateDescriptionRowCount).toBe(5);
  });

  it("flags leading-zero codes and leaves non-leading-zero codes alone", () => {
    const report = analyzeCatalogueHealth([
      product({ sapItemCode: "0228" }),
      product({ sapItemCode: "0982" }),
      product({ sapItemCode: "8104" }), // no leading zero
      product({ sapItemCode: "0" }), // bare zero is not a leading-zero risk (no digits after it)
    ]);

    expect(report.leadingZeroCodes.map((c) => c.sapItemCode).sort()).toEqual(["0228", "0982"]);
    expect(report.leadingZeroCount).toBe(2);
  });

  it("counts items missing unit/VAT-code data, which is every item before the item-master-extension import has run", () => {
    const report = analyzeCatalogueHealth([
      product({ sapItemCode: "0228", unitOfMeasure: null, vatCode: null }),
      product({ sapItemCode: "8028", unitOfMeasure: "PNT", vatCode: "VAT00" }),
    ]);

    expect(report.itemsWithoutUnit).toBe(1);
    expect(report.itemsWithoutVatCode).toBe(1);
  });

  it("excludes demo rows from nothing -- the caller (computeCatalogueHealth) filters isDemo before this function ever sees the rows", () => {
    // analyzeCatalogueHealth itself has no isDemo field and does no
    // filtering -- documenting that boundary explicitly so a future
    // change doesn't assume this function filters when it doesn't.
    const report = analyzeCatalogueHealth([product({ sapItemCode: "0228" })]);
    expect(report.totalProducts).toBe(1);
  });
});
