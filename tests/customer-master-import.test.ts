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

  it("tags a successful RICH-layout parse with layout: \"RICH\"", () => {
    const result = parseSapCustomerMasterCsv(`${HEADER}\n${row()}\n`);
    expect(result.layout).toBe("RICH");
  });
});

/**
 * Real Business Data Onboarding round: the real
 * List_of_Business_Partners.xlsx export (diagnosed against the actual
 * supplied file) has only 6 columns -- #, BP Code, BP Name, Account
 * Balance, Account Balance FC, Gaap Supplier Code -- none of the RICH
 * layout's 18. The RICH-only parser above rejected every real row at the
 * header-check stage before this fix; this "LEAN" layout is what makes
 * the real file actually importable.
 */
describe("parseSapCustomerMasterCsv (LEAN layout -- real Business Partner list shape)", () => {
  const LEAN_HEADER = `"#","BP Code","BP Name","Account Balance","Account Balance FC","Gaap Supplier Code"`;

  function leanRow(fields: Partial<{ num: string; code: string; name: string; balance: string; balanceFc: string; gaap: string }> = {}): string {
    const d = {
      num: "1204",
      code: "HREC0D457",
      name: "1019-OK Supermarket - 1St Street Deli.",
      balance: "0",
      balanceFc: "0",
      gaap: "",
      ...fields,
    };
    return `"${d.num}","${d.code}","${d.name}","${d.balance}","${d.balanceFc}","${d.gaap}"`;
  }

  it("parses the real 6-column Business Partner list shape successfully", () => {
    const result = parseSapCustomerMasterCsv(`${LEAN_HEADER}\n${leanRow()}\n`);
    expect(result.success).toBe(true);
    expect(result.layout).toBe("LEAN");
    expect(result.rows[0]).toMatchObject({
      customerCode: "HREC0D457",
      customerName: "1019-OK Supermarket - 1St Street Deli.",
      tin: null,
      vatNumber: null,
      currencyCode: null,
      priceListCode: null,
      addressLine1: null,
      contactName: null,
      creditHold: false,
    });
  });

  it("never fabricates TIN/VAT/currency/pricing/address/contact data that simply isn't in the source file", () => {
    const result = parseSapCustomerMasterCsv(`${LEAN_HEADER}\n${leanRow()}\n`);
    const row = result.rows[0];
    for (const field of [
      "tin", "vatNumber", "currencyCode", "priceListCode", "paymentTermsCode",
      "branchCode", "storeCode", "creditLimit", "addressLine1", "city",
      "phone", "email", "contactName", "contactEmail", "contactPhone",
    ] as const) {
      expect(row[field]).toBeNull();
    }
  });

  it("preserves Account Balance / Account Balance FC / Gaap Supplier Code in sourceData, never silently discarding real source data", () => {
    const result = parseSapCustomerMasterCsv(
      `${LEAN_HEADER}\n${leanRow({ balance: "1068.15", balanceFc: "37053.24" })}\n`,
    );
    expect(result.success).toBe(true);
    expect(result.rows[0].sourceData["ACCOUNT BALANCE"]).toBe("1068.15");
    expect(result.rows[0].sourceData["ACCOUNT BALANCE FC"]).toBe("37053.24");
    expect(result.unmappedInformationalColumns).toEqual(
      expect.arrayContaining(["ACCOUNT BALANCE", "ACCOUNT BALANCE FC", "GAAP SUPPLIER CODE"]),
    );
  });

  it("handles a negative (credit) balance without rejecting the row", () => {
    const result = parseSapCustomerMasterCsv(`${LEAN_HEADER}\n${leanRow({ balance: "-5.52", balanceFc: "-196" })}\n`);
    expect(result.success).toBe(true);
    expect(result.rows[0].sourceData["ACCOUNT BALANCE"]).toBe("-5.52");
  });

  it("rejects a blank BP Name", () => {
    const result = parseSapCustomerMasterCsv(`${LEAN_HEADER}\n${leanRow({ name: "" })}\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("BP NAME is required");
  });

  it("rejects a blank BP Code", () => {
    const result = parseSapCustomerMasterCsv(`${LEAN_HEADER}\n${leanRow({ code: "" })}\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("BP CODE is required");
  });

  it("reports a duplicate BP Code and excludes it from rows, same as the RICH layout's duplicate handling", () => {
    const result = parseSapCustomerMasterCsv(
      `${LEAN_HEADER}\n${leanRow()}\n${leanRow({ name: "Different name" })}\n`,
    );
    expect(result.success).toBe(false);
    expect(result.duplicateCodes).toEqual(["HREC0D457"]);
    expect(result.rows).toHaveLength(1);
  });

  it("allows repeated customer NAMES across different BP codes -- a confirmed real SAP pattern, not a defect", () => {
    const result = parseSapCustomerMasterCsv(
      `${LEAN_HEADER}\n${leanRow({ code: "HREC0D457" })}\n${leanRow({ code: "HREC457" })}\n${leanRow({ code: "HREC856" })}\n`,
    );
    expect(result.success).toBe(true);
    expect(result.rows).toHaveLength(3);
    expect(result.duplicateCodes).toEqual([]);
  });

  it("is column-count-strict, same as the RICH layout, rejecting a row with the wrong number of fields", () => {
    const result = parseSapCustomerMasterCsv(`${LEAN_HEADER}\n"1204","HREC0D457","Name only three fields"\n`);
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain("Expected 6 columns but found 3");
  });
});
