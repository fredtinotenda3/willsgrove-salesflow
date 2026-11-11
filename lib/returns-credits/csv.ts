import { parseCsvRecords, stripBom } from "@/lib/csv-parser";

/**
 * Milestone 6B (Returns & Credit Notes). CSV import pipeline for SAP
 * credit notes -- confirmed design decision: build this in addition to
 * manual single-record entry, not instead of it (lib/returns-credits/
 * credit-notes.ts's recordCreditNoteManually() remains the other path
 * into the same CreditNote model).
 *
 * Deliberately mirrors lib/invoice-reconciliation/csv.ts's shape --
 * adaptable column mapping (spec precedent: an operator maps each target
 * field to whatever actual column their SAP B1 export uses, never a fixed
 * header row), stateless two-stage preview, grouping flattened export rows
 * back into one record per document.
 *
 * One deliberate simplification versus Milestone 5's importer: a
 * CreditNote has no line-item model at all (6A already tracks financial
 * exposure at the CLAIM level via ClaimResolution.approvedCreditAmount,
 * and the confirmed matching granularity for 6B is claim-level, not
 * line-level -- see lib/returns-credits/matching.ts). So `amount` here is
 * a HEADER-level target field, read from the first row of each grouped
 * document exactly like Milestone 5 reads `total` -- never summed across
 * a document's rows, even when the export is flattened with one row per
 * credit-note line, because a real SAP B1 export repeats header-level
 * totals identically on every line row of the same document (the same
 * assumption groupIntoInvoices relies on for `total`/`subtotal`/`taxTotal`).
 */

export const CREDIT_NOTE_TARGET_FIELDS = [
  "docEntry",
  "docNum",
  "baseInvoiceDocEntry",
  "baseInvoiceDocNum",
  "creditNoteDate",
  "currency",
  "amount",
  "notes",
] as const;
export type CreditNoteTargetField = (typeof CREDIT_NOTE_TARGET_FIELDS)[number];

export type CreditNoteColumnMapping = Record<CreditNoteTargetField, string | null>;

// Only docNum and amount are load-bearing -- everything else, including
// the base-invoice reference columns, is "where available." A credit
// note missing a base-invoice reference is still imported; it simply
// cannot be auto-matched (see matching.ts) and lands UNMATCHED for manual
// reconciliation, same philosophy as Milestone 5's unmatched queue.
export const REQUIRED_CREDIT_NOTE_FIELDS: CreditNoteTargetField[] = ["docNum", "amount"];

const SUGGESTION_PATTERNS: Record<CreditNoteTargetField, RegExp[]> = {
  docEntry: [/^doc.?entry$/i, /^internal.?(doc|document).?(id|number)$/i],
  docNum: [/^doc.?num$/i, /^credit.?(memo|note).?(no|num|number)$/i, /^cn.?no$/i],
  baseInvoiceDocEntry: [/^base.?(doc.?entry|entry)$/i, /^original.?invoice.?entry$/i, /^ref.?doc.?entry$/i],
  baseInvoiceDocNum: [/^base.?(doc.?num|invoice)$/i, /^original.?invoice.?(no|num|number)?$/i, /^ref.?invoice$/i],
  creditNoteDate: [/^doc.?date$/i, /^credit.?(memo|note).?date$/i, /^posting.?date$/i],
  currency: [/^doc.?cur(rency)?$/i, /^currency$/i],
  amount: [/^doc.?total$/i, /^credit.?(memo|note).?(amount|total)$/i, /^grand.?total$/i],
  notes: [/^comments?$/i, /^remarks?$/i, /^notes?$/i],
};

/** Best-guess mapping from the uploaded file's actual header row -- any
 * field not clearly implied by a header name defaults to `null`
 * ("not mapped"); the operator confirms or corrects every field before
 * anything is parsed for real. */
export function suggestCreditNoteColumnMapping(sourceHeaders: string[]): CreditNoteColumnMapping {
  const mapping = Object.fromEntries(
    CREDIT_NOTE_TARGET_FIELDS.map((field) => [field, null])
  ) as CreditNoteColumnMapping;

  const used = new Set<string>();
  for (const field of CREDIT_NOTE_TARGET_FIELDS) {
    const patterns = SUGGESTION_PATTERNS[field];
    const match = sourceHeaders.find((header) => !used.has(header) && patterns.some((p) => p.test(header.trim())));
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }
  return mapping;
}

export interface ParsedCreditNoteCsvPreview {
  sourceHeaders: string[];
  totalDataRows: number;
  sampleRows: Record<string, string>[];
}

export type ParseCreditNoteCsvResult =
  | { ok: true; preview: ParsedCreditNoteCsvPreview }
  | { ok: false; message: string };

/** Pure parse of the raw file into a header row + sample rows for the
 * column-mapping UI -- no field semantics applied yet. */
export function parseCreditNoteCsvForPreview(csvText: string, sampleSize = 10): ParseCreditNoteCsvResult {
  let records: string[][];
  try {
    records = parseCsvRecords(stripBom(csvText));
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Unable to parse this file." };
  }

  if (records.length < 2) {
    return { ok: false, message: "File must contain a header row and at least one data row." };
  }

  const sourceHeaders = records[0].map((h) => h.trim());
  if (sourceHeaders.some((h) => h === "")) {
    return { ok: false, message: "Every column must have a non-empty header name." };
  }
  if (new Set(sourceHeaders).size !== sourceHeaders.length) {
    return { ok: false, message: "Column headers must be unique." };
  }

  const dataRecords = records.slice(1);
  const sampleRows = dataRecords.slice(0, sampleSize).map((record) => {
    const row: Record<string, string> = {};
    sourceHeaders.forEach((header, i) => (row[header] = (record[i] ?? "").trim()));
    return row;
  });

  return { ok: true, preview: { sourceHeaders, totalDataRows: dataRecords.length, sampleRows } };
}

export interface ValidateCreditNoteMappingResult {
  ok: boolean;
  message?: string;
}

export function validateCreditNoteColumnMapping(
  mapping: CreditNoteColumnMapping,
  sourceHeaders: string[]
): ValidateCreditNoteMappingResult {
  const missing = REQUIRED_CREDIT_NOTE_FIELDS.filter((field) => !mapping[field]);
  if (missing.length > 0) {
    return { ok: false, message: `These fields must be mapped to a column before importing: ${missing.join(", ")}.` };
  }

  const mappedColumns = Object.values(mapping).filter((v): v is string => v !== null);
  for (const column of mappedColumns) {
    if (!sourceHeaders.includes(column)) {
      return { ok: false, message: `Mapped column "${column}" was not found in this file.` };
    }
  }
  const seen = new Set<string>();
  for (const column of mappedColumns) {
    if (seen.has(column)) {
      return { ok: false, message: `Column "${column}" cannot be mapped to more than one field.` };
    }
    seen.add(column);
  }

  return { ok: true };
}

export interface RawCreditNoteRow {
  rowIndex: number; // 1-based, within the data rows (for error messages)
  docEntry: string | null;
  docNum: string | null;
  baseInvoiceDocEntry: string | null;
  baseInvoiceDocNum: string | null;
  creditNoteDate: string | null;
  currency: string | null;
  amount: string | null;
  notes: string | null;
  rawSourceData: Record<string, string>;
}

export interface MappedCreditNoteRowError {
  rowIndex: number;
  message: string;
}

export interface ApplyCreditNoteMappingResult {
  rows: RawCreditNoteRow[];
  errors: MappedCreditNoteRowError[];
}

const DECIMAL_INPUT_PATTERN = /^-?\d+(\.\d+)?$/;

/** Lenient numeric normalization for arbitrary SAP export formatting
 * (thousands separators, surrounding whitespace) -- returns null (never
 * a guessed number) when the cleaned value still isn't a plain decimal. */
function normalizeDecimal(raw: string): string | null {
  const cleaned = raw.trim().replace(/,/g, "");
  if (cleaned === "") return null;
  return DECIMAL_INPUT_PATTERN.test(cleaned) ? cleaned : null;
}

function normalizeOptionalDecimal(raw: string | null): string | null {
  if (raw === null) return null;
  return normalizeDecimal(raw);
}

/** Applies the operator's confirmed column mapping to every data row,
 * producing one RawCreditNoteRow per CSV row (still ungrouped -- see
 * groupIntoCreditNotes below). Rejects only a row missing docNum or whose
 * amount doesn't parse as a decimal at all; every other field is carried
 * through as whatever text was in that cell, or null when the mapped
 * column was blank or unmapped. */
export function applyCreditNoteColumnMapping(csvText: string, mapping: CreditNoteColumnMapping): ApplyCreditNoteMappingResult {
  const records = parseCsvRecords(stripBom(csvText));
  const sourceHeaders = records[0].map((h) => h.trim());
  const colIndex = Object.fromEntries(sourceHeaders.map((h, i) => [h, i]));

  const get = (record: string[], field: CreditNoteTargetField): string | null => {
    const column = mapping[field];
    if (!column) return null;
    const index = colIndex[column];
    if (index === undefined) return null;
    const value = (record[index] ?? "").trim();
    return value === "" ? null : value;
  };

  const rows: RawCreditNoteRow[] = [];
  const errors: MappedCreditNoteRowError[] = [];

  for (let i = 1; i < records.length; i++) {
    const record = records[i];
    const rowIndex = i; // 1-based within data rows

    const docNum = get(record, "docNum");
    const amountRaw = get(record, "amount");
    const rowErrors: string[] = [];

    if (!docNum) rowErrors.push("missing a credit note number (DocNum)");

    let amount: string | null = null;
    if (!amountRaw) {
      rowErrors.push("missing an amount");
    } else {
      amount = normalizeDecimal(amountRaw);
      if (amount === null) rowErrors.push(`amount "${amountRaw}" is not a valid number`);
    }

    if (rowErrors.length > 0) {
      errors.push({ rowIndex, message: `Row ${rowIndex}: ${rowErrors.join("; ")}.` });
      continue;
    }

    const rawSourceData: Record<string, string> = {};
    sourceHeaders.forEach((header, idx) => (rawSourceData[header] = (record[idx] ?? "").trim()));

    rows.push({
      rowIndex,
      docEntry: get(record, "docEntry"),
      docNum,
      baseInvoiceDocEntry: get(record, "baseInvoiceDocEntry"),
      baseInvoiceDocNum: get(record, "baseInvoiceDocNum"),
      creditNoteDate: get(record, "creditNoteDate"),
      currency: get(record, "currency")?.toUpperCase() ?? null,
      amount: normalizeOptionalDecimal(amount),
      notes: get(record, "notes"),
      rawSourceData,
    });
  }

  return { rows, errors };
}

export interface GroupedCreditNoteRow {
  groupKey: string;
  docEntry: string | null;
  docNum: string;
  baseInvoiceDocEntry: string | null;
  baseInvoiceDocNum: string | null;
  creditNoteDate: string | null;
  currency: string | null;
  amount: string | null;
  notes: string | null;
  rows: RawCreditNoteRow[];
  firstRowSourceData: Record<string, string>;
}

/** Groups flat rows into one record per document, keyed by DocEntry when
 * every row in the group provides one, else DocNum -- same stable-
 * identifier preference as groupIntoInvoices. Header-level values
 * (including `amount`) are taken from the first row of each group; this
 * importer never sums a value across a group's own rows. */
export function groupIntoCreditNotes(rows: RawCreditNoteRow[]): GroupedCreditNoteRow[] {
  const groups = new Map<string, RawCreditNoteRow[]>();
  const order: string[] = [];

  for (const row of rows) {
    const key = row.docEntry ? `docEntry:${row.docEntry}` : `docNum:${row.docNum}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(row);
  }

  return order.map((groupKey) => {
    const groupRows = groups.get(groupKey)!;
    const first = groupRows[0];
    return {
      groupKey,
      docEntry: first.docEntry,
      docNum: first.docNum!,
      baseInvoiceDocEntry: first.baseInvoiceDocEntry,
      baseInvoiceDocNum: first.baseInvoiceDocNum,
      creditNoteDate: first.creditNoteDate,
      currency: first.currency,
      amount: first.amount,
      notes: first.notes,
      rows: groupRows,
      firstRowSourceData: first.rawSourceData,
    };
  });
}
