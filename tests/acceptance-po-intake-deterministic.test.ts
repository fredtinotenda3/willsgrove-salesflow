import { describe, it, expect, beforeEach } from "vitest";
import ExcelJS from "exceljs";
import { dispatchExtraction } from "@/lib/extraction/router";
import { validateExtractionResult } from "@/lib/extraction/schema";

// Milestone 2A acceptance test, from the approved Milestone 2 report's own
// acceptance criteria (section 2/3): "deterministic parsing wherever
// possible -- Excel via a spreadsheet parser, CSV via a CSV parser ...
// do not unnecessarily send structured Excel or CSV data to the AI
// provider" and "accurate product identification -- never merging similar
// products/pack sizes, preserving leading zeros ... requiring salesperson
// confirmation before including an unconfident match."
//
// This exercises the real, complete dispatch path (lib/extraction/router.ts)
// -- the same function lib/po-intake.ts calls for every live upload or
// paste -- for all three Milestone 2A intake channels that don't need a
// live Anthropic key to prove themselves: CSV, EXCEL (both fully
// deterministic, no AI call possible even if a key were configured), and
// WHATSAPP (routes to the mock provider here because no ANTHROPIC_API_KEY
// is set in this test environment -- see lib/extraction/providers/anthropic.ts's
// createAnthropicProvider, which returns null without one). It needs no
// database and no network call, so it runs unconditionally in the sandbox,
// not only on the real machine.
//
// What this does NOT cover: PDF/IMAGE channels and a live Anthropic call
// (both real and callable per lib/extraction/providers/anthropic.ts, but
// not verified against a real API key -- see
// docs/milestones/PROGRESS.md's Milestone 2A section).

describe("Milestone 2A acceptance: deterministic PO intake across CSV, Excel and pasted text", () => {
  beforeEach(() => {
    // Guard against this suite accidentally making a live Anthropic call
    // in any environment where a real key happens to be set -- CSV/EXCEL
    // never reach a provider at all, and WHATSAPP must fall back to MOCK.
    delete process.env.ANTHROPIC_API_KEY;
  });

  it("extracts a CSV purchase order via the deterministic path, never via an AI provider, preserving exact wording and a leading-zero code embedded in free text", async () => {
    const csv = [
      "Description,Quantity,Unit",
      '"0228 Baby Marrow 250G Punnet",10,PNT',
      '"Tomatoes Box",5,BOX',
    ].join("\n");

    const outcome = await dispatchExtraction({
      sourceChannel: "CSV",
      fileBuffer: Buffer.from(csv, "utf-8"),
    });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.provider).toBe("DETERMINISTIC");
    expect(validateExtractionResult(outcome.result).ok).toBe(true);
    expect(outcome.result.classification).toBe("CUSTOMER_PO");
    expect(outcome.result.lines).toHaveLength(2);

    const babyMarrow = outcome.result.lines.find((line) => line.originalDescription.includes("Baby Marrow"));
    expect(babyMarrow).toBeDefined();
    // Preserved verbatim -- including the customer's own leading-zero
    // code -- never corrected, reformatted, or resolved to a SAP item
    // code here (that is Milestone 2B's job, not 2A's).
    expect(babyMarrow!.originalDescription).toBe("0228 Baby Marrow 250G Punnet");
    expect(babyMarrow!.extractedQuantity).toBe("10");
    expect(babyMarrow!.extractedUnit).toBe("PNT");
  });

  it("extracts an Excel (.xlsx) purchase order via the same deterministic path, equivalent to the CSV submission of the same order", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("PO");
    sheet.addRow(["Description", "Quantity", "Unit"]);
    sheet.addRow(["0228 Baby Marrow 250G Punnet", 10, "PNT"]);
    sheet.addRow(["Tomatoes Box", 5, "BOX"]);
    const buffer = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;

    const outcome = await dispatchExtraction({ sourceChannel: "EXCEL", fileBuffer: buffer });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.provider).toBe("DETERMINISTIC");
    expect(validateExtractionResult(outcome.result).ok).toBe(true);
    expect(outcome.result.lines).toHaveLength(2);
    expect(outcome.result.lines[0]).toMatchObject({
      originalDescription: "0228 Baby Marrow 250G Punnet",
      extractedQuantity: "10",
      extractedUnit: "PNT",
    });
  });

  it("extracts a pasted WhatsApp-style message, falling back to the mock provider with no Anthropic key configured, and flags a line with no stated quantity rather than guessing one", async () => {
    const pasted = ["10 Baby Marrow 250g punnet", "Tomatoes, usual box please"].join("\n");

    const outcome = await dispatchExtraction({ sourceChannel: "WHATSAPP", pastedText: pasted });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    // No ANTHROPIC_API_KEY in this test environment -> MOCK, not ANTHROPIC.
    // This is the fallback path the Milestone 2 brief requires: "the mock
    // provider must support development and testing without an API key."
    expect(outcome.provider).toBe("MOCK");
    expect(validateExtractionResult(outcome.result).ok).toBe(true);
    expect(outcome.result.lines).toHaveLength(2);

    const quantified = outcome.result.lines.find((line) => line.originalDescription.startsWith("10 Baby Marrow"));
    expect(quantified?.extractedQuantity).toBe("10");

    const ambiguous = outcome.result.lines.find((line) => line.originalDescription.includes("usual box"));
    expect(ambiguous).toBeDefined();
    // Never invents a quantity for "usual box please" -- flags it for a
    // human reviewer (Milestone 2B) instead of guessing a number.
    expect(ambiguous!.extractedQuantity).toBeNull();
    expect(ambiguous!.warnings.length).toBeGreaterThan(0);
  });

  it("never merges a punnet line and a loose-by-the-kg line of the same vegetable into one, even when both are extracted from the same document", async () => {
    const csv = [
      "Description,Quantity,Unit",
      '"Baby Marrow small punnet",6,PNT',
      '"Baby Marrow loose by the kg",3,KG',
    ].join("\n");

    const outcome = await dispatchExtraction({ sourceChannel: "CSV", fileBuffer: Buffer.from(csv, "utf-8") });

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;

    expect(outcome.result.lines).toHaveLength(2);
    const descriptions = outcome.result.lines.map((line) => line.originalDescription);
    expect(descriptions).toContain("Baby Marrow small punnet");
    expect(descriptions).toContain("Baby Marrow loose by the kg");
  });
});
