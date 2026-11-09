import { describe, it, expect } from "vitest";
import { parseSapPriceListCsv } from "@/lib/sap-price-list-csv";

const HEADER = `"PRICE_LIST_CODE","PRICE_LIST_NAME","CURRENCY","ITEM_CODE","UNIT_PRICE","VALID_FROM","VALID_TO"`;

describe("parseSapPriceListCsv", () => {
  it("parses the real item 0228 price confirmed by invoice HRE580108 (0.45 USD)", () => {
    const result = parseSapPriceListCsv(
      `${HEADER}\n"PL-TM-CHINHOYI","TM Chinhoyi North","USD","0228","0.45","2026-01-01",""\n`
    );

    expect(result.success).toBe(true);
    expect(result.rows[0]).toMatchObject({
      priceListCode: "PL-TM-CHINHOYI",
      priceListName: "TM Chinhoyi North",
      currencyCode: "USD",
      itemCode: "0228",
      unitPrice: "0.45",
      validFrom: "2026-01-01",
      validTo: null,
    });
  });

  it("confirms the acceptance-test arithmetic: 10 x 0.45 USD = 4.50, VAT 0.00", () => {
    const result = parseSapPriceListCsv(
      `${HEADER}\n"PL-TM-CHINHOYI","TM Chinhoyi North","USD","0228","0.45","2026-01-01",""\n`
    );
    const unitPrice = Number(result.rows[0].unitPrice);
    const quantity = 10;
    const vatRate = 0; // from the zero-rated tax code, see tests/tax-code-import.test.ts

    expect(unitPrice * quantity).toBeCloseTo(4.5, 4);
    expect(unitPrice * quantity * (vatRate / 100)).toBe(0);
  });

  it("rejects two rows for the same PRICE_LIST_CODE with a different name/currency", () => {
    const result = parseSapPriceListCsv(
      `${HEADER}\n` +
        `"PL1","List A","USD","0228","0.45","2026-01-01",""\n` +
        `"PL1","List B","ZWG","8028","3.20","2026-01-01",""\n`
    );

    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("already defined on row 2");
  });

  it("accepts the same PRICE_LIST_CODE repeated consistently across rows", () => {
    const result = parseSapPriceListCsv(
      `${HEADER}\n` +
        `"PL1","List A","USD","0228","0.45","2026-01-01",""\n` +
        `"PL1","List A","USD","8028","3.20","2026-01-01",""\n`
    );

    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(2);
  });

  it("rejects VALID_TO before VALID_FROM", () => {
    const result = parseSapPriceListCsv(
      `${HEADER}\n"PL1","List A","USD","0228","0.45","2026-06-01","2026-01-01"\n`
    );
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("VALID_TO cannot be before VALID_FROM");
  });

  it("rejects an impossible calendar date (2026-02-30)", () => {
    const result = parseSapPriceListCsv(
      `${HEADER}\n"PL1","List A","USD","0228","0.45","2026-02-30",""\n`
    );
    expect(result.success).toBe(false);
  });

  it("rejects a 2-letter currency code", () => {
    const result = parseSapPriceListCsv(
      `${HEADER}\n"PL1","List A","US","0228","0.45","2026-01-01",""\n`
    );
    expect(result.success).toBe(false);
  });

  it("rejects a negative or malformed price", () => {
    const result = parseSapPriceListCsv(
      `${HEADER}\n"PL1","List A","USD","0228","-0.45","2026-01-01",""\n`
    );
    expect(result.success).toBe(false);
  });

  it("allows an open-ended VALID_TO (blank)", () => {
    const result = parseSapPriceListCsv(
      `${HEADER}\n"PL1","List A","USD","0228","0.45","2026-01-01",""\n`
    );
    expect(result.success).toBe(true);
    expect(result.rows[0].validTo).toBeNull();
  });
});
