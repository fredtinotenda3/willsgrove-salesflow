import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { parseCustomerPoExcel } from "@/lib/extraction/deterministic/excel";
import { validateExtractionResult } from "@/lib/extraction/schema";

async function buildWorkbookBuffer(rows: (string | number)[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("PO");
  rows.forEach((row) => sheet.addRow(row));
  return workbook.xlsx.writeBuffer() as unknown as Promise<Buffer>;
}

describe("parseCustomerPoExcel", () => {
  it("parses a real .xlsx workbook (round-tripped through exceljs) -- never calls an AI provider", async () => {
    const buffer = await buildWorkbookBuffer([
      ["Description", "Quantity", "Unit"],
      ["Baby Marrow 250G Punnet", 10, "PNT"],
      ["Tomatoes Box", 5, "BOX"],
    ]);

    const result = await parseCustomerPoExcel(buffer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.classification).toBe("CUSTOMER_PO");
      expect(result.result.lines).toHaveLength(2);
      expect(result.result.lines[0]).toMatchObject({
        originalDescription: "Baby Marrow 250G Punnet",
        extractedQuantity: "10",
        extractedUnit: "PNT",
      });
      expect(validateExtractionResult(result.result).ok).toBe(true);
    }
  });

  it("reads a numeric Excel cell as a plain decimal string, not a float artifact", async () => {
    const buffer = await buildWorkbookBuffer([
      ["Item", "Qty"],
      ["Onions 1kg bag", 8],
    ]);
    const result = await parseCustomerPoExcel(buffer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.lines[0]!.extractedQuantity).toBe("8");
    }
  });

  it("skips a fully blank row", async () => {
    const buffer = await buildWorkbookBuffer([
      ["Description", "Quantity"],
      ["Baby Marrow 250G Punnet", 10],
      ["", ""],
      ["Tomatoes Box", 5],
    ]);
    const result = await parseCustomerPoExcel(buffer);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.lines).toHaveLength(2);
    }
  });

  it("fails clearly when the header row has no description-like column", async () => {
    const buffer = await buildWorkbookBuffer([
      ["Foo", "Bar"],
      [1, 2],
    ]);
    const result = await parseCustomerPoExcel(buffer);
    expect(result.ok).toBe(false);
  });

  it("fails clearly on a corrupted/non-xlsx buffer rather than throwing out of the function", async () => {
    const result = await parseCustomerPoExcel(Buffer.from("not an xlsx file"));
    expect(result.ok).toBe(false);
  });
});
