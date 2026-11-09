import { describe, it, expect } from "vitest";
import { MockExtractionProvider, parsePastedText } from "@/lib/extraction/providers/mock";
import { validateExtractionResult } from "@/lib/extraction/schema";

describe("parsePastedText", () => {
  it("parses a leading-quantity line (\"10 Baby Marrow 250g\")", () => {
    const lines = parsePastedText("10 Baby Marrow 250g");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ extractedQuantity: "10", originalDescription: "10 Baby Marrow 250g" });
    expect(lines[0]!.warnings).toHaveLength(0);
  });

  it("parses a trailing-quantity line (\"Tomatoes x5\")", () => {
    const lines = parsePastedText("Tomatoes x5");
    expect(lines[0]!.extractedQuantity).toBe("5");
  });

  it("never guesses a quantity for a line with none stated -- flags it instead", () => {
    const lines = parsePastedText("Baby Marrow, usual amount please");
    expect(lines[0]!.extractedQuantity).toBeNull();
    expect(lines[0]!.warnings.length).toBeGreaterThan(0);
  });

  it("splits multiple lines, numbering them in order", () => {
    const lines = parsePastedText("10 Baby Marrow 250g\n5 Tomatoes box\n2kg Onions");
    expect(lines.map((line) => line.lineNumber)).toEqual([1, 2, 3]);
  });

  it("skips blank lines", () => {
    const lines = parsePastedText("10 Baby Marrow 250g\n\n\n5 Tomatoes box");
    expect(lines).toHaveLength(2);
  });

  it("preserves the customer's exact original wording, never correcting it", () => {
    const lines = parsePastedText("10 babby marow 250g (sic)");
    expect(lines[0]!.originalDescription).toBe("10 babby marow 250g (sic)");
  });
});

describe("MockExtractionProvider", () => {
  it("is clearly labelled MOCK via providerName", () => {
    const provider = new MockExtractionProvider();
    expect(provider.providerName).toBe("MOCK");
  });

  it("produces a schema-valid result for pasted text input", async () => {
    const provider = new MockExtractionProvider();
    const outcome = await provider.extract({ kind: "text", text: "10 Baby Marrow 250g" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(validateExtractionResult(outcome.result).ok).toBe(true);
    }
  });

  it("classifies empty pasted text as UNRELATED rather than forcing CUSTOMER_PO", async () => {
    const provider = new MockExtractionProvider();
    const outcome = await provider.extract({ kind: "text", text: "" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.classification).toBe("UNRELATED");
    }
  });

  it("returns the default fixture for a PDF input with no fixtureKey override", async () => {
    const provider = new MockExtractionProvider();
    const outcome = await provider.extract({ kind: "document", mimeType: "application/pdf", base64Data: "AAAA", fileName: "po.pdf" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.header.customerPoNumber).toBe("MOCK-PO-0001");
      expect(validateExtractionResult(outcome.result).ok).toBe(true);
    }
  });

  it("returns the requested fixture (e.g. the Baby Marrow variant ambiguity case) when fixtureKey is set", async () => {
    const provider = new MockExtractionProvider({ fixtureKey: "baby-marrow-variants" });
    const outcome = await provider.extract({ kind: "image", mimeType: "image/jpeg", base64Data: "AAAA", fileName: "po.jpg" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.lines).toHaveLength(4);
      const descriptions = outcome.result.lines.map((line) => line.originalDescription);
      expect(descriptions).toContain("Baby Marrow small punnet");
      expect(descriptions).toContain("Baby Marrow 500g");
      expect(descriptions).toContain("Baby Marrow loose by the kg");
      expect(descriptions).toContain("Baby Marrow sliced 250g");
    }
  });

  it("falls back to the default fixture for an unrecognized fixtureKey rather than throwing", async () => {
    const provider = new MockExtractionProvider({ fixtureKey: "not-a-real-key" });
    const outcome = await provider.extract({ kind: "document", mimeType: "application/pdf", base64Data: "AAAA", fileName: "po.pdf" });
    expect(outcome.ok).toBe(true);
  });

  it("returns an UNRELATED, zero-line fixture for the unrelated-document key", async () => {
    const provider = new MockExtractionProvider({ fixtureKey: "unrelated-document" });
    const outcome = await provider.extract({ kind: "document", mimeType: "application/pdf", base64Data: "AAAA", fileName: "invoice.pdf" });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.classification).toBe("UNRELATED");
      expect(outcome.result.lines).toHaveLength(0);
    }
  });
});
