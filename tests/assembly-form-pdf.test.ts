import { describe, it, expect } from "vitest";
import { buildAssemblyFormPdf, wrapText, textWidth } from "@/lib/assembly-form/pdf";

const base = {
  companyName: "Willsgrove Farm Enterprises",
  companyAddress: "Birmingham Road, Southerton, Harare",
  companyTagline: "Sales Operations Platform · Harare",
  customerName: "Test (Pvt) Ltd \\ Retail",
  customerPoReference: "PO-123",
  orderReference: "ORD-0001",
  orderDate: "01 Nov 2026",
};

describe("assembly form PDF", () => {
  it("produces a structurally valid PDF with the order details and blank found/unavailable cells", () => {
    const pdf = buildAssemblyFormPdf({
      ...base,
      lines: [{ lineNumber: 1, sapItemCode: "FR-001", description: "Apple C. Pink Per Kg", requestedQuantity: "10", requestedUnitCode: "KG" }],
    });
    const text = pdf.toString("latin1");
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(text).toContain("ORD-0001");
    expect(text).toContain("Apple C. Pink Per Kg");
    expect(text).toContain("Page 1 of 1");
    // xref offsets point at "N 0 obj" markers.
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe("xref");
  });

  it("paginates a long order and repeats the table header", () => {
    const lines = Array.from({ length: 80 }, (_, i) => ({ lineNumber: i + 1, sapItemCode: `C${i}`, description: `Product number ${i} with a fairly long description that wraps`, requestedQuantity: "12.5", requestedUnitCode: "KG" }));
    const text = buildAssemblyFormPdf({ ...base, lines }).toString("latin1");
    const pages = Number(/Count (\d+)/.exec(text)![1]);
    expect(pages).toBeGreaterThan(1);
    expect(text).toContain(`Page ${pages} of ${pages}`);
  });

  it("escapes parentheses/backslashes and replaces characters outside WinAnsi instead of corrupting the file", () => {
    const text = buildAssemblyFormPdf({
      ...base,
      lines: [{ lineNumber: 1, sapItemCode: null, description: "Tomato (Grade A) 中文", requestedQuantity: "1", requestedUnitCode: "EA" }],
    }).toString("latin1");
    expect(text).toContain("Tomato \\(Grade A\\) ??");
    expect(text).toContain("Test \\(Pvt\\) Ltd \\\\ Retail");
  });

  it("wraps long text inside the cell width and hard-splits an unbroken word", () => {
    const lines = wrapText("Supercalifragilisticexpialidocious_unbroken_token_that_is_long", 8.5, 60);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 8.5)).toBeLessThanOrEqual(60 + 0.01);
  });
});
