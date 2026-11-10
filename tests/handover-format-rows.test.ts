import { describe, it, expect } from "vitest";
import { rowsToCsvText, rowsToClipboardText } from "@/lib/handover/format-rows";
import type { HandoverRow } from "@/lib/handover/build-handover-rows";

/**
 * Milestone 2C, reworked in Milestone 3C (SAP Invoice Handover
 * Specification) for the spec's 4-column product table. Unit tests for
 * the pure CSV/clipboard formatting logic -- unconditional (no
 * @prisma/client dependency anywhere in this file's or format-rows.ts's
 * import graph: build-handover-rows.ts is imported with `import type`
 * only, which TypeScript erases entirely at compile time), unlike the
 * DB-backed handover tests in tests/handover-db.integration.test.ts.
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
  it("writes the exact 4-column header row followed by one row per line, CRLF-joined with a trailing CRLF", () => {
    const text = rowsToCsvText([row({ lineNumber: 1 }), row({ lineNumber: 2, sapItemCode: "SAP-002" })]);
    const lines = text.split("\r\n");

    expect(lines[0]).toBe("SAP Item Code,Description,Quantity,Unit");
    expect(lines[1]).toBe("SAP-001,Official Item Name,10.0000,EA");
    expect(lines[2]).toBe("SAP-002,Official Item Name,10.0000,EA");
    // No flagged lines in this set, so the text ends right after the
    // table -- single trailing CRLF, no exceptions section.
    expect(lines[3]).toBe("");
    expect(lines).toHaveLength(4);
  });

  it("quotes a field containing a comma, a double quote, or a newline, and doubles embedded quotes", () => {
    const text = rowsToCsvText([row({ officialDescription: 'Contains, a comma and "quotes"' })]);
    const dataLine = text.split("\r\n")[1]!;

    expect(dataLine).toContain('"Contains, a comma and ""quotes"""');
  });

  it("never drops an unmatched line from the main table -- blank SAP code, falls back to the original description -- and lists it again, with its reason, in a separate exceptions section", () => {
    const text = rowsToCsvText([
      row({
        lineNumber: 3,
        sapItemCode: null,
        officialDescription: null,
        originalDescription: "Unmatched customer wording",
        matched: false,
        note: "No SAP product match -- resolve manually in SAP before processing this line.",
      }),
    ]);
    const lines = text.split("\r\n");

    expect(lines[0]).toBe("SAP Item Code,Description,Quantity,Unit");
    expect(lines[1]).toBe(",Unmatched customer wording,10.0000,EA");
    expect(lines[2]).toBe(""); // blank separator before the exceptions section
    expect(lines[3]).toBe("Lines needing attention before processing");
    expect(lines[4]).toBe("SAP Item Code,Description,Reason");
    expect(lines[5]).toBe(
      ",Unmatched customer wording,No SAP product match -- resolve manually in SAP before processing this line."
    );
  });

  it("appends no exceptions section at all when nothing is flagged", () => {
    const text = rowsToCsvText([row({})]);
    expect(text).not.toContain("Lines needing attention");
  });

  it("still writes just the header (plus trailing CRLF) for an empty order", () => {
    const text = rowsToCsvText([]);
    expect(text).toBe("SAP Item Code,Description,Quantity,Unit\r\n");
  });
});

describe("rowsToClipboardText", () => {
  it("writes tab-separated 4-column rows with no header, newline-joined, and no original-description column", () => {
    const text = rowsToClipboardText([
      row({ sapItemCode: "SAP-001", officialDescription: "Official Item Name", quantity: "10.0000", unit: "EA" }),
      row({ sapItemCode: "SAP-002", officialDescription: "Second Item", quantity: "3.0000", unit: "KG" }),
    ]);
    const lines = text.split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("SAP-001\tOfficial Item Name\t10.0000\tEA");
    expect(lines[1]).toBe("SAP-002\tSecond Item\t3.0000\tKG");
    // Original customer wording is deliberately excluded from this format.
    expect(text).not.toContain("Original text");
  });

  it("falls back to the original description when there's no official one, and never drops an unmatched line -- with no exceptions section appended (unlike CSV)", () => {
    const text = rowsToClipboardText([
      row({
        sapItemCode: null,
        officialDescription: null,
        originalDescription: "Unmatched customer wording",
        matched: false,
        note: "No SAP product match -- resolve manually in SAP before processing this line.",
      }),
    ]);

    expect(text).toBe("\tUnmatched customer wording\t10.0000\tEA");
    expect(text).not.toContain("No SAP product match");
  });

  it("returns an empty string for an order with no rows", () => {
    expect(rowsToClipboardText([])).toBe("");
  });
});
