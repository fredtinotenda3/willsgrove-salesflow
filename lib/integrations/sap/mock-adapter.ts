import type { SapProductRow } from "@/lib/sap-product-csv";
import type { CustomerMasterRow } from "@/lib/sap-customer-master-csv";
import type { GroupedInvoiceHeader } from "@/lib/invoice-reconciliation/csv";
import type { GroupedCreditNoteRow } from "@/lib/returns-credits/csv";
import {
  SapAdapterError,
  type SapAdapter,
  type SapConnectionHealth,
  type SapSalesOrderLookupResult,
  type SapSalesOrderResult,
  type SapSalesOrderSubmission,
} from "@/lib/integrations/sap/types";

/**
 * Milestone 9 (SAP Business One Integration). Deterministic mock adapter
 * -- the SAP_B1_PROVIDER=mock default (lib/integrations/sap/config.ts),
 * used for all local development and automated tests, and the only
 * adapter this project can honestly claim is "tested" in the strong
 * sense (spec section 14's unit/mock-tested/real-SAP-tested distinction
 * -- everything through this adapter is MOCK-TESTED, never claimed as
 * REAL-SAP-TESTED).
 *
 * A mock genuinely cannot reach a real SAP Business One company
 * database, so it does not pretend to: it returns a small, fixed,
 * clearly-synthetic fixture catalogue (lib/extraction/providers/mock.ts
 * is this project's own existing precedent for exactly this "no API
 * key, no external call, still genuinely useful for dev/test" shape).
 * Every fixture customer/product code below is also what
 * createSalesOrder validates against, so the whole product-sync ->
 * customer-sync -> order-eligibility -> createSalesOrder chain is
 * internally consistent and actually exercisable end-to-end against
 * this one mock "SAP world," without ever touching a real company
 * database.
 *
 * Idempotency/duplicate-submission simulation: `submittedOrders` is an
 * in-memory Map, scoped to this Node process. That is intentionally
 * weaker than the real guarantee this milestone actually relies on --
 * IntegrationOperation.customerOrderId/idempotencyKey being @unique at
 * the database level (prisma/schema.prisma) -- so a process restart
 * losing this map changes nothing about SalesFlow's own correctness.
 * Its only job is to let an integration test observe "submitting the
 * same idempotencyKey twice returns the same SAP document instead of
 * creating two," which is otherwise hard to exercise against a mock
 * with no state at all.
 *
 * Deterministic failure simulation: spec section 7.2 treats "a network
 * timeout does not prove the request was rejected" as a CRITICAL
 * scenario that must actually be testable, not just designed around on
 * paper. Since this mock cannot literally drop a TCP connection, three
 * sentinel values -- recognised ONLY by this mock, documented here and
 * nowhere advertised to end users -- let a test deliberately drive each
 * failure path:
 *   - customerOrderReference containing "__SIMULATE_TIMEOUT__": the
 *     order IS recorded in `submittedOrders` (simulating "SAP received
 *     and processed it") and THEN a TIMEOUT SapAdapterError is thrown
 *     (simulating "the response never reached SalesFlow") -- this is
 *     the exact lost-response scenario; a caller that then calls
 *     findSalesOrderByExternalReference with the same idempotencyKey
 *     finds the order after all.
 *   - customerOrderReference containing "__SIMULATE_NETWORK_DOWN__": a
 *     NETWORK_UNAVAILABLE SapAdapterError is thrown and NOTHING is
 *     recorded -- the clean, safe-to-retry failure case.
 *   - customerOrderReference containing "__SIMULATE_UNCERTAIN_LOST__":
 *     like TIMEOUT, but the order is deliberately NOT recorded either
 *     -- simulating the worse case where the request never actually
 *     reached SAP at all. A reconciliation lookup afterwards correctly
 *     finds nothing, demonstrating why spec section 7.2 requires this
 *     to resolve to a human decision, never an automatic "assume it
 *     failed, resubmit."
 * None of this is reachable through any normal UI input path -- these
 * strings would have to be hand-crafted into customerOrderReference,
 * which SalesFlow's own order-eligibility.ts builds from the real
 * CustomerOrder.reference column, never from free user text.
 */

export const MOCK_PRODUCTS: SapProductRow[] = [
  {
    sapItemCode: "ITM-0001",
    itemName: "Maize Meal 10kg",
    barcode: "6001234500019",
    category: "Groceries",
    sourceData: { CODE: "ITM-0001", "ITEM DESCRIPTION": "Maize Meal 10kg", BARCODE: "6001234500019", "ITEM GROUP": "Groceries" },
  },
  {
    sapItemCode: "ITM-0002",
    itemName: "Cooking Oil 2L",
    barcode: "6001234500026",
    category: "Groceries",
    sourceData: { CODE: "ITM-0002", "ITEM DESCRIPTION": "Cooking Oil 2L", BARCODE: "6001234500026", "ITEM GROUP": "Groceries" },
  },
  {
    sapItemCode: "ITM-0003",
    itemName: "Sugar 2kg",
    barcode: "6001234500033",
    category: "Groceries",
    sourceData: { CODE: "ITM-0003", "ITEM DESCRIPTION": "Sugar 2kg", BARCODE: "6001234500033", "ITEM GROUP": "Groceries" },
  },
  {
    sapItemCode: "ITM-0004",
    itemName: "Dish Soap 750ml",
    barcode: "6001234500040",
    category: "Household",
    sourceData: { CODE: "ITM-0004", "ITEM DESCRIPTION": "Dish Soap 750ml", BARCODE: "6001234500040", "ITEM GROUP": "Household" },
  },
];

export const MOCK_CUSTOMERS: CustomerMasterRow[] = [
  {
    customerCode: "CUS-0001",
    customerName: "TM Supermarkets - Chinhoyi North",
    tin: "2000123456",
    vatNumber: "VAT100123456",
    currencyCode: "USD",
    priceListCode: "RETAIL",
    paymentTermsCode: "NET30",
    branchCode: "HRE",
    storeCode: "CHN-NORTH",
    creditLimit: "5000.0000",
    creditHold: false,
    addressLine1: "123 Main St",
    city: "Chinhoyi",
    phone: "+263771234567",
    email: "accounts@tm-chinhoyi.example",
    contactName: "J. Moyo",
    contactEmail: "j.moyo@tm-chinhoyi.example",
    contactPhone: "+263771234567",
    sourceData: { CUSTOMER_CODE: "CUS-0001", CUSTOMER_NAME: "TM Supermarkets - Chinhoyi North" },
  },
  {
    customerCode: "CUS-0002",
    customerName: "Bon Marche - Harare CBD",
    tin: "2000123457",
    vatNumber: "VAT100123457",
    currencyCode: "USD",
    priceListCode: "RETAIL",
    paymentTermsCode: "NET30",
    branchCode: "HRE",
    storeCode: "CBD-01",
    creditLimit: "8000.0000",
    creditHold: false,
    addressLine1: "45 Samora Machel Ave",
    city: "Harare",
    phone: "+263772345678",
    email: "accounts@bonmarche-cbd.example",
    contactName: "P. Ncube",
    contactEmail: "p.ncube@bonmarche-cbd.example",
    contactPhone: "+263772345678",
    sourceData: { CUSTOMER_CODE: "CUS-0002", CUSTOMER_NAME: "Bon Marche - Harare CBD" },
  },
];

export const MOCK_INVOICES: GroupedInvoiceHeader[] = [
  {
    groupKey: "docEntry:9001",
    docEntry: "9001",
    docNum: "INV-9001",
    customerCode: "CUS-0001",
    customerName: "TM Supermarkets - Chinhoyi North",
    invoiceDate: "2026-11-01",
    currency: "USD",
    documentStatus: "Open",
    orderReference: "SO-MOCK-0001",
    subtotal: "100.0000",
    taxTotal: "15.0000",
    total: "115.0000",
    isCancelledOrReversed: false,
    lines: [
      {
        rowIndex: 1,
        docEntry: "9001",
        docNum: "INV-9001",
        customerCode: "CUS-0001",
        customerName: "TM Supermarkets - Chinhoyi North",
        invoiceDate: "2026-11-01",
        currency: "USD",
        documentStatus: "Open",
        orderReference: "SO-MOCK-0001",
        subtotal: "100.0000",
        taxTotal: "15.0000",
        total: "115.0000",
        lineNumber: "1",
        itemCode: "ITM-0001",
        itemDescription: "Maize Meal 10kg",
        quantity: "10",
        unitOfMeasure: "EA",
        unitPrice: "10.0000",
        discount: "0",
        taxCode: "VAT15",
        lineTotal: "100.0000",
        docLineNum: "0",
        rawSourceData: {},
      },
    ],
    firstRowSourceData: {},
  },
];

export const MOCK_CREDIT_NOTES: GroupedCreditNoteRow[] = [
  {
    groupKey: "docEntry:8001",
    docEntry: "8001",
    docNum: "CN-8001",
    baseInvoiceDocEntry: "9001",
    baseInvoiceDocNum: "INV-9001",
    creditNoteDate: "2026-11-05",
    currency: "USD",
    amount: "11.5000",
    notes: "Mock short-delivery credit",
    rows: [
      {
        rowIndex: 1,
        docEntry: "8001",
        docNum: "CN-8001",
        baseInvoiceDocEntry: "9001",
        baseInvoiceDocNum: "INV-9001",
        creditNoteDate: "2026-11-05",
        currency: "USD",
        amount: "11.5000",
        notes: "Mock short-delivery credit",
        rawSourceData: {},
      },
    ],
    firstRowSourceData: {},
  },
];

const MOCK_PRODUCT_CODES = new Set(MOCK_PRODUCTS.map((p) => p.sapItemCode));
const MOCK_CUSTOMER_CODES = new Set(MOCK_CUSTOMERS.map((c) => c.customerCode));

const DECIMAL_STRING_PATTERN = /^\d+(\.\d{1,4})?$/;

let nextDocEntrySeq = 10000;

interface MockOrderRecord {
  idempotencyKey: string;
  customerOrderReference: string;
  result: SapSalesOrderResult;
}

const submittedOrders = new Map<string, MockOrderRecord>(); // key: idempotencyKey
const ordersByDocEntry = new Map<string, MockOrderRecord>();

export class MockSapAdapter implements SapAdapter {
  async testConnection(): Promise<SapConnectionHealth> {
    return { ok: true, checkedAt: new Date().toISOString(), message: "Mock SAP adapter: no real connection attempted." };
  }

  async getConnectionHealth(): Promise<SapConnectionHealth> {
    return this.testConnection();
  }

  async fetchProducts(): Promise<SapProductRow[]> {
    return MOCK_PRODUCTS;
  }

  async fetchCustomers(): Promise<CustomerMasterRow[]> {
    return MOCK_CUSTOMERS;
  }

  async fetchInvoices(since?: Date): Promise<GroupedInvoiceHeader[]> {
    if (!since) return MOCK_INVOICES;
    return MOCK_INVOICES.filter((invoice) => !invoice.invoiceDate || new Date(invoice.invoiceDate) >= since);
  }

  async fetchCreditNotes(since?: Date): Promise<GroupedCreditNoteRow[]> {
    if (!since) return MOCK_CREDIT_NOTES;
    return MOCK_CREDIT_NOTES.filter((note) => !note.creditNoteDate || new Date(note.creditNoteDate) >= since);
  }

  async createSalesOrder(submission: SapSalesOrderSubmission): Promise<SapSalesOrderResult> {
    const existing = submittedOrders.get(submission.idempotencyKey);
    if (existing) {
      // Spec section 7.2: resubmitting the same idempotencyKey must
      // return the SAME document, never create a second one.
      return existing.result;
    }

    if (submission.customerOrderReference.includes("__SIMULATE_NETWORK_DOWN__")) {
      throw new SapAdapterError("NETWORK_UNAVAILABLE", "Mock-simulated network failure: no request reached SAP.");
    }
    if (submission.customerOrderReference.includes("__SIMULATE_UNCERTAIN_LOST__")) {
      throw new SapAdapterError(
        "TIMEOUT",
        "Mock-simulated timeout: whether SAP received this request cannot be determined from this response alone."
      );
    }

    if (!MOCK_CUSTOMER_CODES.has(submission.sapCustomerCode)) {
      throw new SapAdapterError("MISSING_CUSTOMER_MAPPING", `Mock SAP has no customer with code "${submission.sapCustomerCode}".`);
    }
    if (submission.lines.length === 0) {
      throw new SapAdapterError("VALIDATION_FAILURE", "A sales order must have at least one line.");
    }
    for (const line of submission.lines) {
      if (!MOCK_PRODUCT_CODES.has(line.sapItemCode)) {
        throw new SapAdapterError("MISSING_PRODUCT_MAPPING", `Mock SAP has no item with code "${line.sapItemCode}".`);
      }
      if (!DECIMAL_STRING_PATTERN.test(line.quantity) || Number(line.quantity) <= 0) {
        throw new SapAdapterError("INVALID_QUANTITY", `Line ${line.lineNumber}: quantity "${line.quantity}" is not a positive number.`);
      }
      if (!DECIMAL_STRING_PATTERN.test(line.unitPrice) || Number(line.unitPrice) < 0) {
        throw new SapAdapterError("INVALID_PRICE", `Line ${line.lineNumber}: unit price "${line.unitPrice}" is not a valid non-negative number.`);
      }
    }

    const sapDocEntry = String(nextDocEntrySeq++);
    const result: SapSalesOrderResult = {
      sapDocEntry,
      sapDocNum: `SO-${sapDocEntry}`,
      documentDate: submission.documentDate,
    };
    const record: MockOrderRecord = {
      idempotencyKey: submission.idempotencyKey,
      customerOrderReference: submission.customerOrderReference,
      result,
    };

    if (submission.customerOrderReference.includes("__SIMULATE_TIMEOUT__")) {
      // Simulate "SAP processed the request successfully, but the
      // response never reached SalesFlow" -- the order IS recorded here
      // (so a reconciliation lookup afterwards finds it), but the caller
      // still gets a thrown TIMEOUT, exactly as if the HTTP response had
      // been lost in transit.
      submittedOrders.set(submission.idempotencyKey, record);
      ordersByDocEntry.set(sapDocEntry, record);
      throw new SapAdapterError(
        "TIMEOUT",
        "Mock-simulated timeout: the request may have reached SAP, but no response was received."
      );
    }

    submittedOrders.set(submission.idempotencyKey, record);
    ordersByDocEntry.set(sapDocEntry, record);
    return result;
  }

  // customerOrderReference is intentionally unused: the mock adapter's
  // in-memory submittedOrders map (see module comment) is keyed purely
  // on idempotencyKey, which is sufficient for a mock -- TypeScript
  // permits implementing the SapAdapter interface's two-parameter
  // method with fewer parameters, since every caller already passes
  // both per the interface contract.
  async findSalesOrderByExternalReference(idempotencyKey: string): Promise<SapSalesOrderLookupResult> {
    return submittedOrders.get(idempotencyKey)?.result ?? null;
  }

  async getSalesOrder(sapDocEntry: string): Promise<SapSalesOrderLookupResult> {
    return ordersByDocEntry.get(sapDocEntry)?.result ?? null;
  }

  async getInvoice(sapDocEntry: string): Promise<GroupedInvoiceHeader | null> {
    return MOCK_INVOICES.find((invoice) => invoice.docEntry === sapDocEntry) ?? null;
  }

  async getCreditNote(sapDocEntry: string): Promise<GroupedCreditNoteRow | null> {
    return MOCK_CREDIT_NOTES.find((note) => note.docEntry === sapDocEntry) ?? null;
  }
}

/** Test-only reset of the mock's in-memory submitted-orders state, so
 * tests don't leak idempotency state into each other via shared module
 * state between test files. Not used by any application code path. */
export function resetMockSapAdapterState(): void {
  submittedOrders.clear();
  ordersByDocEntry.clear();
  nextDocEntrySeq = 10000;
}
