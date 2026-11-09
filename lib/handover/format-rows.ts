/**
 * Milestone 2C. Pure text formatting for the CSV and clipboard handover
 * formats, deliberately separated from lib/handover/build-handover-rows.ts
 * (which needs a real database) so this exact formatting logic -- the
 * part most worth getting right and easiest to get subtly wrong (quoting,
 * never silently dropping an unmatched line) -- is unit-testable
 * unconditionally, with no @prisma/client dependency anywhere in its
 * import graph. Only `import type` is taken from build-handover-rows.ts,
 * which TypeScript erases entirely at compile time, so importing the
 * shared row type here pulls in none of that module's runtime code.
 */
import type { HandoverRow } from "@/lib/handover/build-handover-rows";

const CSV_HEADER = ["Line", "SAP Item Code", "Official Description", "Quantity", "Unit", "Original Description", "Note"];

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function rowToCsvFields(row: HandoverRow): string[] {
  return [
    String(row.lineNumber),
    row.sapItemCode ?? "",
    row.officialDescription ?? "",
    row.quantity,
    row.unit,
    row.originalDescription,
    row.note ?? "",
  ];
}

/**
 * CRLF line endings throughout -- the conventional, widely-compatible
 * choice for a CSV meant to be opened in Excel, which is this format's
 * whole reason for existing (a lightweight alternative to the .xlsx
 * handover, per your approved scope). An unmatched line is never
 * skipped -- it's still a row, with an empty SAP Item Code/Official
 * Description and its `note` explaining why, so the invoice team sees
 * every line that needs attention rather than a file that's silently
 * short a row.
 */
export function rowsToCsvText(rows: HandoverRow[]): string {
  const allRows = [CSV_HEADER, ...rows.map(rowToCsvFields)];
  return allRows.map((fields) => fields.map(escapeCsvField).join(",")).join("\r\n") + "\r\n";
}

/**
 * Tab-separated, no header row, no quoting -- built specifically to be
 * pasted straight into a SAP Business One data-entry grid or a
 * spreadsheet, where an extra header row or CSV-style quoting would
 * itself need to be deleted before the paste is usable. Column order is
 * SAP item code, official description, quantity, unit, note -- the
 * original customer wording is deliberately left out of the clipboard
 * format (unlike CSV/Excel) since it has no use once pasted directly
 * into SAP and would just be another column to delete. An unmatched
 * line still gets a row, with its `note` in the last column, so it's
 * never silently missing from what gets pasted.
 */
export function rowsToClipboardText(rows: HandoverRow[]): string {
  return rows
    .map((row) => [row.sapItemCode ?? "", row.officialDescription ?? row.originalDescription, row.quantity, row.unit, row.note ?? ""].join("\t"))
    .join("\n");
}
