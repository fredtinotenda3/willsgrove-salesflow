import { describe, it, expect } from "vitest";
import { rowsToCsvText, rowsToClipboardText } from "@/lib/handover/format-rows";
import type { HandoverRow } from "@/lib/handover/build-handover-rows";

/**
 * Milestone 2C. Unit tests for the pure CSV/clipboard formatting logic --
 * unconditional (no @prisma/client dependency anywhere in this file's or
 * format-rows.ts's import graph: build-handover-rows.ts is imported with
 * `import type` only, which TypeScript erases entirely at compile time),
 * unlike the DB-backed handover tests in tests/handover-db.integration.test.ts.
 */

function row(overrides: Partial<HandoverRow>): HandoverRow {
  return {
    lineNumber: 1,
    originalDescription: "Original text",
    sapItemCode: "SAP-001",
    officialDescription: "Official Item Name",
    quantity: "10.0000",
    unit: "EA",
    matched: true,
    note: null,
    ...overrides,
  };
}

describe("rowsToCsvText", () => {
  it("writes the exact header row followed by one row per line, CRLF-joined with a trailing CRLF", () => {
    const text = rowsToCsvText([row({ lineNumber: 1 }), row({ lineNumber: 2, sapItemCode: "SAP-002" })]);
    const lines = text.split("\r\n");

    expect(lines[0]).toBe("Line,SAP Item Code,Official Description,Quantity,Unit,Original Description,Note");
    expect(lines[1]).toBe("1,SAP-001,Official Item Name,10.0000,EA,Original text,");
    expect(lines[2]).toBe("2,SAP-002,Official Item Name,10.0000,EA,Original text,");
    // Trailing CRLF -- the string ends with an empty segment after the split.
    expect(lines[lines.length - 1]).toBe("");
  });

  it("quotes a field containing a comma, a double quote, or a newline, and doubles embedded quotes", () => {
    const text = rowsToCsvText([
      row({ originalDescription: 'Contains, a comma and "quotes"', note: "Multi\nline note" }),
    ]);
    const dataLine = text.split("\r\n")[1]!;

    expect(dataLine).toContain('"Contains, a comma and ""quotes"""');
    expect(dataLine).toContain('"Multi\nline note"');
  });

  it("never drops an unmatched line -- it still gets a row, with blank SAP code/description and its note populated", () => {
    const text = rowsToCsvText([
      row({
        lineNumber: 3,
        sapItemCode: null,
        officialDescription: null,
        matched: false,
        note: "No SAP product match -- resolve manually in SAP before processing this line.",
      }),
    ]);
    const dataLine = text.split("\r\n")[1]!;

    expect(dataLine).toBe(
      "3,,,10.0000,EA,Original text,No SAP product match -- resolve manually in SAP before processing this line."
    );
  });

  it("still writes just the header (plus trailing CRLF) for an empty order", () => {
    const text = rowsToCsvText([]);
    expect(text).toBe("Line,SAP Item Code,Official Description,Quantity,Unit,Original Description,Note\r\n");
  });
});

describe("rowsToClipboardText", () => {
  it("writes tab-separated rows with no header, newline-joined, and no original-description column", () => {
    const text = rowsToClipboardText([
      row({ sapItemCode: "SAP-001", officialDescription: "Official Item Name", quantity: "10.0000", unit: "EA" }),
      row({ sapItemCode: "SAP-002", officialDescription: "Second Item", quantity: "3.0000", unit: "KG" }),
    ]);
    const lines = text.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("SAP-001\tOfficial Item Name\t10.0000\tEA\t");
    expect(lines[1]).toBe("SAP-002\tSecond Item\t3.0000\tKG\t");
    // Original customer wording is deliberately excluded from this format.
    expect(text).not.toContain("Original text");
  });

  it("falls back to the original description when there's no official one, and never drops an unmatched line", () => {
    const text = rowsToClipboardText([
      row({
        sapItemCode: null,
        officialDescription: null,
        originalDescription: "Unmatched customer wording",
        matched: false,
        note: "No SAP product match -- resolve manually in SAP before processing this line.",
      }),
    ]);

    expect(text).toBe(
      "\tUnmatched customer wording\t10.0000\tEA\tNo SAP product match -- resolve manually in SAP before processing this line."
    );
  });

  it("returns an empty string for an order with no rows", () => {
    expect(rowsToClipboardText([])).toBe("");
  });
});
