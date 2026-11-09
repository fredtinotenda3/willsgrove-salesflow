import { checkHeaders, parseCsvRecords, stripBom } from "@/lib/csv-parser";

// Column layout documented in full, with a real sample file (item 0228,
// matching invoice HRE580108), at
// docs/sap-exports/item-master-extension.csv.md.
//
// This import only EXTENDS products that already exist (from the
// Milestone 0 product import) -- it never creates a product. The real SAP
// item export confirmed to have CODE/ITEM DESCRIPTION/BARCODE/ITEM GROUP
// only, with no unit/VAT/price columns, so this is necessarily a second,
// separate SAP export, keyed by the same CODE.
export interface ItemMasterRow {
  code: string;
  unitOfMeasure: string | null;
  packSize: string | null;
  isVariableWeight: boolean;
  vatCode: string | null;
  sourceData: {
    CODE: string;
    UNIT_OF_MEASURE: string;
    PACK_SIZE: string;
    VARIABLE_WEIGHT: string;
    TAX_CODE: string;
  };
}

export interface ItemMasterCsvError {
  row: number;
  message: string;
}

export interface ItemMasterCsvWarning {
  row: number;
  code: string;
  field: "VARIABLE_WEIGHT";
  originalValue: string;
  message: string;
}

export interface ItemMasterCsvParseResult {
  success: boolean;
  rows: ItemMasterRow[];
  errors: ItemMasterCsvError[];
  warnings: ItemMasterCsvWarning[];
  duplicateCodes: string[];
  totalRows: number;
}

const REQUIRED_HEADERS = [
  "CODE",
  "UNIT_OF_MEASURE",
  "PACK_SIZE",
  "VARIABLE_WEIGHT",
  "TAX_CODE",
] as const;

const TRUE_VALUES = new Set(["Y", "YES", "TRUE", "1"]);
const FALSE_VALUES = new Set(["N", "NO", "FALSE", "0", ""]);

export function parseSapItemMasterCsv(csvText: string): ItemMasterCsvParseResult {
  const rows: ItemMasterRow[] = [];
  const errors: ItemMasterCsvError[] = [];
  const warnings: ItemMasterCsvWarning[] = [];
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
          message: error instanceof Error ? error.message : "Unable to parse CSV file.",
        },
      ],
      warnings: [],
      duplicateCodes: [],
      totalRows: 0,
    };
  }

  if (records.length < 2) {
    return {
      success: false,
      rows: [],
      errors: [{ row: 1, message: "CSV must contain a header and at least one row." }],
      warnings: [],
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
      warnings: [],
      duplicateCodes: [],
      totalRows: records.length - 1,
    };
  }

  const columnIndexes = {
    code: headers.indexOf("CODE"),
    unit: headers.indexOf("UNIT_OF_MEASURE"),
    pack: headers.indexOf("PACK_SIZE"),
    variableWeight: headers.indexOf("VARIABLE_WEIGHT"),
    taxCode: headers.indexOf("TAX_CODE"),
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
    const unitOfMeasure = record[columnIndexes.unit].trim();
    const packSize = record[columnIndexes.pack].trim();
    const variableWeightRaw = record[columnIndexes.variableWeight].trim();
    const taxCode = record[columnIndexes.taxCode].trim();

    if (!code) {
      errors.push({ row: rowNumber, message: "CODE is required." });
      continue;
    }

    if (seenCodes.has(code)) {
      duplicateCodes.push(code);
      errors.push({ row: rowNumber, message: `Duplicate CODE: ${code}.` });
      continue;
    }

    seenCodes.add(code);

    const upperVariableWeight = variableWeightRaw.toUpperCase();
    let isVariableWeight = false;

    if (TRUE_VALUES.has(upperVariableWeight)) {
      isVariableWeight = true;
    } else if (!FALSE_VALUES.has(upperVariableWeight)) {
      warnings.push({
        row: rowNumber,
        code,
        field: "VARIABLE_WEIGHT",
        originalValue: variableWeightRaw,
        message: `Item ${code} has an unrecognized VARIABLE_WEIGHT value ("${variableWeightRaw}"). Treated as "N" (not variable-weight).`,
      });
    }

    rows.push({
      code,
      unitOfMeasure: unitOfMeasure || null,
      packSize: packSize || null,
      isVariableWeight,
      vatCode: taxCode || null,
      sourceData: {
        CODE: code,
        UNIT_OF_MEASURE: unitOfMeasure,
        PACK_SIZE: packSize,
        VARIABLE_WEIGHT: variableWeightRaw,
        TAX_CODE: taxCode,
      },
    });
  }

  return {
    success: errors.length === 0 && rows.length > 0,
    rows,
    errors,
    warnings,
    duplicateCodes: [...new Set(duplicateCodes)],
    totalRows: records.length - 1,
  };
}
