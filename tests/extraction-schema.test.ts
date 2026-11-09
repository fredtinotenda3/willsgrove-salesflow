import { describe, it, expect } from "vitest";
import { PO_EXTRACTION_SCHEMA_VERSION, validateExtractionResult, type ExtractionResult } from "@/lib/extraction/schema";

// Explicitly typed as ExtractionResult (not inferred from the literal)
// so every field keeps its real schema type -- e.g. extractedQuantity as
// `string | null`, not narrowed to `string` from this fixture's "10" --
// and individual tests below can legally assign null to a nullable field.
function validResult(): ExtractionResult {
  return {
    schemaVersion: PO_EXTRACTION_SCHEMA_VERSION,
    classification: "CUSTOMER_PO" as const,
    header: {
      customerNameRaw: "TM Chinhoyi North",
      storeOrBranchRaw: "Chinhoyi North",
      customerPoNumber: "PO-123",
      poDate: "2026-11-06",
      requestedDeliveryDate: null,
      deliveryAddressRaw: null,
      currencyRaw: "USD",
      senderInfoRaw: null,
    },
    lines: [
      {
        lineNumber: 1,
        originalDescription: "Baby Marrow small punnet",
        extractedQuantity: "10",
        extractedUnit: "PNT",
        customerProvidedUnitPrice: null,
        sourcePageOrImageRef: "page-1",
        confidence: 0.9,
        warnings: [],
      },
    ],
  };
}

describe("validateExtractionResult", () => {
  it("accepts a well-formed extraction result", () => {
    const result = validateExtractionResult(validResult());
    expect(result.ok).toBe(true);
  });

  it("rejects a mismatched schemaVersion -- never silently accepts an old/future shape", () => {
    const result = validateExtractionResult({ ...validResult(), schemaVersion: "po-extraction-v0" });
    expect(result.ok).toBe(false);
  });

  it("rejects an invented quantity shape (not a valid decimal string)", () => {
    const candidate = validResult();
    candidate.lines[0]!.extractedQuantity = "ten" as unknown as string;
    const result = validateExtractionResult(candidate);
    expect(result.ok).toBe(false);
  });

  it("accepts a null quantity -- missing information must remain null, not a guessed default", () => {
    const candidate = validResult();
    candidate.lines[0]!.extractedQuantity = null;
    const result = validateExtractionResult(candidate);
    expect(result.ok).toBe(true);
  });

  it("rejects an unrecognized classification value", () => {
    const result = validateExtractionResult({ ...validResult(), classification: "RECEIPT" });
    expect(result.ok).toBe(false);
  });

  it("rejects a line with an empty original description", () => {
    const candidate = validResult();
    candidate.lines[0]!.originalDescription = "";
    const result = validateExtractionResult(candidate);
    expect(result.ok).toBe(false);
  });

  it("accepts an UNRELATED document with zero lines", () => {
    const result = validateExtractionResult({
      ...validResult(),
      classification: "UNRELATED",
      lines: [],
    });
    expect(result.ok).toBe(true);
  });

  it("rejects a date that doesn't exist on the calendar (e.g. 2026-02-30), same rule as lib/dates.ts", () => {
    const candidate = validResult();
    candidate.header.poDate = "2026-02-30";
    const result = validateExtractionResult(candidate);
    expect(result.ok).toBe(false);
  });
});
