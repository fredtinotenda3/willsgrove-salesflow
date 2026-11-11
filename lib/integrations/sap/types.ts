import type { SapProductRow } from "@/lib/sap-product-csv";
import type { CustomerMasterRow } from "@/lib/sap-customer-master-csv";
import type { GroupedInvoiceHeader } from "@/lib/invoice-reconciliation/csv";
import type { GroupedCreditNoteRow } from "@/lib/returns-credits/csv";

/**
 * Milestone 9 (SAP Business One Integration). The adapter contract (spec
 * section 5.1) -- the ONE place a business module is allowed to reach for
 * SAP data. No API route, lib function outside this directory, or UI
 * component may construct a `fetch()` call to a SAP endpoint directly;
 * everything goes through `getSapAdapter()` (lib/integrations/sap/
 * get-adapter.ts), which hands back whichever adapter implements this
 * interface (MockSapAdapter or ServiceLayerAdapter) the current
 * IntegrationConnection/environment configuration selects.
 *
 * Inbound read methods return data shaped to feed DIRECTLY into the
 * existing Milestone 1/5/6B import pipelines with zero conversion --
 * `fetchProducts`/`fetchCustomers` return exactly `SapProductRow[]`/
 * `CustomerMasterRow[]` (lib/sap-product-csv.ts / lib/sap-customer-
 * master-csv.ts, the same types `planProductImport`/`planCustomerMaster
 * Import` already accept from a parsed CSV file), and `fetchInvoices`/
 * `fetchCreditNotes` return exactly `GroupedInvoiceHeader[]`/
 * `GroupedCreditNoteRow[]` (lib/invoice-reconciliation/csv.ts / lib/
 * returns-credits/csv.ts, the same shape `groupIntoInvoices`/
 * `groupIntoCreditNotes` already produce from a parsed CSV file). This is
 * spec section 11/12's "reuse existing matching and manual override
 * logic... do not create a competing system" made structural: there is no
 * second parsing/grouping/matching implementation anywhere in this
 * directory for invoices or credit notes, and no second upsert
 * implementation for products or customers -- see lib/integrations/sap/
 * {product,customer,invoice,credit-note}-sync.ts, which call the adapter
 * for data and then call the EXISTING plan-/execute- functions verbatim.
 */

export type SapErrorCategory =
  | "AUTHENTICATION_FAILURE"
  | "PERMISSION_DENIED"
  | "NETWORK_UNAVAILABLE"
  | "TIMEOUT"
  | "VALIDATION_FAILURE"
  | "MISSING_CUSTOMER_MAPPING"
  | "MISSING_PRODUCT_MAPPING"
  | "DUPLICATE_EXTERNAL_REFERENCE"
  | "CURRENCY_MISMATCH"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "UNCERTAIN_SUBMISSION"
  | "SERVICE_UNAVAILABLE"
  | "INTERNAL_ERROR";

/**
 * Thrown by any adapter method on failure. `category` drives both the
 * user-facing message (lib/integrations/sap/display.ts) and whether a
 * retry is even offered (lib/integrations/sap/order-outbox.ts) --
 * UNCERTAIN_SUBMISSION is the one category that is NEVER safe to retry
 * blindly (spec section 7.2): it means the request may have already
 * reached SAP and succeeded, so only reconciliation (a lookup by external
 * reference, or an authorised human decision) is offered, never an
 * automatic resubmit.
 */
export class SapAdapterError extends Error {
  readonly category: SapErrorCategory;
  /** True when the SAME request is safe to simply retry as-is (NETWORK_
   * UNAVAILABLE, TIMEOUT, SERVICE_UNAVAILABLE). False for everything else,
   * including UNCERTAIN_SUBMISSION -- that is deliberate: "retryable" here
   * means "retry this exact request," and resubmitting an UNCERTAIN
   * request is exactly what spec section 7.2 forbids without
   * reconciliation first. */
  readonly retryable: boolean;

  constructor(category: SapErrorCategory, message: string, options?: { retryable?: boolean; cause?: unknown }) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "SapAdapterError";
    this.category = category;
    this.retryable = options?.retryable ?? DEFAULT_RETRYABLE[category];
  }
}

const DEFAULT_RETRYABLE: Record<SapErrorCategory, boolean> = {
  AUTHENTICATION_FAILURE: false,
  PERMISSION_DENIED: false,
  NETWORK_UNAVAILABLE: true,
  TIMEOUT: true,
  VALIDATION_FAILURE: false,
  MISSING_CUSTOMER_MAPPING: false,
  MISSING_PRODUCT_MAPPING: false,
  DUPLICATE_EXTERNAL_REFERENCE: false,
  CURRENCY_MISMATCH: false,
  INVALID_QUANTITY: false,
  INVALID_PRICE: false,
  UNCERTAIN_SUBMISSION: false,
  SERVICE_UNAVAILABLE: true,
  INTERNAL_ERROR: false,
};

export interface SapConnectionHealth {
  ok: boolean;
  checkedAt: string; // ISO timestamp
  message: string; // sanitized -- safe to show in the UI and to store as IntegrationConnection.lastTestMessage
  /** Present only on failure, so the UI/caller can decide retryability
   * without re-deriving it from the message text. */
  category?: SapErrorCategory;
}

/**
 * What SalesFlow actually has to send to create a SAP sales order --
 * already resolved to real SAP identifiers by the caller (lib/
 * integrations/sap/order-eligibility.ts); the adapter never resolves a
 * customer/product code itself. `idempotencyKey` is passed through so a
 * real Service Layer adapter can set whatever custom header or field the
 * real environment's verified configuration calls for (unverified against
 * a real SAP Business One instance -- see docs/sap-integration/
 * discovery-checklist.md); the mock adapter uses it to simulate "already
 * submitted" duplicate-conflict detection.
 */
export interface SapSalesOrderSubmission {
  idempotencyKey: string;
  customerOrderReference: string; // SalesFlow's own order reference, carried as NumAtCard/a free-text reference field -- never assumed to be a native Service Layer field without verification
  sapCustomerCode: string;
  currency: string;
  documentDate: string; // ISO YYYY-MM-DD
  lines: SapSalesOrderLineSubmission[];
}

export interface SapSalesOrderLineSubmission {
  lineNumber: number;
  sapItemCode: string;
  quantity: string; // decimal-shaped string, same convention as every other SAP-sourced decimal in this project
  unitPrice: string;
}

export interface SapSalesOrderResult {
  sapDocEntry: string;
  sapDocNum: string;
  documentDate: string;
}

export type SapSalesOrderLookupResult = SapSalesOrderResult | null;

export interface SapAdapter {
  /** Verifies the adapter can reach and authenticate against SAP right
   * now, without performing any business operation. Never throws --
   * failures are reported through the returned SapConnectionHealth. */
  testConnection(): Promise<SapConnectionHealth>;

  /** Cheaper/cached variant `testConnection` callers use for a dashboard
   * "is it currently healthy" indicator rather than an explicit, user-
   * triggered "Test connection" click. The mock adapter and the real
   * adapter may both just delegate to `testConnection` -- a real
   * deployment that finds that too slow for a dashboard refresh can later
   * give this its own lightweight implementation without changing the
   * contract. */
  getConnectionHealth(): Promise<SapConnectionHealth>;

  /** Full catalogue each call -- no incremental/delta parameter, because
   * no real SAP Business One environment has been verified to support
   * one yet (see docs/sap-integration/discovery-checklist.md item 2).
   * Document-level dedupe/change-detection already happens downstream in
   * lib/product-import.ts's planProductImport, so a full refetch is safe,
   * just not bandwidth-optimal against a very large catalogue. */
  fetchProducts(): Promise<SapProductRow[]>;
  fetchCustomers(): Promise<CustomerMasterRow[]>;

  /** `since`, when provided, is a best-effort hint only (spec section 8/9:
   * "incremental import where supported") -- passed through to whatever
   * real Service Layer OData filter a verified environment turns out to
   * support; the mock adapter honours it by filtering its own fixture
   * data. Omit it (or ignore it, as a real adapter honestly unable to
   * filter server-side may choose to) for a full fetch. */
  fetchInvoices(since?: Date): Promise<GroupedInvoiceHeader[]>;
  fetchCreditNotes(since?: Date): Promise<GroupedCreditNoteRow[]>;

  /** The one outbound write this milestone performs. Must be safe to
   * call twice with the same `idempotencyKey` (spec section 7.2) --
   * MockSapAdapter enforces this itself (see its own module comment);
   * ServiceLayerAdapter's ability to do so for real depends on exactly
   * which idempotency mechanism (if any) the verified environment
   * actually supports, which is why `findSalesOrderByExternalReference`
   * exists as the fallback reconciliation path below. */
  createSalesOrder(submission: SapSalesOrderSubmission): Promise<SapSalesOrderResult>;

  /** Spec section 5.1/7.2's reconciliation lookup -- "SAP document lookup
   * by external reference where supported." Looks up a previously
   * submitted order by the SAME idempotency key / customer reference used
   * at submission time, so an UNCERTAIN operation can be resolved without
   * ever blindly resubmitting. Returns null when nothing matching is
   * found (which does NOT prove the order was never created -- only that
   * this lookup mechanism didn't find it; see lib/integrations/sap/
   * order-outbox.ts's reconciliation comments for how that ambiguity is
   * actually handled). */
  findSalesOrderByExternalReference(idempotencyKey: string, customerOrderReference: string): Promise<SapSalesOrderLookupResult>;

  getSalesOrder(sapDocEntry: string): Promise<SapSalesOrderLookupResult>;

  /** Minimal invoice/credit-note single-document lookups, offered by the
   * contract for a future "open this one SAP document" detail action; not
   * called by anything in this milestone's sync wrappers, which always
   * fetch in bulk via fetchInvoices/fetchCreditNotes. */
  getInvoice(sapDocEntry: string): Promise<GroupedInvoiceHeader | null>;
  getCreditNote(sapDocEntry: string): Promise<GroupedCreditNoteRow | null>;
}
