import { checkHeaders, parseCsvRecords, stripBom } from "@/lib/csv-parser";

// Column layout documented in full, with a real sample row (customer
// HREC0D677 / TM Supermarkets - Chinhoyi North, matching invoice
// HRE580108's header), at docs/sap-exports/customer-master.csv.md.
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
}

const REQUIRED_HEADERS = [
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
  const headerCheck = checkHeaders(headers, REQUIRED_HEADERS);

  if (!headerCheck.ok) {
    return {
      success: false,
      rows: [],
      errors: [{ row: 1, message: headerCheck.message ?? "Invalid header row." }],
      duplicateCodes: [],
      totalRows: records.length - 1,
    };
  }

  const col = Object.fromEntries(REQUIRED_HEADERS.map((h) => [h, headers.indexOf(h)])) as Record<
    (typeof REQUIRED_HEADERS)[number],
    number
  >;

  for (let index = 1; index < records.length; index++) {
    const record = records[index];
    const rowNumber = index + 1;

    if (record.length !== headers.length) {
      errors.push({ row: rowNumber, message: `Expected ${headers.length} columns but found ${record.length}.` });
      continue;
    }

    const get = (key: (typeof REQUIRED_HEADERS)[number]) => record[col[key]].trim();

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
  };
}
