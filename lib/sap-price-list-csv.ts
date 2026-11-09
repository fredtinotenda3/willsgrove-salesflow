import { checkHeaders, parseCsvRecords, stripBom } from "@/lib/csv-parser";

// Column layout documented in full, with a real sample row (item 0228,
// 0.45 USD, matching invoice HRE580108), at
// docs/sap-exports/price-lists.csv.md. One denormalized row per item per
// list -- simpler for a SAP read-only export/view to produce than two
// separate header/line files.
export interface PriceListEntryRow {
  priceListCode: string;
  priceListName: string;
  currencyCode: string;
  itemCode: string;
  unitPrice: string; // kept as a decimal-shaped string, same reasoning as
  // TaxCodeRow.ratePercent -- this is money, float rounding is not
  // acceptable.
  validFrom: string; // YYYY-MM-DD
  validTo: string | null; // YYYY-MM-DD or null (open-ended)
  sourceData: {
    PRICE_LIST_CODE: string;
    PRICE_LIST_NAME: string;
    CURRENCY: string;
    ITEM_CODE: string;
    UNIT_PRICE: string;
    VALID_FROM: string;
    VALID_TO: string;
  };
}

export interface PriceListCsvError {
  row: number;
  message: string;
}

export interface PriceListCsvParseResult {
  success: boolean;
  rows: PriceListEntryRow[];
  errors: PriceListCsvError[];
  totalRows: number;
}

const REQUIRED_HEADERS = [
  "PRICE_LIST_CODE",
  "PRICE_LIST_NAME",
  "CURRENCY",
  "ITEM_CODE",
  "UNIT_PRICE",
  "VALID_FROM",
  "VALID_TO",
] as const;

const PRICE_PATTERN = /^\d+(\.\d{1,4})?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function isRealCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function parseSapPriceListCsv(csvText: string): PriceListCsvParseResult {
  const rows: PriceListEntryRow[] = [];
  const errors: PriceListCsvError[] = [];

  // A price-list code must describe the same list (name + currency)
  // everywhere it appears in one file -- two conflicting header rows for
  // the same code is a malformed export, caught here rather than silently
  // picking whichever row happened to parse last.
  const listDefinitions = new Map<string, { name: string; currency: string; firstRow: number }>();

  let records: string[][];

  try {
    records = parseCsvRecords(stripBom(csvText));
  } catch (error) {
    return {
      success: false,
      rows: [],
      errors: [
        { row: 1, message: error instanceof Error ? error.message : "Unable to parse CSV file." },
      ],
      totalRows: 0,
    };
  }

  if (records.length < 2) {
    return {
      success: false,
      rows: [],
      errors: [{ row: 1, message: "CSV must contain a header and at least one row." }],
      totalRows: 0,
    };
  }

  const headers = records[0].map((header) => header.trim().toUpperCase());
  const headerCheck = checkHeaders(headers, REQUIRED_HEADERS);

  if (!headerCheck.ok) {
    return {
      success: false,
      rows: [],
      errors: [{ row: 1, message: headerCheck.message ?? "Invalid header row." }],
      totalRows: records.length - 1,
    };
  }

  const columnIndexes = {
    listCode: headers.indexOf("PRICE_LIST_CODE"),
    listName: headers.indexOf("PRICE_LIST_NAME"),
    currency: headers.indexOf("CURRENCY"),
    itemCode: headers.indexOf("ITEM_CODE"),
    price: headers.indexOf("UNIT_PRICE"),
    validFrom: headers.indexOf("VALID_FROM"),
    validTo: headers.indexOf("VALID_TO"),
  };

  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    const rowNumber = index + 1;

    if (record.length !== headers.length) {
      errors.push({ row: rowNumber, message: `Expected ${headers.length} columns but found ${record.length}.` });
      continue;
    }

    const priceListCode = record[columnIndexes.listCode].trim();
    const priceListName = record[columnIndexes.listName].trim();
    const currencyCode = record[columnIndexes.currency].trim().toUpperCase();
    const itemCode = record[columnIndexes.itemCode].trim();
    const unitPriceRaw = record[columnIndexes.price].trim();
    const validFrom = record[columnIndexes.validFrom].trim();
    const validToRaw = record[columnIndexes.validTo].trim();

    const rowErrors: string[] = [];

    if (!priceListCode) rowErrors.push("PRICE_LIST_CODE is required.");
    if (!priceListName) rowErrors.push("PRICE_LIST_NAME is required.");
    if (!CURRENCY_PATTERN.test(currencyCode)) rowErrors.push(`CURRENCY must be a 3-letter code (got "${currencyCode}").`);
    if (!itemCode) rowErrors.push("ITEM_CODE is required.");
    if (!PRICE_PATTERN.test(unitPriceRaw)) rowErrors.push(`UNIT_PRICE must be a non-negative number (got "${unitPriceRaw}").`);
    if (!isRealCalendarDate(validFrom)) rowErrors.push(`VALID_FROM must be a real date in YYYY-MM-DD format (got "${validFrom}").`);
    if (validToRaw && !isRealCalendarDate(validToRaw)) rowErrors.push(`VALID_TO must be blank or a real date in YYYY-MM-DD format (got "${validToRaw}").`);
    if (validToRaw && isRealCalendarDate(validFrom) && isRealCalendarDate(validToRaw) && validToRaw < validFrom) {
      rowErrors.push("VALID_TO cannot be before VALID_FROM.");
    }

    if (priceListCode && priceListName && CURRENCY_PATTERN.test(currencyCode)) {
      const existingDefinition = listDefinitions.get(priceListCode);

      if (!existingDefinition) {
        listDefinitions.set(priceListCode, { name: priceListName, currency: currencyCode, firstRow: rowNumber });
      } else if (existingDefinition.name !== priceListName || existingDefinition.currency !== currencyCode) {
        rowErrors.push(
          `PRICE_LIST_CODE ${priceListCode} was already defined on row ${existingDefinition.firstRow} with a different PRICE_LIST_NAME/CURRENCY ("${existingDefinition.name}"/"${existingDefinition.currency}"). A price list code must describe the same list throughout the file.`
        );
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, message: rowErrors.join(" ") });
      continue;
    }

    rows.push({
      priceListCode,
      priceListName,
      currencyCode,
      itemCode,
      unitPrice: unitPriceRaw,
      validFrom,
      validTo: validToRaw || null,
      sourceData: {
        PRICE_LIST_CODE: priceListCode,
        PRICE_LIST_NAME: priceListName,
        CURRENCY: currencyCode,
        ITEM_CODE: itemCode,
        UNIT_PRICE: unitPriceRaw,
        VALID_FROM: validFrom,
        VALID_TO: validToRaw,
      },
    });
  }

  return {
    success: errors.length === 0 && rows.length > 0,
    rows,
    errors,
    totalRows: records.length - 1,
  };
}
