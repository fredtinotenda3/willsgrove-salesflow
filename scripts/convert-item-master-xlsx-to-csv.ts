/**
 * Real Business Data Onboarding round -- business-data delivery fix.
 *
 * Unlike Prices.xlsx (scripts/convert-price-list-xlsx-to-csv.ts), the
 * real Items_List.xlsx export is ALREADY shaped exactly like the product
 * importer's own expected CSV columns (CODE, ITEM DESCRIPTION, BARCODE,
 * ITEM GROUP -- lib/sap-product-csv.ts's REQUIRED_HEADERS, confirmed by
 * direct inspection of the real file), so this is a direct, no-business-
 * -rule-needed passthrough: read each real cell value as a string
 * (never coerced through a number, so no risk of losing a leading zero
 * some future export might have) and CSV-encode it. Nothing is
 * invented, reformatted, or padded.
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/convert-item-master-xlsx-to-csv.ts <input.xlsx> <output.csv>
 */
import { readFileSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("text" in value && typeof (value as { text?: unknown }).text === "string") return (value as { text: string }).text;
    if ("result" in value) return cellToText((value as { result: ExcelJS.CellValue }).result);
    if ("richText" in value && Array.isArray((value as { richText?: unknown }).richText)) {
      return (value as { richText: Array<{ text?: string }> }).richText.map((p) => p.text ?? "").join("");
    }
  }
  return "";
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: convert-item-master-xlsx-to-csv.ts <input.xlsx> <output.csv>");
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await workbook.xlsx.load(readFileSync(inputPath) as any);
  const worksheet = workbook.worksheets[0];

  const headerRow = worksheet.getRow(1);
  const headerValues = (headerRow.values as ExcelJS.CellValue[] | undefined)?.slice(1) ?? [];
  const headers = headerValues.map((v) => cellToText(v).trim().toUpperCase());

  const required = ["CODE", "ITEM DESCRIPTION", "BARCODE", "ITEM GROUP"];
  const missing = required.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    console.error(`Source file is missing expected column(s): ${missing.join(", ")}. No CSV written.`);
    process.exit(1);
  }

  const lines: string[] = [];
  let rowCount = 0;
  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    rowCount++;
    const values = headers.map((h) => cellToText(row.getCell(headers.indexOf(h) + 1).value));
    lines.push(values.map(csvField).join(","));
  });

  writeFileSync(outputPath, [required.join(","), ...lines].join("\r\n") + "\r\n", "utf-8");
  console.log(`Wrote ${rowCount} item rows to ${outputPath}.`);
}

main();
