import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseSapPriceListXlsxBuffer } from "@/lib/sap-price-list-xlsx";

const HEADER = ["Item No.", "Item Description", "Base Price List", "Factor", "Base Price", "Price", "Manual", "Stock UoM", "Pricing Unit"];

/**
 * Builds a one-sheet workbook matching the real business-data/Prices.xlsx
 * column layout exactly (see lib/sap-price-list-xlsx.ts's module comment
 * for how that layout was confirmed), so these tests exercise the actual
 * exceljs read path rather than a hand-rolled row-array stand-in.
 */
async function buildWorkbookBuffer(
  sheets: Array<{ name: string; rows: Array<[number | string, string, string, number, string | null, string | null, string]> }>
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  for (const sheet of sheets) {
    const worksheet = workbook.addWorksheet(sheet.name);
    worksheet.addRow(HEADER);
    for (const row of sheet.rows) {
      worksheet.addRow([row[0], row[1], row[2], row[3], row[4], row[5], row[6], "Manual", "Manual"]);
    }
  }
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer as ArrayBuffer);
}

describe("parseSapPriceListXlsxBuffer", () => {
  it("zero-pads a numeric Item No. to 4 digits and reads the Price column directly", async () => {
    const buffer = await buildWorkbookBuffer([
      {
        name: "SPAR PRICES",
        rows: [[1, "Banana per Kg", "SPARUSD", 1, "USD 0.70", "USD 0.70", "N"]],
      },
    ]);

    const result = await parseSapPriceListXlsxBuffer(buffer, "2026-11-18");

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      priceListCode: "SPARUSD",
      priceListName: "SPAR PRICES",
      currencyCode: "USD",
      itemCode: "0001",
      unitPrice: "0.70",
      validFrom: "2026-11-18",
      validTo: null,
    });
  });

  it("uppercases and leaves an alphanumeric Item No. unpadded", async () => {
    const buffer = await buildWorkbookBuffer([
      { name: "OK", rows: [["sw01", "Odd bin", "OKUSDBYO", 1, "USD 1.00", "USD 1.00", "N"]] },
    ]);

    const result = await parseSapPriceListXlsxBuffer(buffer);

    expect(result.rows[0].itemCode).toBe("SW01");
  });

  it("skips a row with a blank Price rather than fabricating 0, and tracks the count", async () => {
    const buffer = await buildWorkbookBuffer([
      {
        name: "BHOLA",
        rows: [
          [1, "Banana per Kg", "BHOLA", 1, "USD 0.70", "USD 0.70", "N"],
          [2, "Apple Fuji Per Kg", "BHOLA", 1, null, null, "N"],
        ],
      },
    ]);

    const result = await parseSapPriceListXlsxBuffer(buffer);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].itemCode).toBe("0001");
    expect(result.skippedBlankPriceCount).toBe(1);
  });

  it("trusts the Price column directly on a Manual override row, even though it disagrees with Base Price x Factor", async () => {
    // Mirrors the real anomaly found in business-data/Prices.xlsx (e.g.
    // TM sheet row 244, item 243): Base Price List references a
    // different list ("BHAGATJI"), Base Price is blank, Manual='Y', and
    // the final Price is simply authoritative on its own.
    const buffer = await buildWorkbookBuffer([
      { name: "TM", rows: [[243, "Special item", "BHAGATJI", 1, null, "USD 0.83", "Y"]] },
    ]);

    const result = await parseSapPriceListXlsxBuffer(buffer);

    // The sheet's OWN price-list code is still derived from the mode of
    // the column (see next test for the multi-row case) -- with only one
    // row, that row's own value is the mode, so this also confirms a
    // single BHAGATJI-sourced row doesn't accidentally create a stray
    // "BHAGATJI" price list when real rows exist elsewhere on the sheet.
    expect(result.rows[0].unitPrice).toBe("0.83");
  });

  it("derives each sheet's price-list code from the MODE of Base Price List, ignoring a minority of differently-sourced rows", async () => {
    const buffer = await buildWorkbookBuffer([
      {
        name: "hospitality",
        rows: [
          [1, "Banana per Kg", "HOSPI-USD", 1, null, "USD 1.00", "N"],
          [2, "Apple Fuji Per Kg", "HOSPI-USD", 1, "USD 2.00", "USD 2.00", "N"],
          [149, "Special item", "BHAGATJI", 1.2, "USD 2.02", "USD 0.80", "Y"],
        ],
      },
    ]);

    const result = await parseSapPriceListXlsxBuffer(buffer);

    expect(result.sheets).toEqual([{ sheetName: "hospitality", priceListCode: "HOSPI-USD", dataRowCount: 3, pricedRowCount: 3 }]);
    // All three rows -- including the BHAGATJI-sourced one -- land under
    // the sheet's own HOSPI-USD code, never under "BHAGATJI".
    expect(result.rows.every((r) => r.priceListCode === "HOSPI-USD")).toBe(true);
  });

  it("reads multiple sheets as independent price lists", async () => {
    const buffer = await buildWorkbookBuffer([
      { name: "SPAR PRICES", rows: [[1, "Banana per Kg", "SPARUSD", 1, "USD 0.70", "USD 0.70", "N"]] },
      { name: "FRESH PLUG", rows: [[1, "Banana per Kg", "THEFRESHPLUG", 1, "USD 0.55", "USD 0.55", "N"]] },
    ]);

    const result = await parseSapPriceListXlsxBuffer(buffer);

    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.priceListCode).sort()).toEqual(["SPARUSD", "THEFRESHPLUG"]);
  });

  it("reports a row error rather than guessing when Price doesn't match the expected 'USD <amount>' format", async () => {
    const buffer = await buildWorkbookBuffer([
      { name: "OK", rows: [[1, "Banana per Kg", "OKUSDBYO", 1, "0.70", "ZWG 0.70", "N"]] },
    ]);

    const result = await parseSapPriceListXlsxBuffer(buffer);

    expect(result.success).toBe(false);
    expect(result.rows).toHaveLength(0);
    expect(result.errors[0].message).toContain("not in the expected");
  });

  it("reports a sheet-level error, and skips only that sheet, when a sheet has no Base Price List value at all", async () => {
    const buffer = await buildWorkbookBuffer([
      { name: "SPAR PRICES", rows: [[1, "Banana per Kg", "SPARUSD", 1, "USD 0.70", "USD 0.70", "N"]] },
      { name: "empty", rows: [[1, "Nothing priced", "", 1, null, null, "N"]] },
    ]);

    const result = await parseSapPriceListXlsxBuffer(buffer);

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].priceListCode).toBe("SPARUSD");
    expect(result.errors.some((e) => e.message.includes('Sheet "empty"'))).toBe(true);
  });
});
