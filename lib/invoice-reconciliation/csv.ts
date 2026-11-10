import { parseCsvRecords, stripBom } from "@/lib/csv-parser";

/**
 * Milestone 5 (SAP Invoice Reconciliation).
 *
 * Unlike every Milestone 1 master-data importer (fixed, required
 * headers -- lib/sap-customer-master-csv.ts and siblings), this importer
 * must be "adaptable to the actual SAP Business One export structure"
 * (spec section 3): the operator maps each target field to whichever
 * actual column their export uses, rather than this code assuming one
 * fixed header row. The shape assumed here is the common SAP B1
 * "flattened document rows" export -- one row per invoice LINE, with the
 * header-level columns (DocNum, CardCode, DocDate, ...) repeated on every
 * line of the same document -- grouped back into one header + N lines by
 * DOC_ENTRY (preferred) or DOC_NUM.
 */

export const HEADER_TARGET_FIELDS = [
  "docEntry",
  "docNum",
  "customerCode",
  "customerName",
  "invoiceDate",
  "currency",
  "documentStatus",
  "orderReference",
  "subtotal",
  "taxTotal",
  "total",
] as const;
export type HeaderTargetField = (typeof HEADER_TARGET_FIELDS)[number];

export const LINE_TARGET_FIELDS = [
  "lineNumber",
  "itemCode",
  "itemDescription",
  "quantity",
  "unitOfMeasure",
  "unitPrice",
  "discount",
  "taxCode",
  "lineTotal",
  "docLineNum",
] as const;
export type LineTargetField = (typeof LINE_TARGET_FIELDS)[number];

export type InvoiceColumnMapping = Record<HeaderTargetField | LineTargetField, string | null>;

// Only `docNum` and `quantity` are load-bearing for this importer to do
// anything useful at all -- every other field is "where available" per
// spec section 3. Enforced in validateColumnMapping below, not assumed.
export const REQUIRED_TARGET_FIELDS: (HeaderTargetField | LineTargetField)[] = ["docNum", "quantity"];

/** Case-insensitive, punctuation-light heuristics for the preview step's
 * suggested mapping -- the operator can always override every one of
 * these; nothing here is ever applied without their explicit confirm. */
const SUGGESTION_PATTERNS: Record<HeaderTargetField | LineTargetField, RegExp[]> = {
  docEntry: [/^doc.?entry$/i, /^internal.?(doc|document).?(id|number)$/i],
  docNum: [/^doc.?num$/i, /^invoice.?(no|num|number)$/i, /^inv.?no$/i],
  customerCode: [/^card.?code$/i, /^customer.?(code|sap.?code)$/i, /^bp.?code$/i],
  customerName: [/^card.?name$/i, /^customer.?name$/i, /^bp.?name$/i],
  invoiceDate: [/^doc.?date$/i, /^invoice.?date$/i, /^posting.?date$/i],
  currency: [/^doc.?cur(rency)?$/i, /^currency$/i],
  documentStatus: [/^doc.?status$/i, /^status$/i, /^cancelled$/i],
  orderReference: [/^num.?at.?card$/i, /^(customer|sales).?(po|order).?(ref|reference|number)$/i, /^comments?$/i],
  subtotal: [/^doc.?total.?before.?(disc|vat)$/i, /^sub.?total$/i],
  taxTotal: [/^vat.?sum$/i, /^tax.?total$/i, /^total.?vat$/i],
  total: [/^doc.?total$/i, /^grand.?total$/i, /^invoice.?total$/i],
  lineNumber: [/^line.?num$/i, /^line.?no$/i, /^row.?num$/i],
  itemCode: [/^item.?code$/i, /^sap.?item.?code$/i, /^product.?code$/i],
  itemDescription: [/^dscription$/i, /^item.?desc(ription)?$/i, /^description$/i],
  quantity: [/^quantity$/i, /^qty$/i],
  unitOfMeasure: [/^uom.?(code|entry)?$/i, /^unit.?of.?measure$/i, /^unit$/i],
  unitPrice: [/^price$/i, /^unit.?price$/i],
  discount: [/^disc.?prcnt$/i, /^discount(.?%)?$/i],
  taxCode: [/^vat.?group$/i, /^tax.?code$/i],
  lineTotal: [/^line.?total$/i, /^row.?total$/i],
  docLineNum: [/^line.?num$/i, /^doc.?line.?num$/i],
};

/** Returns a best-guess mapping from the uploaded file's actual header
 * row -- every field the operator hasn't been shown yet defaults to
 * `null` ("not mapped"), never guessed past what a name clearly implies. */
export function suggestColumnMapping(sourceHeaders: string[]): InvoiceColumnMapping {
  const mapping = Object.fromEntries(
    [...HEADER_TARGET_FIELDS, ...LINE_TARGET_FIELDS].map((field) => [field, null])
  ) as InvoiceColumnMapping;

  const used = new Set<string>();
  for (const field of [...HEADER_TARGET_FIELDS, ...LINE_TARGET_FIELDS]) {
    const patterns = SUGGESTION_PATTERNS[field];
    const match = sourceHeaders.find((header) => !used.has(header) && patterns.some((p) => p.test(header.trim())));
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }
  return mapping;
}

export interface ParsedCsvPreview {
  sourceHeaders: string[];
  totalDataRows: number;
  sampleRows: Record<string, string>[];
}

export type ParseCsvResult = { ok: true; preview: ParsedCsvPreview } | { ok: false; message: string };

/** Pure parse of the raw file into a header row + sample rows for the
 * column-mapping UI -- no field semantics applied yet. */
export function parseInvoiceCsvForPreview(csvText: string, sampleSize = 10): ParseCsvResult {
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

export interface ValidateMappingResult {
  ok: boolean;
  message?: string;
}

/** Confirms every required target field was mapped to a real column in
 * this file, and that no two target fields were mapped to the same
 * source column. Called before a confirm-import attempt is even parsed
 * with the mapping. */
export function validateColumnMapping(mapping: InvoiceColumnMapping, sourceHeaders: string[]): ValidateMappingResult {
  const missing = REQUIRED_TARGET_FIELDS.filter((field) => !mapping[field]);
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

export interface RawInvoiceLineRow {
  rowIndex: number; // 1-based, within the data rows (for error messages)
  docEntry: string | null;
  docNum: string | null;
  customerCode: string | null;
  customerName: string | null;
  invoiceDate: string | null;
  currency: string | null;
  documentStatus: string | null;
  orderReference: string | null;
  subtotal: string | null;
  taxTotal: string | null;
  total: string | null;
  lineNumber: string | null;
  itemCode: string | null;
  itemDescription: string | null;
  quantity: string | null;
  unitOfMeasure: string | null;
  unitPrice: string | null;
  discount: string | null;
  taxCode: string | null;
  lineTotal: string | null;
  docLineNum: string | null;
  rawSourceData: Record<string, string>;
}

export interface MappedRowError {
  rowIndex: number;
  message: string;
}

export interface ApplyMappingResult {
  rows: RawInvoiceLineRow[];
  errors: MappedRowError[];
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

/** Applies the operator's confirmed column mapping to every data row,
 * producing one RawInvoiceLineRow per CSV row (still ungrouped -- see
 * groupIntoInvoices below). Rejects only a row missing a required field
 * or whose quantity doesn't parse as a decimal at all; every other field
 * is carried through as whatever text was in that cell, or null when the
 * mapped column was blank or unmapped. */
export function applyColumnMapping(csvText: string, mapping: InvoiceColumnMapping): ApplyMappingResult {
  const records = parseCsvRecords(stripBom(csvText));
  const sourceHeaders = records[0].map((h) => h.trim());
  const colIndex = Object.fromEntries(sourceHeaders.map((h, i) => [h, i]));

  const get = (record: string[], field: HeaderTargetField | LineTargetField): string | null => {
    const column = mapping[field];
    if (!column) return null;
    const index = colIndex[column];
    if (index === undefined) return null;
    const value = (record[index] ?? "").trim();
    return value === "" ? null : value;
  };

  const rows: RawInvoiceLineRow[] = [];
  const errors: MappedRowError[] = [];

  for (let i = 1; i < records.length; i++) {
    const record = records[i];
    const rowIndex = i; // 1-based within data rows

    const docNum = get(record, "docNum");
    const quantityRaw = get(record, "quantity");
    const rowErrors: string[] = [];

    if (!docNum) rowErrors.push("missing an invoice number (DocNum)");

    let quantity: string | null = null;
    if (!quantityRaw) {
      rowErrors.push("missing a quantity");
    } else {
      quantity = normalizeDecimal(quantityRaw);
      if (quantity === null) rowErrors.push(`quantity "${quantityRaw}" is not a valid number`);
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
      customerCode: get(record, "customerCode"),
      customerName: get(record, "customerName"),
      invoiceDate: get(record, "invoiceDate"),
      currency: get(record, "currency")?.toUpperCase() ?? null,
      documentStatus: get(record, "documentStatus"),
      orderReference: get(record, "orderReference"),
      subtotal: normalizeOptionalDecimal(get(record, "subtotal")),
      taxTotal: normalizeOptionalDecimal(get(record, "taxTotal")),
      total: normalizeOptionalDecimal(get(record, "total")),
      lineNumber: get(record, "lineNumber"),
      itemCode: get(record, "itemCode"),
      itemDescription: get(record, "itemDescription"),
      quantity,
      unitOfMeasure: get(record, "unitOfMeasure"),
      unitPrice: normalizeOptionalDecimal(get(record, "unitPrice")),
      discount: normalizeOptionalDecimal(get(record, "discount")),
      taxCode: get(record, "taxCode"),
      lineTotal: normalizeOptionalDecimal(get(record, "lineTotal")),
      docLineNum: get(record, "docLineNum"),
      rawSourceData,
    });
  }

  return { rows, errors };
}

function normalizeOptionalDecimal(raw: string | null): string | null {
  if (raw === null) return null;
  return normalizeDecimal(raw);
}

export interface GroupedInvoiceHeader {
  groupKey: string;
  docEntry: string | null;
  docNum: string;
  customerCode: string | null;
  customerName: string | null;
  invoiceDate: string | null;
  currency: string | null;
  documentStatus: string | null;
  orderReference: string | null;
  subtotal: string | null;
  taxTotal: string | null;
  total: string | null;
  isCancelledOrReversed: boolean;
  lines: RawInvoiceLineRow[];
  firstRowSourceData: Record<string, string>;
}

// Deliberately a short, explicit, documented keyword list -- never a
// broad "contains any negative-sounding word" heuristic that could
// mislabel a perfectly normal status. Checked case-insensitively against
// documentStatus. The raw value is always preserved alongside this flag
// (SapInvoice.documentStatusRaw) so a human can correct a misclassification
// at a glance, never by editing this boolean directly.
const CANCELLED_STATUS_KEYWORDS = ["cancel", "cancelled", "canceled", "void", "voided", "reversed", "reversal"];

function looksCancelledOrReversed(documentStatus: string | null): boolean {
  if (!documentStatus) return false;
  const normalized = documentStatus.toLowerCase();
  return CANCELLED_STATUS_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/** Groups flat rows into one header + its lines, keyed by DocEntry when
 * every row in the group provides one, else DocNum -- spec section 11's
 * "use stable SAP document identifiers where available." Header-level
 * values are taken from the first row of each group; this importer does
 * not attempt to reconcile disagreeing header values across a group's own
 * rows (a real flat SAP export repeats them identically by construction). */
export function groupIntoInvoices(rows: RawInvoiceLineRow[]): GroupedInvoiceHeader[] {
  const groups = new Map<string, RawInvoiceLineRow[]>();
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
    const lines = groups.get(groupKey)!;
    const first = lines[0];
    return {
      groupKey,
      docEntry: first.docEntry,
      docNum: first.docNum!,
      customerCode: first.customerCode,
      customerName: first.customerName,
      invoiceDate: first.invoiceDate,
      currency: first.currency,
      documentStatus: first.documentStatus,
      orderReference: first.orderReference,
      subtotal: first.subtotal,
      taxTotal: first.taxTotal,
      total: first.total,
      isCancelledOrReversed: looksCancelledOrReversed(first.documentStatus),
      lines,
      firstRowSourceData: first.rawSourceData,
    };
  });
}
