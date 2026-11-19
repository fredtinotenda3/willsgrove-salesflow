import { checkHeaders, parseCsvRecords, stripBom } from "@/lib/csv-parser";

// Column layout documented in full, with a real sample row (customer
// HREC0D677 / TM Supermarkets - Chinhoyi North, matching invoice
// HRE580108's header), at docs/sap-exports/customer-master.csv.md.
//
// Real Business Data Onboarding round: this "rich" 18-column layout was
// generalized from that ONE confirmed invoice header and, it turns out,
// was never what the company's actual bulk Business Partner export looks
// like. The real `List_of_Business_Partners.xlsx` export has only 6
// columns (#, BP Code, BP Name, Account Balance, Account Balance FC, Gaap
// Supplier Code) -- no TIN/VAT/currency/price-list/address/contact at
// all. Every real import attempt failed at the header-check stage before
// a single row was read, because checkHeaders() below is bidirectional
// (rejects BOTH missing AND unexpected columns): the real file is missing
// 16 of these 18 columns and has none of the 4 columns of its own
// recognized.
//
// Fix: this module now recognizes TWO layouts -- RICH (this exact legacy
// 18-column shape, byte-for-byte unchanged behavior, still covers a
// future richer SAP export if one ever arrives) and LEAN (the real,
// confirmed Business Partner list shape, see LEAN_REQUIRED_HEADERS
// below). Detection tries RICH first (exact match wins, so nothing about
// the original behavior or its existing tests changes), then LEAN; a
// header set matching neither still produces the exact original
// "Missing columns: ..." error a RICH-shaped file would need, so a file
// that is neither recognized shape fails exactly as before rather than
// silently guessing.
export interface CustomerMasterRow {
  customerCode: string;
  customerName: string;
  tin: string | null;
  vatNumber: string | null;
  currencyCode: string | null;
  priceListCode: string | null;
  paymentTermsCode: string | null;
  branchCode: string | null;
  storeCode: string | null;
  creditLimit: string | null; // decimal-shaped string, or null
  creditHold: boolean;
  addressLine1: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  sourceData: Record<string, string>;
}

export type CustomerMasterLayout = "RICH" | "LEAN";

export interface CustomerMasterCsvError {
  row: number;
  message: string;
}

export interface CustomerMasterCsvParseResult {
  success: boolean;
  rows: CustomerMasterRow[];
  errors: CustomerMasterCsvError[];
  duplicateCodes: string[];
  totalRows: number;
  // Which layout was actually detected -- "RICH" when every one of the 18
  // legacy columns was present (unchanged original behavior), "LEAN" for
  // the real Business Partner list shape. Undefined when neither matched
  // (a hard header error -- see `errors`).
  layout?: CustomerMasterLayout;
  // Only ever populated for LEAN. Account Balance / Account Balance FC /
  // Gaap Supplier Code have no corresponding Customer column -- spec's
  // "do not invent missing customer information" cuts both ways: this
  // importer will not silently invent new schema to hold them, but it
  // also will not silently discard real source data without a trace.
  // Each row's raw values (when non-blank) live in that row's own
  // `sourceData`, and this flag + count tells the caller/preview UI that
  // real data exists in the source file that is NOT being written
  // anywhere -- an explicit, visible fact for the operator to decide on
  // (see IMPLEMENTATION-REPORT.md's open question), not a silent drop.
  unmappedInformationalColumns?: string[];
}

const RICH_HEADERS = [
  "CUSTOMER_CODE",
  "CUSTOMER_NAME",
  "TIN",
  "VAT_REG",
  "CURRENCY",
  "PRICE_LIST_CODE",
  "PAYMENT_TERMS",
  "BRANCH_CODE",
  "STORE_CODE",
  "CREDIT_LIMIT",
  "CREDIT_HOLD",
  "ADDRESS_LINE1",
  "CITY",
  "PHONE",
  "EMAIL",
  "CONTACT_NAME",
  "CONTACT_EMAIL",
  "CONTACT_PHONE",
] as const;

// The real, confirmed shape of List_of_Business_Partners.xlsx once
// converted straight to CSV (headers upper-cased/trimmed the same way
// RICH_HEADERS are matched below). Only BP CODE and BP NAME are required
// -- "#" is just the export's own row number (ignored entirely, not even
// captured) and the other three are informational-only (see
// `unmappedInformationalColumns` above).
const LEAN_REQUIRED_HEADERS = ["BP CODE", "BP NAME"] as const;
const LEAN_INFORMATIONAL_HEADERS = ["ACCOUNT BALANCE", "ACCOUNT BALANCE FC", "GAAP SUPPLIER CODE"] as const;

const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const DECIMAL_PATTERN = /^\d+(\.\d{1,2})?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TRUE_VALUES = new Set(["Y", "YES", "TRUE", "1"]);
const FALSE_VALUES = new Set(["N", "NO", "FALSE", "0", ""]);

export function parseSapCustomerMasterCsv(csvText: string): CustomerMasterCsvParseResult {
  const rows: CustomerMasterRow[] = [];
  const errors: CustomerMasterCsvError[] = [];
  const duplicateCodes: string[] = [];
  const seenCodes = new Set<string>();

  let records: string[][];

  try {
    records = parseCsvRecords(stripBom(csvText));
  } catch (error) {
    return {
      success: false,
      rows: [],
      errors: [{ row: 1, message: error instanceof Error ? error.message : "Unable to parse CSV file." }],
      duplicateCodes: [],
      totalRows: 0,
    };
  }

  if (records.length < 2) {
    return {
      success: false,
      rows: [],
      errors: [{ row: 1, message: "CSV must contain a header and at least one row." }],
      duplicateCodes: [],
      totalRows: 0,
    };
  }

  const headers = records[0].map((header) => header.trim().toUpperCase());
  const richHeaderCheck = checkHeaders(headers, RICH_HEADERS);
  const layout: CustomerMasterLayout | null = richHeaderCheck.ok
    ? "RICH"
    : LEAN_REQUIRED_HEADERS.every((h) => headers.includes(h))
      ? "LEAN"
      : null;

  if (layout === null) {
    // Neither recognized shape matched. Report the RICH-layout header
    // error (identical message/behavior to before this change existed)
    // rather than a LEAN-specific one -- RICH is still this module's
    // "default" documented shape, so an unrecognized file's error should
    // look the same as it always has, not newly mention LEAN's columns
    // and confuse an operator who was never trying to use that layout.
    return {
      success: false,
      rows: [],
      errors: [{ row: 1, message: richHeaderCheck.message ?? "Invalid header row." }],
      duplicateCodes: [],
      totalRows: records.length - 1,
    };
  }

  if (layout === "LEAN") {
    return parseLeanLayout(records, headers);
  }

  const col = Object.fromEntries(RICH_HEADERS.map((h) => [h, headers.indexOf(h)])) as Record<
    (typeof RICH_HEADERS)[number],
    number
  >;

  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    const rowNumber = index + 1;

    if (record.length !== headers.length) {
      errors.push({ row: rowNumber, message: `Expected ${headers.length} columns but found ${record.length}.` });
      continue;
    }

    const get = (key: (typeof RICH_HEADERS)[number]) => record[col[key]].trim();

    const customerCode = get("CUSTOMER_CODE");
    const customerName = get("CUSTOMER_NAME");
    const tin = get("TIN");
    const vatReg = get("VAT_REG");
    const currency = get("CURRENCY").toUpperCase();
    const priceListCode = get("PRICE_LIST_CODE");
    const paymentTerms = get("PAYMENT_TERMS");
    const branchCode = get("BRANCH_CODE");
    const storeCode = get("STORE_CODE");
    const creditLimitRaw = get("CREDIT_LIMIT");
    const creditHoldRaw = get("CREDIT_HOLD");
    const addressLine1 = get("ADDRESS_LINE1");
    const city = get("CITY");
    const phone = get("PHONE");
    const email = get("EMAIL");
    const contactName = get("CONTACT_NAME");
    const contactEmail = get("CONTACT_EMAIL");
    const contactPhone = get("CONTACT_PHONE");

    const rowErrors: string[] = [];

    if (!customerCode) rowErrors.push("CUSTOMER_CODE is required.");
    if (!customerName) rowErrors.push("CUSTOMER_NAME is required.");
    if (currency && !CURRENCY_PATTERN.test(currency)) rowErrors.push(`CURRENCY must be blank or a 3-letter code (got "${currency}").`);
    if (creditLimitRaw && !DECIMAL_PATTERN.test(creditLimitRaw)) rowErrors.push(`CREDIT_LIMIT must be blank or a non-negative number (got "${creditLimitRaw}").`);
    if (email && !EMAIL_PATTERN.test(email)) rowErrors.push(`EMAIL is not a valid address ("${email}").`);
    if (contactEmail && !EMAIL_PATTERN.test(contactEmail)) rowErrors.push(`CONTACT_EMAIL is not a valid address ("${contactEmail}").`);

    const upperCreditHold = creditHoldRaw.toUpperCase();
    let creditHold = false;
    if (TRUE_VALUES.has(upperCreditHold)) {
      creditHold = true;
    } else if (!FALSE_VALUES.has(upperCreditHold)) {
      rowErrors.push(`CREDIT_HOLD must be Y or N (got "${creditHoldRaw}").`);
    }

    if (customerCode) {
      if (seenCodes.has(customerCode)) {
        duplicateCodes.push(customerCode);
        rowErrors.push(`Duplicate CUSTOMER_CODE: ${customerCode}.`);
      } else {
        seenCodes.add(customerCode);
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, message: rowErrors.join(" ") });
      continue;
    }

    rows.push({
      customerCode,
      customerName,
      tin: tin || null,
      vatNumber: vatReg || null,
      currencyCode: currency || null,
      priceListCode: priceListCode || null,
      paymentTermsCode: paymentTerms || null,
      branchCode: branchCode || null,
      storeCode: storeCode || null,
      creditLimit: creditLimitRaw || null,
      creditHold,
      addressLine1: addressLine1 || null,
      city: city || null,
      phone: phone || null,
      email: email || null,
      contactName: contactName || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      sourceData: {
        CUSTOMER_CODE: customerCode,
        CUSTOMER_NAME: customerName,
        TIN: tin,
        VAT_REG: vatReg,
        CURRENCY: currency,
        PRICE_LIST_CODE: priceListCode,
        PAYMENT_TERMS: paymentTerms,
        BRANCH_CODE: branchCode,
        STORE_CODE: storeCode,
        CREDIT_LIMIT: creditLimitRaw,
        CREDIT_HOLD: creditHoldRaw,
        ADDRESS_LINE1: addressLine1,
        CITY: city,
        PHONE: phone,
        EMAIL: email,
        CONTACT_NAME: contactName,
        CONTACT_EMAIL: contactEmail,
        CONTACT_PHONE: contactPhone,
      },
    });
  }

  return {
    success: errors.length === 0 && rows.length > 0,
    rows,
    errors,
    duplicateCodes: [...new Set(duplicateCodes)],
    totalRows: records.length - 1,
    layout: "RICH",
  };
}

// LEAN layout: the real Business Partner list shape (BP CODE, BP NAME,
// plus the three informational-only columns -- see this module's top
// comment). Only customerCode/customerName are populated; every other
// CustomerMasterRow field is null, since the source file genuinely has
// no data for them -- never fabricated.
function parseLeanLayout(records: string[][], headers: string[]): CustomerMasterCsvParseResult {
  const rows: CustomerMasterRow[] = [];
  const errors: CustomerMasterCsvError[] = [];
  const duplicateCodes: string[] = [];
  const seenCodes = new Set<string>();

  const codeIndex = headers.indexOf("BP CODE");
  const nameIndex = headers.indexOf("BP NAME");
  const informationalIndexes = LEAN_INFORMATIONAL_HEADERS.map((h) => ({ header: h, index: headers.indexOf(h) })).filter(
    (h) => h.index !== -1,
  );
  const unmappedInformationalColumns = informationalIndexes.map((h) => h.header);

  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    const rowNumber = index + 1;

    if (record.length !== headers.length) {
      errors.push({ row: rowNumber, message: `Expected ${headers.length} columns but found ${record.length}.` });
      continue;
    }

    const customerCode = (record[codeIndex] ?? "").trim();
    const customerName = (record[nameIndex] ?? "").trim();

    const rowErrors: string[] = [];
    if (!customerCode) rowErrors.push("BP CODE is required.");
    if (!customerName) rowErrors.push("BP NAME is required.");

    if (customerCode) {
      if (seenCodes.has(customerCode)) {
        duplicateCodes.push(customerCode);
        rowErrors.push(`Duplicate BP CODE: ${customerCode}.`);
      } else {
        seenCodes.add(customerCode);
      }
    }

    if (rowErrors.length > 0) {
      errors.push({ row: rowNumber, message: rowErrors.join(" ") });
      continue;
    }

    const sourceData: Record<string, string> = {
      "BP CODE": customerCode,
      "BP NAME": customerName,
    };
    for (const { header, index: colIndex } of informationalIndexes) {
      sourceData[header] = (record[colIndex] ?? "").trim();
    }

    rows.push({
      customerCode,
      customerName,
      tin: null,
      vatNumber: null,
      currencyCode: null,
      priceListCode: null,
      paymentTermsCode: null,
      branchCode: null,
      storeCode: null,
      creditLimit: null,
      creditHold: false,
      addressLine1: null,
      city: null,
      phone: null,
      email: null,
      contactName: null,
      contactEmail: null,
      contactPhone: null,
      sourceData,
    });
  }

  return {
    success: errors.length === 0 && rows.length > 0,
    rows,
    errors,
    duplicateCodes: [...new Set(duplicateCodes)],
    totalRows: records.length - 1,
    layout: "LEAN",
    unmappedInformationalColumns,
  };
}
