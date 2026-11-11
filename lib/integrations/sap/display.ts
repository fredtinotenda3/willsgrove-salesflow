/**
 * Milestone 9 (SAP Business One Integration). Pure display-formatting
 * helpers for the /integrations/sap/* dashboard -- no data access, so
 * these are safe to import from Client Components too.
 */

export const JOB_TYPE_LABELS: Record<string, string> = {
  PRODUCT_IMPORT: "Products",
  CUSTOMER_IMPORT: "Customers",
  INVOICE_IMPORT: "Invoices",
  CREDIT_NOTE_IMPORT: "Credit notes",
  SALES_ORDER_OUTBOX: "Sales order outbox",
};

export const ORDER_INTEGRATION_STATUS_LABELS: Record<string, string> = {
  NOT_READY: "Not ready",
  READY: "Ready to submit",
  PENDING: "Queued",
  PROCESSING: "Submitting…",
  SYNCED: "Synced to SAP",
  FAILED: "Failed",
  REQUIRES_REVIEW: "Requires review",
  CANCELLED: "Cancelled",
};

export const ORDER_INTEGRATION_STATUS_TONE: Record<string, "neutral" | "info" | "warning" | "success" | "danger"> = {
  NOT_READY: "neutral",
  READY: "info",
  PENDING: "info",
  PROCESSING: "info",
  SYNCED: "success",
  FAILED: "danger",
  REQUIRES_REVIEW: "warning",
  CANCELLED: "neutral",
};

export const ERROR_CATEGORY_LABELS: Record<string, string> = {
  AUTHENTICATION_FAILURE: "Authentication failed",
  PERMISSION_DENIED: "Permission denied",
  NETWORK_UNAVAILABLE: "Could not reach SAP",
  TIMEOUT: "Timed out -- unconfirmed",
  VALIDATION_FAILURE: "Rejected by SAP",
  MISSING_CUSTOMER_MAPPING: "Customer not found in SAP",
  MISSING_PRODUCT_MAPPING: "Product not found in SAP",
  DUPLICATE_EXTERNAL_REFERENCE: "Duplicate document reference",
  CURRENCY_MISMATCH: "Currency mismatch",
  INVALID_QUANTITY: "Invalid quantity",
  INVALID_PRICE: "Invalid price",
  UNCERTAIN_SUBMISSION: "Outcome unconfirmed",
  SERVICE_UNAVAILABLE: "SAP temporarily unavailable",
  INTERNAL_ERROR: "Unexpected error",
};

export function formatLastSyncAt(date: Date | null): string {
  if (!date) return "Never run";
  return new Date(date).toLocaleString();
}

export function mockModeBannerText(isMockMode: boolean): string | null {
  if (!isMockMode) return null;
  return "Running in MOCK mode -- no real SAP Business One system is being contacted. All products, customers, invoices and credit notes shown here are synthetic test data.";
}
