import { checkHeaders, parseCsvRecords, stripBom } from "@/lib/csv-parser";

// Column layout documented in full, with a real sample file, at
// docs/sap-exports/tax-codes.csv.md.
export interface TaxCodeRow {
  code: string;
  description: string | null;
  ratePercent: string; // kept as a decimal-shaped string; Prisma's Decimal
  // input accepts a string directly, and parsing to a JS number here would
  // risk float rounding on a tax rate -- the one kind of value in this
  // whole milestone where that actually matters.
  sourceData: {
    TAX_CODE: string;
    DESCRIPTION: string;
    RATE_PERCENT: string;
  };
}

export interface TaxCodeCsvError {
  row: number;
  message: string;
}

export interface TaxCodeCsvParseResult {
  success: boolean;
  rows: TaxCodeRow[];
  errors: TaxCodeCsvError[];
  duplicateCodes: string[];
  totalRows: number;
}

const REQUIRED_HEADERS = ["TAX_CODE", "DESCRIPTION", "RATE_PERCENT"] as const;

// Shape check only (sign, decimal places) -- the actual 0-100 range is
// enforced numerically below, not by this pattern. A pattern alone can't
// express "at most 3 integer digits AND the value is <= 100" (e.g.
// "150.00" matches \d{1,3} just as validly as "15.00" does), so the
// pattern here stays deliberately loose and isRatePercentInRange does the
// real bounds check.
const RATE_SHAPE_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;

// Zimbabwe's current standard VAT rate (15.5% from 1 Jan 2026) and a 0%
// zero-rated code both fit 0-100; a value outside that is almost
// certainly a data-entry mistake in the export, not a real rate, so it is
// rejected rather than imported as-is.
function isRatePercentInRange(value: string): boolean {
  if (!RATE_SHAPE_PATTERN.test(value)) return false;
  const numeric = Number(value);
  return numeric >= 0 && numeric <= 100;
}

export function parseSapTaxCodeCsv(csvText: string): TaxCodeCsvParseResult {
  const rows: TaxCodeRow[] = [];
  const errors: TaxCodeCsvError[] = [];
  const duplicateCodes: string[] = [];
  const seenCodes = new Set<string>();

  let records: string[][];

  try {
    records = parseCsvRecords(stripBom(csvText));
  } catch (error) {
    return {
      success: false,
      rows: [],
      errors: [
        {
          row: 1,
          message:
            error instanceof Error ? error.message : "Unable to parse CSV file.",
        },
      ],
      duplicateCodes: [],
      totalRows: 0,
    };
  }

  if (records.length < 2) {
    return {
      success: false,
      rows: [],
      errors: [
        { row: 1, message: "CSV must contain a header and at least one row." },
      ],
      duplicateCodes: [],
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
      duplicateCodes: [],
      totalRows: records.length - 1,
    };
  }

  const columnIndexes = {
    code: headers.indexOf("TAX_CODE"),
    description: headers.indexOf("DESCRIPTION"),
    rate: headers.indexOf("RATE_PERCENT"),
  };

  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    const rowNumber = index + 1;

    if (record.length !== headers.length) {
      errors.push({
        row: rowNumber,
        message: `Expected ${headers.length} columns but found ${record.length}.`,
      });
      continue;
    }

    const code = record[columnIndexes.code].trim();
    const description = record[columnIndexes.description].trim();
    const rateRaw = record[columnIndexes.rate].trim();

    if (!code) {
      errors.push({ row: rowNumber, message: "TAX_CODE is required." });
      continue;
    }

    if (seenCodes.has(code)) {
      duplicateCodes.push(code);
      errors.push({ row: rowNumber, message: `Duplicate TAX_CODE: ${code}.` });
      continue;
    }

    seenCodes.add(code);

    if (!isRatePercentInRange(rateRaw)) {
      errors.push({
        row: rowNumber,
        message: `RATE_PERCENT for ${code} must be a number from 0 to 100 with at most 2 decimal places (got "${rateRaw}").`,
      });
      continue;
    }

    rows.push({
      code,
      description: description || null,
      ratePercent: rateRaw,
      sourceData: {
        TAX_CODE: code,
        DESCRIPTION: description,
        RATE_PERCENT: rateRaw,
      },
    });
  }

  return {
    success: errors.length === 0 && rows.length > 0,
    rows,
    errors,
    duplicateCodes: [...new Set(duplicateCodes)],
    totalRows: records.length - 1,
  };
}
