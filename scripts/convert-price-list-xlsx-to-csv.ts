/**
 * Real Business Data Onboarding round -- business-data delivery fix.
 *
 * The user asked that every dataset that needs importing live in
 * business-data/ as a CSV (the UI's price-list importer accepts CSV --
 * see app/price-lists/import/page.tsx -- and .xlsx directly, both paths
 * share lib/price-list-import.ts's plan/execute engine; this script
 * produces the CSV so the operator has a reviewable, diffable, plain-
 * text artifact rather than only the original binary workbook).
 *
 * Deliberately reuses lib/sap-price-list-xlsx.ts's own
 * parseSapPriceListXlsxBuffer() -- the SAME parser the app's own .xlsx
 * upload path already uses and that Phase 4a's tests already cover --
 * rather than re-deriving the business rules (price-list-code-by-column-
 * mode, item-code zero-padding, blank-price skipping, trusting Manual='Y'
 * rows as-is) a second time in a one-off script, which would risk the
 * converted CSV silently disagreeing with what the app itself would have
 * computed from the same source file.
 *
 * Usage:
 *   npx tsx --conditions=react-server scripts/convert-price-list-xlsx-to-csv.ts <input.xlsx> <output.csv>
 *
 * Writes a CSV in exactly the shape lib/sap-price-list-csv.ts's
 * parseSapPriceListCsv() (and so the UI's CSV upload path) expects:
 * PRICE_LIST_CODE,PRICE_LIST_NAME,CURRENCY,ITEM_CODE,UNIT_PRICE,VALID_FROM,VALID_TO
 *
 * PRICE_LIST_NAME is set to the source sheet's own tab name (the same
 * convention lib/sap-price-list-xlsx.ts documents for its own direct
 * .xlsx path) -- never invented. VALID_TO is always blank (open-ended),
 * matching the direct .xlsx path's own documented onboarding decision:
 * the source has no validity-date dimension at all.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parseSapPriceListXlsxBuffer } from "../lib/sap-price-list-xlsx";

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

async function main() {
  const [, , inputPath, outputPath] = process.argv;
  if (!inputPath || !outputPath) {
    console.error("Usage: convert-price-list-xlsx-to-csv.ts <input.xlsx> <output.csv>");
    process.exit(1);
  }

  const buffer = readFileSync(inputPath);
  const result = await parseSapPriceListXlsxBuffer(buffer);

  if (result.errors.length > 0) {
    console.error(`${result.errors.length} error(s) while reading ${inputPath}:`);
    for (const e of result.errors) console.error(`  - ${e.message}`);
  }

  if (!result.success) {
    console.error("Conversion failed -- no CSV written.");
    process.exit(1);
  }

  const header = "PRICE_LIST_CODE,PRICE_LIST_NAME,CURRENCY,ITEM_CODE,UNIT_PRICE,VALID_FROM,VALID_TO";
  const lines = result.rows.map((r) =>
    [r.priceListCode, r.priceListName, r.currencyCode, r.itemCode, r.unitPrice, r.validFrom, r.validTo ?? ""]
      .map(csvField)
      .join(","),
  );

  writeFileSync(outputPath, [header, ...lines].join("\r\n") + "\r\n", "utf-8");

  console.log(`Wrote ${result.rows.length} price-list entries across ${result.sheets.length} sheet(s) to ${outputPath}.`);
  console.log(`Sheets: ${result.sheets.map((s) => `${s.sheetName} -> ${s.priceListCode} (${s.pricedRowCount}/${s.dataRowCount} priced)`).join("; ")}`);
  console.log(`Skipped ${result.skippedBlankPriceCount} blank-price row(s) (never fabricated as 0).`);
}

main();
