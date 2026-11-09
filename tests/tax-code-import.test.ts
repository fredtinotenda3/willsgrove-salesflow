import { describe, it, expect } from "vitest";
import { parseSapTaxCodeCsv } from "@/lib/sap-tax-code-csv";

const HEADER = `"TAX_CODE","DESCRIPTION","RATE_PERCENT"`;

describe("parseSapTaxCodeCsv", () => {
  it("parses the real zero-rated code confirmed by invoice HRE580108 (item 0228, VAT 0.00)", () => {
    const result = parseSapTaxCodeCsv(`${HEADER}\n"VAT00","Zero-rated (fresh produce)","0.00"\n`);

    expect(result.success).toBe(true);
    expect(result.rows).toEqual([
      {
        code: "VAT00",
        description: "Zero-rated (fresh produce)",
        ratePercent: "0.00",
        sourceData: { TAX_CODE: "VAT00", DESCRIPTION: "Zero-rated (fresh produce)", RATE_PERCENT: "0.00" },
      },
    ]);
  });

  it("parses the standard rate effective 1 Jan 2026 (15.50%)", () => {
    const result = parseSapTaxCodeCsv(`${HEADER}\n"VAT15","Standard rate","15.50"\n`);
    expect(result.success).toBe(true);
    expect(result.rows[0].ratePercent).toBe("15.50");
  });

  it("rejects a missing required column", () => {
    const result = parseSapTaxCodeCsv(`"TAX_CODE","RATE_PERCENT"\n"VAT00","0.00"\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("Missing columns");
  });

  it("rejects a rate outside 0-100", () => {
    const result = parseSapTaxCodeCsv(`${HEADER}\n"VAT99","Bad","150.00"\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("RATE_PERCENT");
  });

  it("rejects a non-numeric rate", () => {
    const result = parseSapTaxCodeCsv(`${HEADER}\n"VAT99","Bad","fifteen"\n`);
    expect(result.success).toBe(false);
  });

  it("rejects a blank TAX_CODE", () => {
    const result = parseSapTaxCodeCsv(`${HEADER}\n"","Blank","0.00"\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("TAX_CODE is required");
  });

  it("reports a duplicate TAX_CODE and excludes it from rows", () => {
    const result = parseSapTaxCodeCsv(`${HEADER}\n"VAT00","A","0.00"\n"VAT00","B","0.00"\n`);
    expect(result.success).toBe(false);
    expect(result.duplicateCodes).toEqual(["VAT00"]);
    expect(result.rows).toHaveLength(1);
  });

  it("rejects an empty file (header only)", () => {
    const result = parseSapTaxCodeCsv(`${HEADER}\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("header and at least one row");
  });

  it("treats a blank DESCRIPTION as null, not an empty string", () => {
    const result = parseSapTaxCodeCsv(`${HEADER}\n"VAT00","","0.00"\n`);
    expect(result.success).toBe(true);
    expect(result.rows[0].description).toBeNull();
  });
});
