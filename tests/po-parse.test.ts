import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "@/lib/po-parse/pdf-text";
import { parseTable } from "@/lib/po-parse/table-parser";
import { parseFreeText, parseItemText } from "@/lib/po-parse/text-parser";
import { extractHeader } from "@/lib/po-parse/header";
import { parsePackSize, parseDateFromText, parseQuantityNumber, packSizesEqual } from "@/lib/po-parse/units";
import { scoreProductMatch } from "@/lib/matching/product-scorer";
import { scoreCustomerName } from "@/lib/po-parse/customer-score";

function item(text: string) {
  const r = parseItemText(text);
  if (!r) throw new Error(`not parsed: ${text}`);
  return r;
}

describe("free-text order lines", () => {
  it.each([
    ["blueberries 125 x 14", "blueberries 125g", 14, null],
    ["strawberries 400g x 6", "strawberries 400g", 6, null],
    ["Brinjals also x 2 punnets", "Brinjals", 2, "PNT"],
    ["2kg onions white", "onions white", 2, "KG"],
    ["Blueberries 125g x 6 punnets", "Blueberries 125g", 6, "PNT"],
    ["Clean cauliflower heads x 2", "Clean cauliflower heads", 2, null],
    ["10 x apples", "apples", 10, null],
    ["Apples (10)", "Apples", 10, null],
    ["two kg tomatoes", "tomatoes", 2, "KG"],
    ["a dozen eggs", "eggs", 1, "DOZ"],
    ["3 boxes tomatoes", "tomatoes", 3, "BOX"],
  ])("%s", (text, description, quantity, unit) => {
    const r = item(text);
    expect(r.description).toBe(description);
    expect(r.quantity).toBe(quantity);
    expect(r.unit).toBe(unit);
  });

  it("treats a bare weight as a measure and asks for confirmation", () => {
    const r = item("Mangoes 2.5kg");
    expect(r.measureOnly).toBe(true);
    expect(r.quantity).toBe(2.5);
    expect(r.unit).toBe("KG");
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("parses the whole sample message and ignores greetings", () => {
    const text = ["Hi team", "blueberries 125 x 14", "oranges 6s x 1", "Mixed apples x 2", "Peaches 2kg", "Thanks"].join("\n");
    const { lines, skipped } = parseFreeText(text);
    expect(lines.map((l) => l.description)).toEqual(["blueberries 125g", "oranges 6s", "Mixed apples", "Peaches 2kg"]);
    expect(skipped).toEqual(["Hi team", "Thanks"]);
    expect(lines[0]!.packSize).toBe("125G");
    expect(parseFreeText("Clean cauliflower heads x 2").lines[0]!.unit).toBe("HEAD");
  });

  it("never invents a quantity", () => {
    const { lines } = parseFreeText("tomatoes\nonions\ncarrots x 2");
    expect(lines.find((l) => l.description === "carrots")!.quantity).toBe("2");
    for (const l of lines.filter((x) => x.description !== "carrots")) expect(l.quantity).toBeNull();
  });

  it("splits comma separated items that each carry a quantity", () => {
    const { lines } = parseFreeText("tomatoes 5kg, onions 3kg; potatoes 10kg");
    expect(lines).toHaveLength(3);
  });

  it("strips WhatsApp timestamps and list markers", () => {
    const { lines } = parseFreeText("[12/03/2026, 08:15] Tendai: 2 x cabbage\n- 3 x lettuce");
    expect(lines.map((l) => [l.description, l.quantity])).toEqual([["cabbage", "2"], ["lettuce", "3"]]);
  });
});

describe("units and dates", () => {
  it("parses quantities", () => {
    expect(parseQuantityNumber("2,5")).toBe(2.5);
    expect(parseQuantityNumber("1,250")).toBe(1250);
    expect(parseQuantityNumber("1/2")).toBe(0.5);
    expect(parseQuantityNumber("abc")).toBeNull();
  });
  it("compares pack sizes numerically", () => {
    expect(packSizesEqual(parsePackSize("125g")!, parsePackSize("125G")!)).toBe(true);
    expect(packSizesEqual(parsePackSize("1kg")!, parsePackSize("1000g")!)).toBe(true);
    expect(packSizesEqual(parsePackSize("125g")!, parsePackSize("250g")!)).toBe(false);
  });
  it("reads day-first dates and rejects impossible ones", () => {
    expect(parseDateFromText("Date 26/11/2026")).toBe("2026-11-26");
    expect(parseDateFromText("31/02/2026")).toBeNull();
    expect(parseDateFromText("5 March 2026")).toBe("2026-03-05");
  });
});

describe("PDF purchase order", () => {
  const pdf = readFileSync(path.join(__dirname, "fixtures", "purchase-order-180506.pdf"));
  const extracted = extractPdfText(pdf);

  it("extracts the text layer", () => {
    expect(extracted.ok).toBe(true);
  });

  it("reads all 43 lines with quantity and the customer's price", () => {
    if (!extracted.ok) throw new Error("no text");
    const table = parseTable(extracted.pages.flat());
    expect(table?.lines).toHaveLength(43);
    const fuji = table!.lines[0]!;
    expect(fuji.description).toBe("APPLE FUJI 1.5KG");
    expect(fuji.quantity).toBe("32");
    expect(fuji.unitPrice).toBe("2.75");
    expect(fuji.customerItemCode).toBe("110001");
  });

  it("reads the header and never offers our own company as the customer", () => {
    if (!extracted.ok) throw new Error("no text");
    const header = extractHeader(extracted.pages.flat());
    expect(header.poNumber).toBe("180506");
    expect(header.orderDate).toBe("2026-11-26");
    expect(header.requestedDeliveryDate).toBe("2026-11-26");
    expect(header.customerNameCandidates).toEqual(["Bindura"]);
    expect(header.customerNameCandidates.join(" ")).not.toMatch(/willsgrove|wilfar/i);
  });

  it("rejects non-PDF bytes cleanly", () => {
    expect(extractPdfText(Buffer.from("hello")).ok).toBe(false);
  });
});

describe("product scoring", () => {
  const s = (a: string, b: string) => scoreProductMatch(a, b).score;
  it("prefers the matching pack size", () => {
    expect(s("blueberries 125g", "Blueberries 125G Pnt")).toBeGreaterThan(s("blueberries 125g", "Blueberries 250G Pnt"));
  });
  it("handles spelling and plural variants", () => {
    expect(s("blueberries 125g", "Blue Berries Pnp 125G")).toBeGreaterThan(0.6);
    expect(s("brinjals", "Baby Brinjals 250G Pnt")).toBeGreaterThan(0.4);
    expect(s("broccolli 300g", "Broccoli 300G Pnt")).toBeGreaterThan(0.7);
  });
  it("does not confuse different products", () => {
    expect(s("strawberries", "Blueberries 125G Pnt")).toBe(0);
  });
  it("trusts a matching item code", () => {
    expect(scoreProductMatch("x", "Anything", undefined, { wrote: "0228", candidateCode: "0228" }).score).toBeGreaterThan(0.9);
  });
});

describe("customer scoring", () => {
  it("matches a store name inside a numbered SAP name", () => {
    expect(scoreCustomerName("Bindura", "1043-OK Supermarkets Bindura")).toBeGreaterThan(0.6);
    expect(scoreCustomerName("St Annes Hospital", "St Annes Hospital T/A Mary Mother F Hope")).toBeGreaterThan(0.7);
    expect(scoreCustomerName("Bindura", "Choppies Harare")).toBe(0);
  });
});
