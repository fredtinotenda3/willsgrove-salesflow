export interface SapProductRow {
  sapItemCode: string;
  itemName: string;
  barcode: string | null;
  category: string | null;
  sourceData: {
    CODE: string;
    "ITEM DESCRIPTION": string;
    BARCODE: string;
    "ITEM GROUP": string;
  };
}

export interface SapCsvError {
  row: number;
  message: string;
}

export interface SapCsvParseResult {
  success: boolean;
  products: SapProductRow[];
  errors: SapCsvError[];
  duplicateCodes: string[];
  totalRows: number;
}

const REQUIRED_HEADERS = [
  "CODE",
  "ITEM DESCRIPTION",
  "BARCODE",
  "ITEM GROUP",
] as const;

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let insideQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const character = input[i];

    if (insideQuotes) {
      if (character === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        field += character;
      }

      continue;
    }

    if (character === '"' && field.length === 0) {
      insideQuotes = true;
      continue;
    }

    if (character === ",") {
      record.push(field);
      field = "";
      continue;
    }

    if (character === "\n" || character === "\r") {
      if (character === "\r" && input[i + 1] === "\n") {
        i++;
      }

      record.push(field);

      if (record.some((value) => value.trim() !== "")) {
        records.push(record);
      }

      record = [];
      field = "";
      continue;
    }

    field += character;
  }

  if (insideQuotes) {
    throw new Error("CSV contains an unclosed quoted field.");
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);

    if (record.some((value) => value.trim() !== "")) {
      records.push(record);
    }
  }

  return records;
}

export function parseSapProductCsv(
  csvText: string
): SapCsvParseResult {
  const products: SapProductRow[] = [];
  const errors: SapCsvError[] = [];
  const duplicateCodes: string[] = [];

  const seenCodes = new Set<string>();

  const cleanedInput = csvText.replace(/^\uFEFF/, "");

  let records: string[][];

  try {
    records = parseCsvRecords(cleanedInput);
  } catch (error) {
    return {
      success: false,
      products: [],
      errors: [
        {
          row: 1,
          message:
            error instanceof Error
              ? error.message
              : "Unable to parse CSV file.",
        },
      ],
      duplicateCodes: [],
      totalRows: 0,
    };
  }

  if (records.length < 2) {
    return {
      success: false,
      products: [],
      errors: [
        {
          row: 1,
          message: "CSV must contain a header and at least one product row.",
        },
      ],
      duplicateCodes: [],
      totalRows: 0,
    };
  }

  const headers = records[0].map((header) =>
    header.trim().toUpperCase()
  );

  const expectedHeaders = [...REQUIRED_HEADERS];

  const missingHeaders = expectedHeaders.filter(
    (header) => !headers.includes(header)
  );

  const unexpectedHeaders = headers.filter(
    (header) => !expectedHeaders.includes(
      header as (typeof REQUIRED_HEADERS)[number]
    )
  );

  const repeatedHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index
  );

  if (
    missingHeaders.length > 0 ||
    unexpectedHeaders.length > 0 ||
    repeatedHeaders.length > 0
  ) {
    const messages: string[] = [];

    if (missingHeaders.length > 0) {
      messages.push(
        `Missing columns: ${missingHeaders.join(", ")}.`
      );
    }

    if (unexpectedHeaders.length > 0) {
      messages.push(
        `Unexpected columns: ${unexpectedHeaders.join(", ")}.`
      );
    }

    if (repeatedHeaders.length > 0) {
      messages.push(
        `Repeated columns: ${[...new Set(repeatedHeaders)].join(", ")}.`
      );
    }

    return {
      success: false,
      products: [],
      errors: [{ row: 1, message: messages.join(" ") }],
      duplicateCodes: [],
      totalRows: records.length - 1,
    };
  }

  const columnIndexes = {
    code: headers.indexOf("CODE"),
    description: headers.indexOf("ITEM DESCRIPTION"),
    barcode: headers.indexOf("BARCODE"),
    group: headers.indexOf("ITEM GROUP"),
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

    const sapItemCode = record[columnIndexes.code].trim();
    const itemName = record[columnIndexes.description].trim();
    const barcode = record[columnIndexes.barcode].trim();
    const category = record[columnIndexes.group].trim();

    if (!sapItemCode) {
      errors.push({
        row: rowNumber,
        message: "SAP product CODE is required.",
      });

      continue;
    }

    if (!itemName) {
      errors.push({
        row: rowNumber,
        message: `Product ${sapItemCode} has no ITEM DESCRIPTION.`,
      });

      continue;
    }

    if (seenCodes.has(sapItemCode)) {
      duplicateCodes.push(sapItemCode);

      errors.push({
        row: rowNumber,
        message: `Duplicate SAP product CODE: ${sapItemCode}.`,
      });

      continue;
    }

    seenCodes.add(sapItemCode);

    products.push({
      sapItemCode,
      itemName,
      barcode: barcode || null,
      category: category || null,
      sourceData: {
        CODE: sapItemCode,
        "ITEM DESCRIPTION": itemName,
        BARCODE: barcode,
        "ITEM GROUP": category,
      },
    });
  }

  return {
    success: errors.length === 0 && products.length > 0,
    products,
    errors,
    duplicateCodes: [...new Set(duplicateCodes)],
    totalRows: records.length - 1,
  };
}