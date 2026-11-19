/**
 * Real Business Data Onboarding round (spec PART A, Phase 4a): reads the
 * REAL SAP price-list export the business actually has -- business-data/
 * Prices.xlsx -- directly, rather than requiring someone to hand-convert
 * it to the invented PRICE_LIST_CODE/.../VALID_TO CSV shape
 * lib/sap-price-list-csv.ts was built around. That CSV shape stays fully
 * supported (lib/price-list-import.ts's plan/execute engine is shared,
 * unmodified, by both input paths) -- this file is an ADDITIONAL input
 * format, not a replacement.
 *
 * Why a new parser rather than reshaping this into the CSV layout first
 * (the precedent lib/sap-customer-master-csv.ts set for the customer
 * master file): that file was a flat, single-table layout mismatch (fewer
 * columns than invented, still one row per record). This file is
 * structurally different -- SEVEN WORKSHEETS, each one entire price list,
 * every item repeated on every sheet whether or not that list prices it.
 * Converting that to one CSV would just move the same per-sheet logic
 * into a one-off conversion script; reading the workbook directly, sheet
 * by sheet, is the more honest shape for what this data actually is.
 *
 * Grounded facts below were confirmed by direct inspection of the real
 * business-data/Prices.xlsx (not guessed, per this round's binding
 * constraints -- "do not guess column names... do not fabricate business
 * data"):
 *
 *  - 7 worksheets: "SPAR PRICES", "FRESH PLUG", "OK", "TM", "BHOLA",
 *    "hospitality", "pnp usd". Every sheet shares one header row:
 *    Item No. | Item Description | Base Price List | Factor | Base Price
 *    | Price | Manual | Stock UoM | Pricing Unit -- 7605 data rows each.
 *  - Each sheet is overwhelmingly ONE SAP price-list code in column C
 *    ("Base Price List"): SPARUSD, THEFRESHPLUG, OKUSDBYO, TM-USD, BHOLA,
 *    HOSPI-USD, PNPUSD respectively. A handful of rows in OK/TM/hospitality
 *    reference a different code ("BHAGATJI") there instead -- see below.
 *  - Column F ("Price") is the final, already-resolved selling price,
 *    always formatted "USD <amount>" (2 decimal places, never negative or
 *    zero in the real file) or blank. Column E ("Base Price List")'s
 *    Factor/Base-Price derivation chain is SAP's internal pricing-rule
 *    bookkeeping, not something this importer needs to resolve: every
 *    row -- including the "Manual"='Y' rows, and the handful of
 *    "BHAGATJI"-sourced rows -- carries its OWN final Price directly.
 *    Confirmed by inspection: every row where Manual='Y' has a Price that
 *    does NOT simply equal Base Price x Factor (that's the point of the
 *    override), so re-deriving the price from the chain instead of
 *    reading column F would get those rows wrong. This file therefore
 *    ignores columns C ("Base Price List" on individual rows), D
 *    ("Factor"), E ("Base Price"), and G ("Manual") entirely for pricing
 *    purposes -- they're read only to pick each SHEET's own price-list
 *    code (see resolveSheetPriceListCode below) and to annotate
 *    sourceData for traceability.
 *  - A blank Price means "this list doesn't price this item" -- the
 *    overwhelming majority of rows on every sheet (1,074 to 7,398 blank
 *    out of 7,605, depending on the sheet). Never fabricated as 0; always
 *    skipped.
 *  - Item No. is a plain SAP-internal integer (1..9508, not contiguous)
 *    for all but 5 rows per sheet, which carry an alphanumeric code
 *    instead (P0001, P0000001, SW01, SW02, SW03). business-data/
 *    Items_List.xlsx's own CODE column confirms the exact join rule: a
 *    numeric Item No. must be zero-padded to 4 digits ("558" -> "0558")
 *    to match Product.sapItemCode; the 5 alphanumeric codes are used
 *    uppercased/trimmed, unpadded, and appear in Items_List.xlsx verbatim
 *    the same way.
 *  - No validity-date dimension exists anywhere in this source (no column
 *    resembling VALID_FROM/VALID_TO) -- see parseSapPriceListXlsx's
 *    `importDate` parameter for how that's handled.
 *
 * Spot-checked against business-data/Items_List.xlsx's own CODE column
 * (the real SAP item master extract, 7,540 codes): of the 6,532 distinct
 * item codes actually priced (non-blank Price) anywhere across all 7
 * sheets, only ONE ("7334") has no matching row there. That is a
 * spot-check against the raw extract, not the live Product table this
 * importer actually matches against (lib/price-list-import.ts's own
 * planPriceListImport already does that lookup, non-blockingly, against
 * whatever Products actually exist at import time) -- the real
 * unmatchedItemCodes count belongs to that live run, not to a number
 * hardcoded here.
 */
import ExcelJS from "exceljs";
import type { PriceListEntryRow } from "@/lib/sap-price-list-csv";

export interface PriceListXlsxError {
  row: number;
  message: string;
}

export interface SheetMapping {
  sheetName: string;
  priceListCode: string;
  dataRowCount: number;
  pricedRowCount: number;
}

export interface PriceListXlsxParseResult {
  success: boolean;
  rows: PriceListEntryRow[];
  errors: PriceListXlsxError[];
  totalRows: number;
  skippedBlankPriceCount: number;
  sheets: SheetMapping[];
}

const EXPECTED_HEADERS = [
  "ITEM NO.",
  "ITEM DESCRIPTION",
  "BASE PRICE LIST",
  "FACTOR",
  "BASE PRICE",
  "PRICE",
  "MANUAL",
] as const;

const PRICE_CELL_PATTERN = /^USD\s+(\d+(?:\.\d{1,4})?)$/i;

// exceljs's row.values / cell.value typings are broad (string | number |
// Date | RichText object | formula-result object | null | undefined).
// Unwraps the handful of non-primitive shapes actually seen in a SAP
// export, WITHOUT stringifying -- callers here need to distinguish "a
// real number" from "a numeric-looking string" to apply the right
// zero-pad rule, so this can't share lib/extraction/deterministic/
// excel.ts's cellToText (which collapses everything to string by design).
function unwrapCellValue(value: ExcelJS.CellValue): string | number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("result" in value) return unwrapCellValue((value as { result: ExcelJS.CellValue }).result);
    if ("text" in value && typeof (value as { text?: unknown }).text === "string") {
      return (value as { text: string }).text;
    }
    if ("richText" in value && Array.isArray((value as { richText?: unknown }).richText)) {
      return (value as { richText: Array<{ text?: string }> }).richText.map((p) => p.text ?? "").join("");
    }
    return null;
  }
  return null;
}

function canonicalItemCode(rawItemNo: string | number): string | null {
  if (typeof rawItemNo === "number") {
    if (!Number.isInteger(rawItemNo) || rawItemNo < 0) return null;
    return String(rawItemNo).padStart(4, "0");
  }
  const trimmed = rawItemNo.trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) return trimmed.padStart(4, "0");
  return trimmed.toUpperCase();
}

/**
 * Each sheet's own price-list code is derived from the MODE (most
 * frequent non-blank value) of its "Base Price List" column, rather than
 * a hardcoded sheet-name lookup table -- so a future re-export with a
 * renamed tab, or an extra sheet, still resolves correctly as long as the
 * column itself is consistent, instead of silently mis-filing every row
 * under a stale hardcoded code.
 */
function resolveSheetPriceListCode(values: Array<string | number | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (value === null) continue;
    const code = String(value).trim();
    if (!code) continue;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  let bestCode: string | null = null;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount) {
      bestCode = code;
      bestCount = count;
    }
  }
  return bestCode;
}

export async function parseSapPriceListXlsxBuffer(
  buffer: Buffer,
  importDate: string = new Date().toISOString().slice(0, 10)
): Promise<PriceListXlsxParseResult> {
  const workbook = new ExcelJS.Workbook();

  try {
    // Same upstream exceljs/@types/node Buffer typing clash documented in
    // lib/extraction/deterministic/excel.ts -- `any` is scoped to this one
    // call.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch (error) {
    return {
      success: false,
      rows: [],
      errors: [
        {
          row: 0,
          message:
            error instanceof Error ? `Unable to read this Excel file: ${error.message}` : "Unable to read this Excel file.",
        },
      ],
      totalRows: 0,
      skippedBlankPriceCount: 0,
      sheets: [],
    };
  }

  if (workbook.worksheets.length === 0) {
    return {
      success: false,
      rows: [],
      errors: [{ row: 0, message: "The Excel file has no worksheets." }],
      totalRows: 0,
      skippedBlankPriceCount: 0,
      sheets: [],
    };
  }

  const rows: PriceListEntryRow[] = [];
  const errors: PriceListXlsxError[] = [];
  const sheets: SheetMapping[] = [];
  let totalRows = 0;
  let skippedBlankPriceCount = 0;

  for (const worksheet of workbook.worksheets) {
    const sheetName = worksheet.name;
    const headerRow = worksheet.getRow(1);
    const headerValues = (headerRow.values as ExcelJS.CellValue[] | undefined)?.slice(1) ?? [];
    const headers = headerValues.map((v) => String(unwrapCellValue(v) ?? "").trim().toUpperCase());

    const missingHeaders = EXPECTED_HEADERS.filter((h) => !headers.includes(h));
    if (missingHeaders.length > 0) {
      errors.push({
        row: 0,
        message: `Sheet "${sheetName}": missing expected column(s) ${missingHeaders.join(", ")}. This sheet was not read.`,
      });
      continue;
    }

    const colItemNo = headers.indexOf("ITEM NO.");
    const colBaseList = headers.indexOf("BASE PRICE LIST");
    const colPrice = headers.indexOf("PRICE");

    // First pass: collect every row's Base Price List value to derive
    // this sheet's own price-list code (see resolveSheetPriceListCode).
    const baseListValues: Array<string | number | null> = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      baseListValues.push(unwrapCellValue(row.getCell(colBaseList + 1).value));
    });

    const priceListCode = resolveSheetPriceListCode(baseListValues);
    if (!priceListCode) {
      errors.push({ row: 0, message: `Sheet "${sheetName}": could not determine a price-list code (Base Price List column is empty throughout). This sheet was not read.` });
      continue;
    }

    let dataRowCount = 0;
    let pricedRowCount = 0;

    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;

      const rawItemNo = unwrapCellValue(row.getCell(colItemNo + 1).value);
      const rawPrice = unwrapCellValue(row.getCell(colPrice + 1).value);

      if (rawItemNo === null) return; // fully blank trailing row

      totalRows += 1;
      dataRowCount += 1;

      if (rawPrice === null || rawPrice === "") {
        skippedBlankPriceCount += 1;
        return;
      }

      const itemCode = canonicalItemCode(rawItemNo);
      if (!itemCode) {
        errors.push({ row: rowNumber, message: `Sheet "${sheetName}" row ${rowNumber}: unrecognized Item No. "${String(rawItemNo)}".` });
        return;
      }

      const priceMatch = typeof rawPrice === "string" ? PRICE_CELL_PATTERN.exec(rawPrice.trim()) : null;
      if (!priceMatch) {
        errors.push({
          row: rowNumber,
          message: `Sheet "${sheetName}" row ${rowNumber}, item ${itemCode}: Price "${String(rawPrice)}" is not in the expected "USD <amount>" format. Not imported -- verify by hand rather than guess at the intended value.`,
        });
        return;
      }

      pricedRowCount += 1;

      rows.push({
        priceListCode,
        priceListName: sheetName,
        currencyCode: "USD",
        itemCode,
        unitPrice: priceMatch[1],
        validFrom: importDate,
        validTo: null,
        sourceData: {
          PRICE_LIST_CODE: priceListCode,
          PRICE_LIST_NAME: sheetName,
          CURRENCY: "USD",
          ITEM_CODE: String(rawItemNo),
          UNIT_PRICE: priceMatch[1],
          VALID_FROM: importDate,
          VALID_TO: "",
        },
      });
    });

    sheets.push({ sheetName, priceListCode, dataRowCount, pricedRowCount });
  }

  return {
    success: errors.length === 0 && rows.length > 0,
    rows,
    errors,
    totalRows,
    skippedBlankPriceCount,
    sheets,
  };
}
