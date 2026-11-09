import { describe, it, expect } from "vitest";
import { parseCustomerPoCsv } from "@/lib/extraction/deterministic/csv";
import { validateExtractionResult } from "@/lib/extraction/schema";

describe("parseCustomerPoCsv", () => {
  it("parses a Description/Quantity/Unit layout with no AI call involved", () => {
    const csv = `Description,Quantity,Unit\n"Baby Marrow 250G Punnet",10,PNT\n"Tomatoes Box",5,BOX\n`;
    const result = parseCustomerPoCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.classification).toBe("CUSTOMER_PO");
      expect(result.result.lines).toHaveLength(2);
      expect(result.result.lines[0]).toMatchObject({
        originalDescription: "Baby Marrow 250G Punnet",
        extractedQuantity: "10",
        extractedUnit: "PNT",
      });
      expect(validateExtractionResult(result.result).ok).toBe(true);
    }
  });

  it("matches common header synonyms case-insensitively (ITEM / QTY)", () => {
    const csv = `ITEM,QTY\n"Onions 1kg bag",8\n`;
    const result = parseCustomerPoCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.lines[0]!.extractedQuantity).toBe("8");
    }
  });

  it("never confuses a Unit Price column for the unit-of-measure column", () => {
    const csv = `Description,Quantity,Unit,Unit Price\n"Baby Marrow 250G Punnet",10,PNT,0.45\n`;
    const result = parseCustomerPoCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.lines[0]!.extractedUnit).toBe("PNT");
      expect(result.result.lines[0]!.customerProvidedUnitPrice).toBe("0.45");
    }
  });

  it("flags a line with an unparseable quantity cell rather than failing the whole file", () => {
    const csv = `Description,Quantity\n"Baby Marrow 250G Punnet",ten\n`;
    const result = parseCustomerPoCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.lines[0]!.extractedQuantity).toBeNull();
      expect(result.result.lines[0]!.warnings.length).toBeGreaterThan(0);
    }
  });

  it("skips a row with a blank description rather than erroring", () => {
    const csv = `Description,Quantity\n"Baby Marrow 250G Punnet",10\n"",5\n"Tomatoes Box",3\n`;
    const result = parseCustomerPoCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.lines).toHaveLength(2);
    }
  });

  it("fails clearly when no description-like column can be found", () => {
    const csv = `Foo,Bar\n1,2\n`;
    const result = parseCustomerPoCsv(csv);
    expect(result.ok).toBe(false);
  });

  it("fails clearly on an empty file", () => {
    const result = parseCustomerPoCsv("");
    expect(result.ok).toBe(false);
  });

  it("never loses a leading-zero item code if the customer happens to include one in free text (preserved as plain text within the description)", () => {
    const csv = `Description,Quantity\n"0228 Baby Marrow 250G Punnet",10\n`;
    const result = parseCustomerPoCsv(csv);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.lines[0]!.originalDescription).toContain("0228");
    }
  });
});
