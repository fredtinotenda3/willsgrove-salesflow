import { describe, expect, it } from "vitest";
import { deriveClaimHeaderCategory, isPositiveQuantity, mapRejectionReasonToCategory, selectRejectedLines } from "@/lib/invoice-claims/delivery-claim-core";
import { returnedLineValue } from "@/lib/lost-sales/delivery-returns";
import { combineLostSales } from "@/lib/lost-sales/overall";
import { chooseApplicablePrice, normalizePrice, parseCustomerPriceCsv, pricesEqual, validateUnitPrice } from "@/lib/pricing/price-core";
import { pricingFromLines, summariseOrderTotal } from "@/lib/order-totals";
import { CLAIM_LINE_REASON_CATEGORY_LABELS } from "@/lib/invoice-claims/validation";

// delivery-returns.ts imports prisma; the pure helper is still importable under the test alias setup used by the other unit tests.

describe("delivery -> claim rules", () => {
  it("maps the Record Delivery label and the identifier to the same category; unknown text maps to null", () => {
    const [category] = Object.keys(CLAIM_LINE_REASON_CATEGORY_LABELS) as (keyof typeof CLAIM_LINE_REASON_CATEGORY_LABELS)[];
    const label = CLAIM_LINE_REASON_CATEGORY_LABELS[category];
    expect(mapRejectionReasonToCategory(label)).toBe(category);
    expect(mapRejectionReasonToCategory(` ${label.toUpperCase()} `)).toBe(category);
    expect(mapRejectionReasonToCategory(category)).toBe(category);
    expect(mapRejectionReasonToCategory("customer felt like it")).toBeNull();
    expect(mapRejectionReasonToCategory("")).toBeNull();
    expect(mapRejectionReasonToCategory(null)).toBeNull();
  });

  it("header category is the single shared reason, otherwise a customer rejection", () => {
    expect(deriveClaimHeaderCategory(["POOR_QUALITY"] as never)).toBe("POOR_QUALITY");
    expect(deriveClaimHeaderCategory(["POOR_QUALITY", "POOR_QUALITY"] as never)).toBe("POOR_QUALITY");
    expect(deriveClaimHeaderCategory(["POOR_QUALITY", "DAMAGED"] as never)).toBe("CUSTOMER_REJECTION");
    expect(deriveClaimHeaderCategory([null])).toBe("CUSTOMER_REJECTION");
  });

  it("only strictly positive rejected quantities produce claim lines (accepted-in-full never does)", () => {
    expect(isPositiveQuantity("0.0000")).toBe(false);
    expect(isPositiveQuantity("0")).toBe(false);
    expect(isPositiveQuantity("0.0001")).toBe(true);
    expect(selectRejectedLines([{ rejectedQuantity: "0.0000" }, { rejectedQuantity: "3.0000" }])).toEqual([{ rejectedQuantity: "3.0000" }]);
  });
});

describe("returned goods value", () => {
  it("values ONLY the returned quantity, half-up to 4dp; unknown price is null, never zero", () => {
    expect(returnedLineValue("4.0000", "2.5000")).toBe("10");
    expect(returnedLineValue("0.3333", "1.0001")).toBe("0.3333"); // 0.33333333 -> half-up at 4dp
    expect(returnedLineValue("0.0005", "1.0000")).toBe("0.0005");
    expect(returnedLineValue("1.0000", null)).toBeNull();
  });
});

describe("overall lost sales: categories add per currency without mixing", () => {
  it("keeps USD and ZWG separate and adds unfulfilled demand to USD only", () => {
    const rows = combineLostSales([{ currencyCode: "USD", value: "10.0000" }, { currencyCode: "ZWG", value: "300.0000" }, { currencyCode: "USD", value: "5.5000" }], "20.0000");
    expect(rows).toEqual([
      { currencyCode: "USD", returnedGoods: "15.5", unfulfilledDemand: "20", total: "35.5" },
      { currencyCode: "ZWG", returnedGoods: "300", unfulfilledDemand: "0", total: "300" },
    ].map((r) => expect.objectContaining(r)));
  });

  it("unfulfilled demand alone yields a USD row; nothing yields no rows", () => {
    expect(combineLostSales([], "7.0000")).toHaveLength(1);
    expect(combineLostSales([], null)).toEqual([]);
  });
});

describe("customer price precedence and currency rules", () => {
  const list = { unitPrice: "2.0000", priceListCode: "L1" };
  it("a customer override beats the price list", () => {
    const r = chooseApplicablePrice({ override: { id: "o", unitPrice: "1.5000", currencyCode: "USD" }, listPrice: list, customerCurrency: "USD" }, "USD");
    expect(r).toMatchObject({ found: true, unitPrice: "1.5000", source: "CUSTOMER_OVERRIDE" });
  });
  it("with no override the price list applies", () => {
    expect(chooseApplicablePrice({ override: null, listPrice: list, customerCurrency: "USD" }, "USD")).toMatchObject({ found: true, unitPrice: "2.0000", source: "PRICE_LIST", currencyCode: "USD" });
  });
  it("an override in another currency is skipped (never converted) and the list price is used", () => {
    const r = chooseApplicablePrice({ override: { id: "o", unitPrice: "900.0000", currencyCode: "ZWG" }, listPrice: list, customerCurrency: "USD" }, "USD");
    expect(r).toMatchObject({ found: true, unitPrice: "2.0000", source: "PRICE_LIST", skippedOverrideForCurrency: true });
  });
  it("no override and no list price -> no price (no silent default)", () => {
    expect(chooseApplicablePrice({ override: null, listPrice: null, customerCurrency: "USD" }, "USD")).toMatchObject({ found: false });
    expect(chooseApplicablePrice({ override: { id: "o", unitPrice: "9.0000", currencyCode: "ZWG" }, listPrice: null, customerCurrency: "USD" }, null)).toMatchObject({ found: false, skippedOverrideForCurrency: true });
  });
  it("validates prices: positive, <= 4dp, no zero, no junk", () => {
    expect(validateUnitPrice("2.5")).toEqual({ ok: true, value: "2.5" });
    for (const bad of ["", "0", "0.0000", "-1", "1.23456", "abc", "1e3", " "]) expect(validateUnitPrice(bad).ok, bad).toBe(false);
    expect(pricesEqual("2.5", "2.5000")).toBe(true);
    expect(normalizePrice("2.5")).toBe("2.5000");
  });
});

describe("customer price CSV", () => {
  it("parses aliases, ignores unknown columns, rejects duplicates and bad rows with line numbers", () => {
    const csv = "sapItemCode,productName,unitPrice,currency\r\nA1,Apple,1.25,usd\r\nA2,Pear,abc,USD\r\nA1,Apple again,2,USD\r\nA3,Plum,3,EUR\r\n";
    const { rows, errors } = parseCustomerPriceCsv(csv);
    expect(rows.map((r) => [r.sapItemCode, r.unitPrice, r.currency])).toEqual([["A1", "1.25", "USD"]]);
    expect(errors.map((e) => e.line)).toEqual([3, 4, 5]);
  });
  it("requires the item and price columns", () => {
    expect(parseCustomerPriceCsv("foo,bar\n1,2").errors[0].message).toMatch(/header/i);
  });
  it("neutralises nothing on import but strips BOM", () => {
    expect(parseCustomerPriceCsv("﻿sapItemCode,unitPrice\nA1,1").rows).toHaveLength(1);
  });
});

describe("order total summary (shared by admin and operational views)", () => {
  const line = (price: string | null, qty = "2", vat: string | null = "STD") => ({ requestedQuantity: qty, customerUnitPrice: price, approvedUnitPrice: null, product: { vatCode: vat } });
  const rates = new Map([["STD", "15"]]);

  it("calculated total, with currency, when every line is priced and taxed", () => {
    const t = summariseOrderTotal({ storedTotal: null, currency: "USD", pricing: pricingFromLines([line("10.0000")], rates) });
    expect(t).toMatchObject({ basis: "CALCULATED", currency: "USD", warning: null });
    expect(Number(t.amount)).toBe(23);
  });
  it("stored total wins when present", () => {
    expect(summariseOrderTotal({ storedTotal: "99.0000", currency: "ZWG", pricing: pricingFromLines([line(null)], rates) })).toMatchObject({ basis: "STORED", amount: "99.0000", currency: "ZWG" });
  });
  it("partial when a line is unpriced: amount covers known lines and a warning says so", () => {
    const t = summariseOrderTotal({ storedTotal: null, currency: "USD", pricing: pricingFromLines([line("10.0000"), line(null)], rates) });
    expect(t.basis).toBe("PARTIAL");
    expect(t.warning).toMatch(/no price/i);
  });
  it("no priced line -> amount is null with a warning, never zero", () => {
    const t = summariseOrderTotal({ storedTotal: null, currency: "USD", pricing: pricingFromLines([line(null)], rates) });
    expect(t).toMatchObject({ basis: "UNAVAILABLE", amount: null });
    expect(t.warning).toBeTruthy();
  });
});
