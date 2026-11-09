/**
 * Milestone 2A. Shared column-matching and line-building logic for the
 * deterministic Excel/CSV parsers (lib/extraction/deterministic/excel.ts,
 * csv.ts). Per the refinement to the Milestone 2 report: "use deterministic
 * parsing wherever possible... do not unnecessarily send structured
 * Excel/CSV data to an AI provider" -- neither of those two parsers calls
 * any AI provider; this file is their shared, non-AI logic.
 *
 * Stated assumption, not yet confirmed (flag this honestly rather than
 * guessing silently): unlike the Milestone 1 SAP exports, a customer's PO
 * spreadsheet has no fixed, documented column layout -- it's whatever the
 * customer happens to send. This resolver therefore matches headers
 * loosely (case-insensitive, a handful of common synonyms) rather than
 * requiring an exact column set the way lib/csv-parser.ts's checkHeaders
 * does for the SAP exports. If a real sample customer PO spreadsheet
 * turns out to use a layout these patterns don't recognize, that's new
 * information to fold into this resolver, not a sign it was built wrong.
 */
import type { ExtractionLine } from "@/lib/extraction/schema";

export type PoColumnMap = {
  description: number;
  quantity: number;
  unit: number | null;
  unitPrice: number | null;
};

export type ColumnResolution = { ok: true; columns: PoColumnMap } | { ok: false; message: string };

function findColumn(headers: string[], patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const index = headers.findIndex((header) => pattern.test(header));
    if (index !== -1) return index;
  }
  return -1;
}

const DESCRIPTION_PATTERNS = [/^description$/i, /^item description$/i, /^product$/i, /desc/i, /product/i, /item/i];
const QUANTITY_PATTERNS = [/^quantity$/i, /^qty$/i, /quantity/i, /qty/i];
// "unit price" must be checked before the bare "unit" pattern so a
// "Unit Price" column is never mistaken for the unit-of-measure column.
const UNIT_PATTERNS = [/^unit$/i, /^uom$/i, /^unit of measure$/i];
const UNIT_PRICE_PATTERNS = [/unit price/i, /^price$/i];

export function resolvePoColumns(rawHeaders: string[]): ColumnResolution {
  const headers = rawHeaders.map((header) => header.trim());

  const description = findColumn(headers, DESCRIPTION_PATTERNS);
  if (description === -1) {
    return {
      ok: false,
      message:
        'Could not find a product description column (expected a header containing "description", "item", or "product").',
    };
  }

  const quantity = findColumn(headers, QUANTITY_PATTERNS);
  if (quantity === -1) {
    return {
      ok: false,
      message: 'Could not find a quantity column (expected a header containing "quantity" or "qty").',
    };
  }

  const unitPriceIndex = findColumn(headers, UNIT_PRICE_PATTERNS);
  const unitIndex = findColumn(
    headers.map((header, index) => (index === unitPriceIndex ? "" : header)),
    UNIT_PATTERNS
  );

  return {
    ok: true,
    columns: {
      description,
      quantity,
      unit: unitIndex === -1 ? null : unitIndex,
      unitPrice: unitPriceIndex === -1 ? null : unitPriceIndex,
    },
  };
}

const DECIMAL_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;

/**
 * Validates a cell's text as the decimal-string shape every quantity/price
 * field in this project uses, WITHOUT failing the whole row -- an
 * unparseable cell becomes null with a warning on that one line, the same
 * "warn, don't block" principle the Milestone 1 importers already follow
 * for recoverable per-row issues.
 */
function sanitizeDecimalCell(raw: string | undefined): { value: string | null; warning: string | null } {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return { value: null, warning: null };
  }
  if (!DECIMAL_PATTERN.test(trimmed) || Number(trimmed) <= 0) {
    return { value: null, warning: `Could not read "${trimmed}" as a positive number.` };
  }
  return { value: trimmed, warning: null };
}

/**
 * Builds ExtractionLine rows from already-tokenized data rows (one
 * string[] per row, already excluding the header row) and a resolved
 * column map. Shared by both the CSV and Excel deterministic parsers so
 * they differ only in how they turn their respective file format into
 * string[][] in the first place.
 */
export function buildLinesFromRows(rows: string[][], columns: PoColumnMap): ExtractionLine[] {
  const lines: ExtractionLine[] = [];
  let lineNumber = 0;

  for (const row of rows) {
    const description = (row[columns.description] ?? "").trim();
    if (description === "") {
      // A row with no description at all isn't a line -- most commonly a
      // blank trailing row in the sheet; silently skipped, not warned
      // about, since it carries no information to flag.
      continue;
    }

    lineNumber += 1;

    const quantityCell = sanitizeDecimalCell(row[columns.quantity]);
    const priceCell = columns.unitPrice !== null ? sanitizeDecimalCell(row[columns.unitPrice]) : { value: null, warning: null };
    const unit = columns.unit !== null ? (row[columns.unit] ?? "").trim() : "";

    const warnings: string[] = [];
    if (quantityCell.warning) warnings.push(quantityCell.warning);
    if (priceCell.warning) warnings.push(priceCell.warning);
    if (quantityCell.value === null && !quantityCell.warning) {
      warnings.push("No quantity stated for this line -- flag for manual entry.");
    }

    lines.push({
      lineNumber,
      originalDescription: description,
      extractedQuantity: quantityCell.value,
      extractedUnit: unit === "" ? null : unit,
      customerProvidedUnitPrice: priceCell.value,
      sourcePageOrImageRef: null,
      confidence: quantityCell.value !== null ? 0.95 : 0.5,
      warnings,
    });
  }

  return lines;
}
