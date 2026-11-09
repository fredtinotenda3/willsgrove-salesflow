// Shared low-level CSV tokenizer for the Milestone 1 ("Master data from
// SAP") importers. lib/sap-product-csv.ts (Milestone 0) has its own copy
// of this exact state machine; it is intentionally left untouched here
// (it already shipped and is covered by tests) rather than refactored to
// import this file, so this change carries zero risk to that already
//-working, already-tested code path. Every new Milestone 1 parser
// (lib/sap-tax-code-csv.ts, lib/sap-item-master-csv.ts,
// lib/sap-price-list-csv.ts, lib/sap-customer-master-csv.ts) imports this
// instead of re-copying it a fourth and fifth time.
export function parseCsvRecords(input: string): string[][] {
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

export function stripBom(input: string): string {
  return input.replace(/^﻿/, "");
}

export interface HeaderCheckResult {
  ok: boolean;
  message?: string;
}

// Shared header validation: required columns must all be present, no
// unexpected columns, no column repeated. Used by every Milestone 1
// parser so a malformed file produces the same quality of error message
// regardless of which importer it was uploaded to.
export function checkHeaders(
  headers: string[],
  requiredHeaders: readonly string[]
): HeaderCheckResult {
  const missingHeaders = requiredHeaders.filter(
    (header) => !headers.includes(header)
  );
  const unexpectedHeaders = headers.filter(
    (header) => !requiredHeaders.includes(header)
  );
  const repeatedHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index
  );

  if (
    missingHeaders.length === 0 &&
    unexpectedHeaders.length === 0 &&
    repeatedHeaders.length === 0
  ) {
    return { ok: true };
  }

  const messages: string[] = [];

  if (missingHeaders.length > 0) {
    messages.push(`Missing columns: ${missingHeaders.join(", ")}.`);
  }

  if (unexpectedHeaders.length > 0) {
    messages.push(`Unexpected columns: ${unexpectedHeaders.join(", ")}.`);
  }

  if (repeatedHeaders.length > 0) {
    messages.push(
      `Repeated columns: ${[...new Set(repeatedHeaders)].join(", ")}.`
    );
  }

  return { ok: false, message: messages.join(" ") };
}
