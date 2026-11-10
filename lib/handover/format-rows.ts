/**
 * Milestone 2C, reworked in Milestone 3C (SAP Invoice Handover
 * Specification). Pure text formatting for the CSV and clipboard
 * handover formats, deliberately separated from
 * lib/handover/build-handover-rows.ts (which needs a real database) so
 * this exact formatting logic -- the part most worth getting right and
 * easiest to get subtly wrong (quoting, never silently dropping an
 * unmatched line) -- is unit-testable unconditionally, with no
 * @prisma/client dependency anywhere in its import graph. Only
 * `import type` is taken from build-handover-rows.ts, which TypeScript
 * erases entirely at compile time, so importing the shared row type here
 * pulls in none of that module's runtime code.
 *
 * Milestone 3C: the spec's 4-column product table -- SAP Item Code,
 * Description, Quantity, Unit -- replaces the old 7-column layout (which
 * also carried a Line number, the customer's Original Description, and a
 * free-text Note column). The "never silently drop a flagged line"
 * principle this project has followed since Milestone 2C still holds,
 * just not by widening the 4-column grid itself: a flagged line (no SAP
 * match, an inactive product, a since-removed product with no live
 * description) still appears in the grid with whatever is actually known
 * (blank SAP code, the customer's own wording as a fallback
 * description), and CSV additionally lists every flagged line again,
 * with its reason, in a clearly separated section below the main table.
 * The clipboard format gets no such section (nowhere for it to go once
 * pasted, and it was never meant to be read, only pasted) -- its every
 * row is still real, never dropped, just without an explanation attached.
 */
import type { HandoverRow } from "@/lib/handover/build-handover-rows";

const CSV_HEADER = ["SAP Item Code", "Description", "Quantity", "Unit"];

function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function descriptionFor(row: HandoverRow): string {
  return row.officialDescription ?? row.originalDescription;
}

function rowToCsvFields(row: HandoverRow): string[] {
  return [row.sapItemCode ?? "", descriptionFor(row), row.quantity, row.unit];
}

/**
 * CRLF line endings throughout -- the conventional, widely-compatible
 * choice for a CSV meant to be opened in Excel, which is this format's
 * whole reason for existing (a lightweight alternative to the .xlsx
 * handover, per your approved scope). An unmatched line is never
 * skipped -- it's still a row, with an empty SAP Item Code, and (unlike
 * the clipboard format) it's also listed again, with its reason, in the
 * "Lines needing attention" section appended below the main table.
 */
export function rowsToCsvText(rows: HandoverRow[]): string {
  const allRows = [CSV_HEADER, ...rows.map(rowToCsvFields)];
  let text = allRows.map((fields) => fields.map(escapeCsvField).join(",")).join("\r\n") + "\r\n";

  const flagged = rows.filter((row) => row.note !== null);
  if (flagged.length > 0) {
    const flaggedRows = [
      ["Lines needing attention before processing"],
      ["SAP Item Code", "Description", "Reason"],
      ...flagged.map((row) => [row.sapItemCode ?? "", descriptionFor(row), row.note ?? ""]),
    ];
    text += "\r\n" + flaggedRows.map((fields) => fields.map(escapeCsvField).join(",")).join("\r\n") + "\r\n";
  }

  return text;
}

/**
 * Tab-separated, no header row, no quoting, no exceptions section --
 * built specifically to be pasted into a spreadsheet or data-entry grid,
 * where an extra header row or CSV-style quoting would itself need to be
 * deleted before the paste is usable. Column order matches the main CSV
 * table: SAP item code, description, quantity, unit. The original
 * customer wording is deliberately left out as its own column (unlike
 * CSV/Excel) since it has no use once pasted and would just be another
 * column to delete -- it's still used as the description fallback for an
 * unmatched line, same as everywhere else. An unmatched line still gets a
 * row; it's just not singled out here the way CSV singles it out below
 * the main table.
 */
export function rowsToClipboardText(rows: HandoverRow[]): string {
  return rows.map((row) => [row.sapItemCode ?? "", descriptionFor(row), row.quantity, row.unit].join("\t")).join("\n");
}
