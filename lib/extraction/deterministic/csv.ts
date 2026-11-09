/**
 * Milestone 2A. Deterministic CSV parser for a customer-submitted PO
 * (OrderSource.CSV) -- never calls an AI provider. Reuses the shared
 * low-level tokenizer from lib/csv-parser.ts (Milestone 1) rather than a
 * third hand-rolled CSV state machine.
 *
 * This is NOT lib/sap-product-csv.ts or the Milestone 1 SAP-export
 * parsers -- those have a fixed, documented SAP column layout (see
 * docs/sap-exports/). A customer's own PO in CSV form has no such
 * contract; see lib/extraction/deterministic/shared.ts for the loose
 * column-matching this implies.
 */
import { parseCsvRecords, stripBom } from "@/lib/csv-parser";
import { buildLinesFromRows, resolvePoColumns } from "@/lib/extraction/deterministic/shared";
import { PO_EXTRACTION_SCHEMA_VERSION, type ExtractionResult } from "@/lib/extraction/schema";

export type CsvPoParseResult = { ok: true; result: ExtractionResult } | { ok: false; message: string };

export function parseCustomerPoCsv(csvText: string): CsvPoParseResult {
  let records: string[][];
  try {
    records = parseCsvRecords(stripBom(csvText));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Unable to parse this CSV file." };
  }

  if (records.length === 0) {
    return { ok: false, message: "The CSV file is empty." };
  }

  const [headerRow, ...dataRows] = records;
  const resolution = resolvePoColumns(headerRow!);
  if (!resolution.ok) {
    return { ok: false, message: resolution.message };
  }

  const lines = buildLinesFromRows(dataRows, resolution.columns);

  return {
    ok: true,
    result: {
      schemaVersion: PO_EXTRACTION_SCHEMA_VERSION,
      classification: "CUSTOMER_PO",
      header: {
        customerNameRaw: null,
        storeOrBranchRaw: null,
        customerPoNumber: null,
        poDate: null,
        requestedDeliveryDate: null,
        deliveryAddressRaw: null,
        currencyRaw: null,
        senderInfoRaw: null,
      },
      lines,
    },
  };
}
