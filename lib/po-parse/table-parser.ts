/**
 * Tabular purchase orders (PDF text layer, OCR, pasted spreadsheet rows).
 *
 * Strategy: find the header row (Item Code / Description / Qty / Unit Cost ...),
 * then read each following row by its column positions, falling back to
 * right-anchored number parsing so rows survive small alignment drift.
 * Totals, page furniture and repeated headers are ignored.
 */
import type { ParsedLine } from "@/lib/po-parse/types";
import { canonicalUnit, parsePackSize, parseQuantityNumber, toDecimalString } from "@/lib/po-parse/units";
import { splitCells } from "@/lib/po-parse/header";

type ColumnKind = "code" | "description" | "qty" | "unit" | "price" | "pack" | "value" | "ref";
type Column = { kind: ColumnKind; start: number };

const HEADER_WORDS: Array<[RegExp, ColumnKind]> = [
  [/^(item\s*code|code|sku|product\s*code|stock\s*code|item\s*no\.?|item\s*#|barcode|plu)$/i, "code"],
  [/^(item\s*description|description|desc\.?|product|product\s*description|item|details?|article)$/i, "description"],
  [/^(qty|quantity|qnty|order\s*qty|ordered|units?\s*ordered|no\.?\s*of\s*units|units)$/i, "qty"],
  [/^(uom|unit|unit\s*of\s*measure|measure)$/i, "unit"],
  [/^(unit\s*cost|unit\s*price|price|cost|rate|price\s*each|cost\s*price)$/i, "price"],
  [/^(pack|pack\s*size|case\s*size)$/i, "pack"],
  [/^(line\s*value|line\s*total|total|value|amount|ext\.?\s*(?:price|cost))$/i, "value"],
  [/^(supp\s*ref|supplier\s*ref|supplier\s*code|ref|vendor\s*code)$/i, "ref"],
];

function classifyHeaderCell(text: string): ColumnKind | null {
  const t = text.trim();
  for (const [re, kind] of HEADER_WORDS) if (re.test(t)) return kind;
  return null;
}

type HeaderRow = { index: number; columns: Column[] };

function findHeaderRows(lines: string[]): HeaderRow[] {
  const rows: HeaderRow[] = [];
  lines.forEach((line, index) => {
    const cells = splitCells(line);
    const cols: Column[] = [];
    for (const cell of cells) {
      const kind = classifyHeaderCell(cell.text);
      if (kind && !cols.some((c) => c.kind === kind)) cols.push({ kind, start: cell.start });
    }
    const hasDesc = cols.some((c) => c.kind === "description");
    const hasQty = cols.some((c) => c.kind === "qty");
    if (hasDesc && hasQty && cols.length >= 3) rows.push({ index, columns: cols });
    else if (hasDesc && cols.length >= 2 && cells.length <= 6) rows.push({ index, columns: cols });
  });
  return rows;
}

const STOP_ROW = /^\s*(total\s*lines|total\s*units|order\s*totals?|total\s*gross|disc|sub\s*-?\s*total|grand\s*total|total\s*vat|vat\b|comment|managers?\s*signature|signature|authori[sz]ed|page\s*\d|notes?\s*:)/i;
const FURNITURE = /^\s*(?:\d{1,2}\/\d{1,2}\/\d{2,4}\s+\d{1,2}:\d{2}|purchase\s*order\b|supplier\b|tel\s*no|fax\s*no|order\s*status|deliver\s*to|date\s*ordered|order\s*no|expected\s*delivery)/i;

const NUMERIC = /^-?\d[\d,]*(?:\.\d+)?$/;

function num(text: string | undefined): number | null {
  if (!text) return null;
  const clean = text.replace(/[@$]/g, "").trim();
  if (!NUMERIC.test(clean)) return null;
  return parseQuantityNumber(clean.replace(/,(?=\d{3}\b)/g, ""));
}

/** Parse one data row against the header's columns. */
function parseRow(line: string, columns: Column[], lineNumber: number): ParsedLine | null {
  if (line.trim() === "" || STOP_ROW.test(line) || FURNITURE.test(line)) return null;
  const cells = splitCells(line).filter((c) => c.text !== "@");
  if (cells.length < 2) return null;

  const sorted = [...columns].sort((a, b) => a.start - b.start);
  const assigned: Partial<Record<ColumnKind, string>> = {};

  // Assign each cell to the nearest header column (numbers are right-aligned under their header, so use cell END vs next header START).
  for (const cell of cells) {
    let target: Column | null = null;
    for (let i = 0; i < sorted.length; i++) {
      const col = sorted[i]!;
      const next = sorted[i + 1];
      const inSpan = cell.start >= col.start - 4 && (!next || cell.start < next.start - 1);
      const numericRightAligned = NUMERIC.test(cell.text) && next && cell.end > col.start && cell.start < next.start + 2 && cell.end <= next.start + 6 && cell.start >= col.start - 12;
      if (inSpan || numericRightAligned) {
        target = col;
        if (inSpan) break;
      }
    }
    if (!target) target = [...sorted].reverse().find((c) => c.start <= cell.start + 2) ?? sorted[0]!;
    assigned[target.kind] = assigned[target.kind] ? `${assigned[target.kind]} ${cell.text}` : cell.text;
  }

  let description = (assigned.description ?? "").trim();
  let qtyText = assigned.qty;
  let code = assigned.code?.trim() ?? null;
  let price = num(assigned.price);

  // Fallback: description missing/empty or qty not numeric -> parse numbers from the right.
  if (!description || num(qtyText) === null) {
    const texts = cells.map((c) => c.text);
    const nums: number[] = [];
    let idx = texts.length - 1;
    while (idx > 0 && num(texts[idx]) !== null) {
      nums.unshift(num(texts[idx])!);
      idx--;
    }
    const descCells = texts.slice(0, idx + 1);
    if (!description) {
      const first = descCells[0];
      if (descCells.length > 1 && first && /^[A-Z0-9\-]{3,}$/i.test(first) && /\d/.test(first)) {
        code ??= first;
        description = descCells.slice(1).join(" ");
      } else description = descCells.join(" ");
    }
    if (nums.length >= 1 && num(qtyText) === null) qtyText = String(nums[0]);
    if (nums.length >= 2 && price === null) price = nums[1]!;
  }

  description = description.replace(/\s+/g, " ").trim();
  if (!/[A-Za-z]{2}/.test(description)) return null;
  const quantity = num(qtyText);
  const warnings: string[] = [];
  if (quantity === null || quantity <= 0) warnings.push("No quantity found on this row.");

  const unitCell = canonicalUnit(assigned.unit);
  const pack = parsePackSize(description);

  return {
    lineNumber,
    rawText: line.trim().replace(/\s{2,}/g, "  "),
    description,
    quantity: toDecimalString(quantity),
    unit: unitCell,
    packSize: pack ? pack.label : null,
    measureOnly: false,
    unitPrice: toDecimalString(price),
    customerItemCode: code && code.length <= 30 ? code : null,
    confidence: quantity !== null && quantity > 0 ? 0.9 : 0.4,
    warnings,
  };
}

export type TableResult = { lines: ParsedLine[]; headerLineIndex: number } | null;

/** Returns null when no table header is found (caller falls back to free-text parsing). */
export function parseTable(lines: string[]): TableResult {
  const headers = findHeaderRows(lines);
  if (headers.length === 0) return null;

  const out: ParsedLine[] = [];
  const first = headers[0]!;

  for (let h = 0; h < headers.length; h++) {
    const header = headers[h]!;
    const end = headers[h + 1]?.index ?? lines.length;
    for (let i = header.index + 1; i < end; i++) {
      const line = lines[i]!;
      if (STOP_ROW.test(line)) break;
      const row = parseRow(line, header.columns, out.length + 1);
      if (row && (row.quantity !== null || row.customerItemCode !== null)) {
        row.lineNumber = out.length + 1;
        out.push(row);
      }
    }
  }
  if (out.length === 0) return null;
  return { lines: out, headerLineIndex: first.index };
}
