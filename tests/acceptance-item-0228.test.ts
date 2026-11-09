import { describe, it, expect } from "vitest";
import { parseSapTaxCodeCsv } from "@/lib/sap-tax-code-csv";
import { parseSapItemMasterCsv } from "@/lib/sap-item-master-csv";
import { parseSapPriceListCsv } from "@/lib/sap-price-list-csv";
import { parseSapCustomerMasterCsv } from "@/lib/sap-customer-master-csv";
import fs from "node:fs";
import path from "node:path";

// Milestone 1 (Master data from SAP) acceptance test, from the user's own
// stated acceptance criterion: "after importing the sample files, an
// order line preview shows unit, price and estimated total for item 0228
// matching the real invoice (10 x 0.45 USD PNT = 4.50, VAT 0.00)."
//
// This parses the four real sample files (test-data/sample-*.csv) exactly
// as the four importers would, and chains the results together the same
// way an order-line price/VAT estimate will once Milestone 2 reads this
// data -- without needing a database, so it runs unconditionally here, in
// the sandbox, not only on the real machine. It is a logic-level check of
// "does the imported data, read back out, reproduce the invoice," not a
// full integration test of the (not-yet-built) order-line preview UI
// itself.

const repoRoot = path.resolve(__dirname, "..");

function readSample(name: string): string {
  return fs.readFileSync(path.join(repoRoot, "test-data", name), "utf-8");
}

describe("Milestone 1 acceptance: item 0228 / invoice HRE580108", () => {
  it("reproduces unit PNT, price 0.45 USD, VAT 0.00, total 4.50 for 10 units of item 0228", () => {
    const taxCodes = parseSapTaxCodeCsv(readSample("sample-tax-codes.csv"));
    const itemMaster = parseSapItemMasterCsv(readSample("sample-item-master-extension.csv"));
    const priceLists = parseSapPriceListCsv(readSample("sample-price-lists.csv"));
    const customers = parseSapCustomerMasterCsv(readSample("sample-customer-master.csv"));

    expect(taxCodes.success).toBe(true);
    expect(itemMaster.success).toBe(true);
    expect(priceLists.success).toBe(true);
    expect(customers.success).toBe(true);

    const item0228 = itemMaster.rows.find((r) => r.code === "0228");
    expect(item0228).toBeDefined();
    expect(item0228!.unitOfMeasure).toBe("PNT");

    const taxCode = taxCodes.rows.find((r) => r.code === item0228!.vatCode);
    expect(taxCode).toBeDefined();
    expect(taxCode!.ratePercent).toBe("0.00");

    const priceEntry = priceLists.rows.find((r) => r.itemCode === "0228");
    expect(priceEntry).toBeDefined();
    expect(priceEntry!.unitPrice).toBe("0.45");

    const customer = customers.rows.find((r) => r.customerCode === "HREC0D677");
    expect(customer).toBeDefined();
    expect(customer!.priceListCode).toBe(priceEntry!.priceListCode);

    // The estimate an order-line preview will show.
    const quantity = 10;
    const unitPrice = Number(priceEntry!.unitPrice);
    const vatRate = Number(taxCode!.ratePercent);
    const lineTotal = quantity * unitPrice;
    const vatAmount = lineTotal * (vatRate / 100);

    expect(item0228!.unitOfMeasure).toBe("PNT");
    expect(unitPrice).toBeCloseTo(0.45, 4);
    expect(lineTotal).toBeCloseTo(4.5, 4);
    expect(vatAmount).toBe(0);
  });

  it("matches customer HREC0D677's TIN and VAT registration exactly as printed on invoice HRE580108", () => {
    const customers = parseSapCustomerMasterCsv(readSample("sample-customer-master.csv"));
    const customer = customers.rows.find((r) => r.customerCode === "HREC0D677");

    expect(customer).toBeDefined();
    expect(customer!.tin).toBe("2000003164");
    expect(customer!.vatNumber).toBe("220003216");
    expect(customer!.customerName).toBe("TM Supermarkets (Pvt) Ltd - Chinhoyi North");
  });
});
