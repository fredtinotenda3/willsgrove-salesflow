import { parseCsvRecords, stripBom } from "@/lib/csv-parser";

/**
 * Customer-specific pricing: pure rules (no Prisma, no I/O) so they are unit
 * tested and importable anywhere.
 *
 * PRECEDENCE (single, predictable, documented):
 *   1. CUSTOMER_OVERRIDE -- an explicit CustomerProductPrice for this exact
 *      customer + product, in the customer's currency.
 *   2. PRICE_LIST        -- the price in effect on the customer's ASSIGNED
 *      price list (Customer.priceListId).
 *   3. (none)            -- NO price. There is deliberately no third "default"
 *      tier: the product master carries no selling price, and falling back to
 *      another customer's or an unrelated list's price is never allowed.
 *      A missing price is reported as missing, never invented.
 *
 * CURRENCY: USD and ZWG are never mixed. An override is applied only when its
 * currency equals the customer's effective currency; a mismatching override is
 * skipped and surfaced, not silently converted.
 */

export type PriceSource = "CUSTOMER_OVERRIDE" | "PRICE_LIST";

export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  CUSTOMER_OVERRIDE: "Customer-specific price",
  PRICE_LIST: "Price list",
};

export const SUPPORTED_CURRENCIES = ["USD", "ZWG"] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string | null | undefined): value is SupportedCurrency {
  return value === "USD" || value === "ZWG";
}

const PRICE_PATTERN = /^\d{1,14}(\.\d{1,4})?$/;

export type PriceValidation = { ok: true; value: string } | { ok: false; message: string };

/** A unit price must be a positive decimal with at most 4 decimal places. Zero is rejected: a "free" product is never implied by a typo. */
export function validateUnitPrice(raw: unknown): PriceValidation {
  if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, message: "Enter a unit price." };
  const text = (typeof raw === "number" ? String(raw) : raw).trim();
  if (!PRICE_PATTERN.test(text)) return { ok: false, message: "Price must be a number with up to 4 decimal places (for example 2.50)." };
  if (!/[1-9]/.test(text)) return { ok: false, message: "Price must be greater than zero." };
  return { ok: true, value: text };
}

/** Normalises to a fixed 4dp string so equal prices compare equal ("2.5" === "2.5000"). */
export function normalizePrice(value: string): string {
  const [int, frac = ""] = value.split(".");
  return `${BigInt(int).toString()}.${frac.padEnd(4, "0")}`;
}

export function pricesEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  return normalizePrice(a) === normalizePrice(b);
}

/**
 * The applicable-price rule over already-fetched facts. The server resolver
 * (lib/pricing/resolve.ts) gathers the facts; the decision lives here.
 */
export type PriceFacts = {
  override: { id: string; unitPrice: string; currencyCode: string } | null;
  listPrice: { unitPrice: string; priceListCode: string } | null;
  /** The customer's effective currency: assigned price list currency, else Customer.currencyCode. Null when neither is known. */
  customerCurrency: string | null;
};

export type ApplicablePrice =
  | { found: true; unitPrice: string; currencyCode: string; source: PriceSource; overrideId: string | null; priceListCode: string | null; skippedOverrideForCurrency: boolean }
  | { found: false; reason: "NO_PRICE" | "NO_PRICE_LIST_AND_NO_OVERRIDE"; skippedOverrideForCurrency: boolean };

export function chooseApplicablePrice(facts: PriceFacts, listCurrency: string | null): ApplicablePrice {
  const { override, listPrice, customerCurrency } = facts;
  const overrideUsable = override !== null && (customerCurrency === null || override.currencyCode === customerCurrency);
  const skipped = override !== null && !overrideUsable;

  if (override && overrideUsable) {
    return {
      found: true,
      unitPrice: override.unitPrice,
      currencyCode: override.currencyCode,
      source: "CUSTOMER_OVERRIDE",
      overrideId: override.id,
      priceListCode: listPrice?.priceListCode ?? null,
      skippedOverrideForCurrency: false,
    };
  }
  if (listPrice && listCurrency) {
    return { found: true, unitPrice: listPrice.unitPrice, currencyCode: listCurrency, source: "PRICE_LIST", overrideId: null, priceListCode: listPrice.priceListCode, skippedOverrideForCurrency: skipped };
  }
  return { found: false, reason: listCurrency === null && !override ? "NO_PRICE_LIST_AND_NO_OVERRIDE" : "NO_PRICE", skippedOverrideForCurrency: skipped };
}

// ---------------------------------------------------------------------------
// CSV import / export
// ---------------------------------------------------------------------------

export const CUSTOMER_PRICE_CSV_HEADER = ["customerCode", "customerName", "sapItemCode", "productName", "currency", "unitPrice", "notes"] as const;

export type CustomerPriceCsvRow = {
  line: number;
  customerCode: string | null;
  sapItemCode: string;
  unitPrice: string;
  currency: string | null;
  notes: string | null;
};

export type CustomerPriceCsvError = { line: number; message: string };

const HEADER_ALIASES: Record<string, string> = {
  customercode: "customerCode",
  sapcustomercode: "customerCode",
  customer: "customerCode",
  itemcode: "sapItemCode",
  sapitemcode: "sapItemCode",
  item: "sapItemCode",
  productcode: "sapItemCode",
  unitprice: "unitPrice",
  price: "unitPrice",
  currency: "currency",
  currencycode: "currency",
  notes: "notes",
  note: "notes",
};

const MAX_IMPORT_ROWS = 5000;

/** Parses an import file. Unknown columns (customerName, productName...) are ignored; only the aliases above are read. */
export function parseCustomerPriceCsv(text: string): { rows: CustomerPriceCsvRow[]; errors: CustomerPriceCsvError[] } {
  const records = parseCsvRecords(stripBom(text)).filter((r) => r.some((cell) => cell.trim() !== ""));
  if (records.length === 0) return { rows: [], errors: [{ line: 1, message: "The file is empty." }] };

  const header = records[0].map((cell) => HEADER_ALIASES[cell.trim().toLowerCase().replace(/[\s_-]/g, "")] ?? null);
  const col = (name: string) => header.indexOf(name);
  const itemCol = col("sapItemCode");
  const priceCol = col("unitPrice");
  if (itemCol < 0 || priceCol < 0) {
    return { rows: [], errors: [{ line: 1, message: "The header must contain an item code column (sapItemCode) and a price column (unitPrice)." }] };
  }
  if (records.length - 1 > MAX_IMPORT_ROWS) {
    return { rows: [], errors: [{ line: 1, message: `A file may contain at most ${MAX_IMPORT_ROWS} rows; split it and import in parts.` }] };
  }

  const rows: CustomerPriceCsvRow[] = [];
  const errors: CustomerPriceCsvError[] = [];
  const seen = new Set<string>();
  const customerCol = col("customerCode");
  const currencyCol = col("currency");
  const notesCol = col("notes");

  records.slice(1).forEach((record, index) => {
    const line = index + 2;
    const sapItemCode = (record[itemCol] ?? "").trim();
    const customerCode = customerCol >= 0 ? (record[customerCol] ?? "").trim() || null : null;
    if (!sapItemCode) return void errors.push({ line, message: "Item code is missing." });
    const price = validateUnitPrice((record[priceCol] ?? "").trim());
    if (!price.ok) return void errors.push({ line, message: `${sapItemCode}: ${price.message}` });
    const currencyRaw = currencyCol >= 0 ? (record[currencyCol] ?? "").trim().toUpperCase() : "";
    if (currencyRaw && !isSupportedCurrency(currencyRaw)) return void errors.push({ line, message: `${sapItemCode}: currency must be USD or ZWG.` });
    const key = `${customerCode ?? ""}|${sapItemCode}`;
    if (seen.has(key)) return void errors.push({ line, message: `${sapItemCode}: appears more than once${customerCode ? ` for customer ${customerCode}` : ""}.` });
    seen.add(key);
    rows.push({ line, customerCode, sapItemCode, unitPrice: price.value, currency: currencyRaw || null, notes: notesCol >= 0 ? (record[notesCol] ?? "").trim() || null : null });
  });

  return { rows, errors };
}
