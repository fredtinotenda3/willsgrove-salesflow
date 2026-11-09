/**
 * Milestone 2A. Deterministic Excel (.xlsx) parser for a customer-
 * submitted PO (OrderSource.EXCEL) -- never calls an AI provider. Reads
 * the FIRST worksheet only; row 1 is treated as the header row, matched
 * loosely (see lib/extraction/deterministic/shared.ts) rather than
 * against a fixed SAP layout, since a customer's own spreadsheet has no
 * such contract.
 *
 * Uses exceljs (added this milestone) purely for reading here; the same
 * library is the intended choice for Milestone 2C's .xlsx handover
 * *writing*, so the project depends on one Excel library, not two.
 */
import ExcelJS from "exceljs";
import { buildLinesFromRows, resolvePoColumns } from "@/lib/extraction/deterministic/shared";
import { PO_EXTRACTION_SCHEMA_VERSION, type ExtractionResult } from "@/lib/extraction/schema";

export type ExcelPoParseResult = { ok: true; result: ExtractionResult } | { ok: false; message: string };

function cellToText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === "object") {
    // Rich text / formula / hyperlink cell objects. Best-effort plain-text
    // extraction rather than failing the whole row over one styled cell.
    if ("text" in value && typeof (value as { text?: unknown }).text === "string") {
      return (value as { text: string }).text;
    }
    if ("result" in value) {
      return cellToText((value as { result: ExcelJS.CellValue }).result);
    }
    if ("richText" in value && Array.isArray((value as { richText?: unknown }).richText)) {
      return (value as { richText: Array<{ text?: string }> }).richText
        .map((part) => part.text ?? "")
        .join("");
    }
    return "";
  }

  return String(value).trim();
}

export async function parseCustomerPoExcel(buffer: Buffer): Promise<ExcelPoParseResult> {
  const workbook = new ExcelJS.Workbook();

  try {
    // exceljs's own index.d.ts declares a bogus ambient global
    // `interface Buffer extends ArrayBuffer {}` (see
    // node_modules/exceljs/index.d.ts) that merges with @types/node's
    // real, generic `Buffer<TArrayBuffer>` global interface and makes
    // the merged type incompatible with an actual Node Buffer value at
    // every call site -- a known upstream typing defect, not a runtime
    // one: ExcelJS's real JS implementation reads an ordinary Buffer
    // identically either way, and skipLibCheck doesn't suppress this
    // because the mismatch surfaces at the usage site, not inside the
    // .d.ts. The bare identifier `Buffer` resolves to the SAME merged,
    // broken ambient type the parameter already expects (so `as Buffer`
    // is a no-op here) -- `any` is the only cast that actually bypasses
    // it, scoped to this single call so it can't mask an unrelated type
    // error anywhere else in this function.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await workbook.xlsx.load(buffer as any);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `Unable to read this Excel file: ${error.message}` : "Unable to read this Excel file.",
    };
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    return { ok: false, message: "The Excel file has no readable worksheet." };
  }

  const rows: string[][] = [];
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const values = (row.values as ExcelJS.CellValue[]) ?? [];
    // exceljs's row.values is 1-indexed (index 0 is always undefined) --
    // drop it so column indices here line up with a plain 0-indexed
    // string[][], exactly like the CSV parser's output.
    rows.push(values.slice(1).map(cellToText));
  });

  if (rows.length === 0) {
    return { ok: false, message: "The Excel file's first worksheet has no rows." };
  }

  const [headerRow, ...dataRows] = rows;
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
