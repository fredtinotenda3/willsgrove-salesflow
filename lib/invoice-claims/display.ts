/**
 * Milestone 6A (Invoice Claims Management).
 *
 * Display-only label/style maps -- one definition of each, shared by the
 * /invoice-claims list, detail, create and dashboard pages. Same role
 * lib/invoice-reconciliation/display.ts plays for Milestone 5. No
 * @prisma/client import, so it's safe to import from a Client Component.
 */

export const CLAIM_CATEGORY_LABELS: Record<string, string> = {
  QUALITY_ISSUE: "Quality issue",
  DAMAGED_PRODUCTS: "Damaged products",
  SPOILAGE: "Spoilage",
  SHORT_DELIVERY: "Short delivery",
  MISSING_PRODUCTS: "Missing products",
  WRONG_PRODUCT_SUPPLIED: "Wrong product supplied",
  QUANTITY_DISCREPANCY: "Quantity discrepancy",
  PRICING_DISPUTE: "Pricing / invoicing dispute",
  INCORRECT_INVOICE: "Incorrect invoice",
  CUSTOMER_REJECTION: "Customer rejection",
  OTHER: "Other",
};

export const CLAIM_PRIORITY_LABELS: Record<string, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

export const CLAIM_PRIORITY_STYLES: Record<string, string> = {
  LOW: "bg-gray-100 text-gray-600",
  MEDIUM: "bg-cyan-50 text-cyan-700",
  HIGH: "bg-amber-50 text-amber-700",
  URGENT: "bg-red-50 text-red-700",
};

export const CLAIM_STATUS_LABELS: Record<string, string> = {
  OPEN: "Open",
  UNDER_INVESTIGATION: "Under investigation",
  AWAITING_CUSTOMER: "Awaiting customer",
  AWAITING_INTERNAL_ACTION: "Awaiting internal approval",
  APPROVED: "Approved",
  PARTIALLY_RESOLVED: "Partially resolved",
  RESOLVED: "Resolved",
  REJECTED: "Rejected",
  CLOSED: "Closed",
};

export const CLAIM_STATUS_STYLES: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-700",
  UNDER_INVESTIGATION: "bg-cyan-50 text-cyan-700",
  AWAITING_CUSTOMER: "bg-violet-50 text-violet-700",
  AWAITING_INTERNAL_ACTION: "bg-orange-50 text-orange-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  PARTIALLY_RESOLVED: "bg-emerald-50 text-emerald-700",
  RESOLVED: "bg-emerald-100 text-emerald-800",
  REJECTED: "bg-red-50 text-red-700",
  CLOSED: "bg-gray-100 text-gray-600",
};

export const CLAIM_LINE_DISPUTE_TYPE_LABELS: Record<string, string> = {
  QUANTITY: "Quantity dispute",
  AMOUNT_ONLY: "Amount-only dispute",
};

export const RESOLUTION_DECISION_LABELS: Record<string, string> = {
  NO_ACTION_REQUIRED: "No action required",
  CLAIM_REJECTED: "Claim rejected",
  REPLACEMENT_APPROVED: "Replacement approved",
  PHYSICAL_RETURN_REQUIRED: "Physical return required",
  PARTIAL_CREDIT_RECOMMENDED: "Partial credit note recommended",
  FULL_CREDIT_RECOMMENDED: "Full credit note recommended",
  PRICING_CORRECTION_REQUIRED: "Pricing correction required",
  DELIVERY_INVESTIGATION_REQUIRED: "Delivery investigation required",
  OTHER: "Other",
};

/**
 * Resolutions whose approval implies SOME physical-return-and/or-credit-
 * note follow-up that Milestone 6B will track -- used only to label a
 * claim's card with a "this will need a 6B return/credit record" hint.
 * Never used to create or imply that such a record already exists (spec
 * section 6: "a recommendation is not the same as an executed action").
 */
export const RESOLUTIONS_IMPLYING_6B_FOLLOWUP: ReadonlySet<string> = new Set([
  "PHYSICAL_RETURN_REQUIRED",
  "PARTIAL_CREDIT_RECOMMENDED",
  "FULL_CREDIT_RECOMMENDED",
]);
