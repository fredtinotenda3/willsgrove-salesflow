import { describe, it, expect } from "vitest";
import { parseSapItemMasterCsv } from "@/lib/sap-item-master-csv";

const HEADER = `"CODE","UNIT_OF_MEASURE","PACK_SIZE","VARIABLE_WEIGHT","TAX_CODE"`;

describe("parseSapItemMasterCsv", () => {
  it("parses the real item 0228 row confirmed by invoice HRE580108 (unit PNT, pack 250G, VAT00)", () => {
    const result = parseSapItemMasterCsv(`${HEADER}\n"0228","PNT","250G","N","VAT00"\n`);

    expect(result.success).toBe(true);
    expect(result.rows).toEqual([
      {
        code: "0228",
        unitOfMeasure: "PNT",
        packSize: "250G",
        isVariableWeight: false,
        vatCode: "VAT00",
        sourceData: {
          CODE: "0228",
          UNIT_OF_MEASURE: "PNT",
          PACK_SIZE: "250G",
          VARIABLE_WEIGHT: "N",
          TAX_CODE: "VAT00",
        },
      },
    ]);
  });

  it("preserves a leading-zero CODE as text, never coercing to a number", () => {
    const result = parseSapItemMasterCsv(`${HEADER}\n"0228","PNT","250G","N","VAT00"\n`);
    expect(result.rows[0].code).toBe("0228");
    expect(typeof result.rows[0].code).toBe("string");
  });

  it("accepts Y for VARIABLE_WEIGHT (e.g. item 8028, sold by kg)", () => {
    const result = parseSapItemMasterCsv(`${HEADER}\n"8028","KG","","Y","VAT00"\n`);
    expect(result.success).toBe(true);
    expect(result.rows[0].isVariableWeight).toBe(true);
    expect(result.rows[0].packSize).toBeNull();
  });

  it("treats a blank VARIABLE_WEIGHT as false with no warning", () => {
    const result = parseSapItemMasterCsv(`${HEADER}\n"0228","PNT","250G","","VAT00"\n`);
    expect(result.success).toBe(true);
    expect(result.rows[0].isVariableWeight).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it("warns (not errors) on an unrecognized VARIABLE_WEIGHT value and defaults to false", () => {
    const result = parseSapItemMasterCsv(`${HEADER}\n"0228","PNT","250G","maybe","VAT00"\n`);
    expect(result.success).toBe(true);
    expect(result.rows[0].isVariableWeight).toBe(false);
    expect(result.warnings).toEqual([
      {
        row: 2,
        code: "0228",
        field: "VARIABLE_WEIGHT",
        originalValue: "maybe",
        message: expect.stringContaining("unrecognized VARIABLE_WEIGHT"),
      },
    ]);
  });

  it("rejects a blank CODE", () => {
    const result = parseSapItemMasterCsv(`${HEADER}\n"","PNT","250G","N","VAT00"\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("CODE is required");
  });

  it("reports a duplicate CODE and excludes it from rows", () => {
    const result = parseSapItemMasterCsv(`${HEADER}\n"0228","PNT","250G","N","VAT00"\n"0228","EA","","N","VAT15"\n`);
    expect(result.success).toBe(false);
    expect(result.duplicateCodes).toEqual(["0228"]);
    expect(result.rows).toHaveLength(1);
  });

  it("rejects a missing required column", () => {
    const result = parseSapItemMasterCsv(`"CODE","UNIT_OF_MEASURE"\n"0228","PNT"\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("Missing columns");
  });

  it("leaves UNIT_OF_MEASURE, PACK_SIZE and TAX_CODE null when blank, never guessing a value", () => {
    const result = parseSapItemMasterCsv(`${HEADER}\n"9999","","","N",""\n`);
    expect(result.success).toBe(true);
    expect(result.rows[0]).toMatchObject({ unitOfMeasure: null, packSize: null, vatCode: null });
  });
});
