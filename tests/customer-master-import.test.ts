import { describe, it, expect } from "vitest";
import { parseSapCustomerMasterCsv } from "@/lib/sap-customer-master-csv";

const HEADER =
  `"CUSTOMER_CODE","CUSTOMER_NAME","TIN","VAT_REG","CURRENCY","PRICE_LIST_CODE","PAYMENT_TERMS",` +
  `"BRANCH_CODE","STORE_CODE","CREDIT_LIMIT","CREDIT_HOLD","ADDRESS_LINE1","CITY","PHONE","EMAIL",` +
  `"CONTACT_NAME","CONTACT_EMAIL","CONTACT_PHONE"`;

function row(fields: Partial<Record<string, string>> = {}): string {
  const defaults: Record<string, string> = {
    CUSTOMER_CODE: "HREC0D677",
    CUSTOMER_NAME: "TM Supermarkets (Pvt) Ltd - Chinhoyi North",
    TIN: "2000003164",
    VAT_REG: "220003216",
    CURRENCY: "USD",
    PRICE_LIST_CODE: "PL-TM-CHINHOYI",
    PAYMENT_TERMS: "NET30",
    BRANCH_CODE: "HRE",
    STORE_CODE: "HREC0D677",
    CREDIT_LIMIT: "",
    CREDIT_HOLD: "N",
    ADDRESS_LINE1: "194 Mutare Road",
    CITY: "Harare",
    PHONE: "0242-447255",
    EMAIL: "imugabe@tmsm.co.zw",
    CONTACT_NAME: "",
    CONTACT_EMAIL: "",
    CONTACT_PHONE: "",
  };
  const merged = { ...defaults, ...fields };
  const order = [
    "CUSTOMER_CODE","CUSTOMER_NAME","TIN","VAT_REG","CURRENCY","PRICE_LIST_CODE","PAYMENT_TERMS",
    "BRANCH_CODE","STORE_CODE","CREDIT_LIMIT","CREDIT_HOLD","ADDRESS_LINE1","CITY","PHONE","EMAIL",
    "CONTACT_NAME","CONTACT_EMAIL","CONTACT_PHONE",
  ];
  return order.map((key) => `"${merged[key]}"`).join(",");
}

describe("parseSapCustomerMasterCsv", () => {
  it("parses the real customer HREC0D677 confirmed by invoice HRE580108's header", () => {
    const result = parseSapCustomerMasterCsv(`${HEADER}\n${row()}\n`);

    expect(result.success).toBe(true);
    expect(result.rows[0]).toMatchObject({
      customerCode: "HREC0D677",
      customerName: "TM Supermarkets (Pvt) Ltd - Chinhoyi North",
      tin: "2000003164",
      vatNumber: "220003216",
      currencyCode: "USD",
      addressLine1: "194 Mutare Road",
      city: "Harare",
      phone: "0242-447255",
      email: "imugabe@tmsm.co.zw",
    });
  });

  it("keeps TIN and VAT_REG as two separate fields, never merged", () => {
    const result = parseSapCustomerMasterCsv(`${HEADER}\n${row()}\n`);
    expect(result.rows[0].tin).toBe("2000003164");
    expect(result.rows[0].vatNumber).toBe("220003216");
    expect(result.rows[0].tin).not.toBe(result.rows[0].vatNumber);
  });

  it("rejects a blank CUSTOMER_NAME", () => {
    const result = parseSapCustomerMasterCsv(`${HEADER}\n${row({ CUSTOMER_NAME: "" })}\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("CUSTOMER_NAME is required");
  });

  it("rejects an invalid EMAIL", () => {
    const result = parseSapCustomerMasterCsv(`${HEADER}\n${row({ EMAIL: "not-an-email" })}\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("EMAIL is not a valid address");
  });

  it("rejects CREDIT_HOLD values other than Y/N", () => {
    const result = parseSapCustomerMasterCsv(`${HEADER}\n${row({ CREDIT_HOLD: "maybe" })}\n`);
    expect(result.success).toBe(false);
  });

  it("parses CREDIT_HOLD Y as true", () => {
    const result = parseSapCustomerMasterCsv(`${HEADER}\n${row({ CREDIT_HOLD: "Y" })}\n`);
    expect(result.success).toBe(true);
    expect(result.rows[0].creditHold).toBe(true);
  });

  it("reports a duplicate CUSTOMER_CODE and excludes it from rows", () => {
    const result = parseSapCustomerMasterCsv(`${HEADER}\n${row()}\n${row({ CUSTOMER_NAME: "Different name" })}\n`);
    expect(result.success).toBe(false);
    expect(result.duplicateCodes).toEqual(["HREC0D677"]);
    expect(result.rows).toHaveLength(1);
  });

  it("stores an optional primary contact when provided", () => {
    const result = parseSapCustomerMasterCsv(
      `${HEADER}\n${row({ CONTACT_NAME: "I. Mugabe", CONTACT_EMAIL: "imugabe@tmsm.co.zw", CONTACT_PHONE: "0242-447255" })}\n`
    );
    expect(result.success).toBe(true);
    expect(result.rows[0].contactName).toBe("I. Mugabe");
  });

  it("leaves optional fields null when blank", () => {
    const result = parseSapCustomerMasterCsv(
      `${HEADER}\n${row({ TIN: "", VAT_REG: "", CURRENCY: "", PRICE_LIST_CODE: "" })}\n`
    );
    expect(result.success).toBe(true);
    expect(result.rows[0]).toMatchObject({ tin: null, vatNumber: null, currencyCode: null, priceListCode: null });
  });

  it("rejects a missing required column", () => {
    const result = parseSapCustomerMasterCsv(`"CUSTOMER_CODE","CUSTOMER_NAME"\n"HREC0D677","TM Chinhoyi"\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("Missing columns");
  });
});
