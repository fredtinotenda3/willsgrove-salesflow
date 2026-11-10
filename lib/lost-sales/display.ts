/**
 * Milestone 4 (Lost-Sales Management).
 *
 * Display-only label/style maps -- one definition of each, shared by the
 * /lost-sales list page, detail page, and decision-recording panel. Same
 * role lib/order-display.ts's ORDER_STATUS_LABELS/STYLES play for orders.
 * No @prisma/client import, so it's safe to import from a Client
 * Component too.
 */
export const UNFULFILLED_DEMAND_STATUS_LABELS: Record<string, string> = {
  PENDING_DECISION: "Awaiting customer decision",
  AWAITING_SUPPLY: "Waiting for remaining supply",
  PARTIALLY_CANCELLED: "Partially cancelled",
  FULLY_CANCELLED: "Fully cancelled",
  CONFIRMED_LOST: "Confirmed lost",
  RESOLVED: "Resolved",
};

export const UNFULFILLED_DEMAND_STATUS_STYLES: Record<string, string> = {
  PENDING_DECISION: "bg-amber-50 text-amber-700",
  AWAITING_SUPPLY: "bg-cyan-50 text-cyan-700",
  PARTIALLY_CANCELLED: "bg-orange-50 text-orange-700",
  FULLY_CANCELLED: "bg-gray-100 text-gray-600",
  CONFIRMED_LOST: "bg-red-50 text-red-700",
  RESOLVED: "bg-emerald-50 text-emerald-700",
};

export const DECISION_TYPE_LABELS: Record<string, string> = {
  ACCEPT_PARTIAL_CANCEL_REMAINDER: "Accepted available quantity, cancelled remainder",
  AWAIT_REMAINING_QUANTITY: "Waiting for remaining quantity",
  SCHEDULE_LATER_SUPPLY: "Remaining quantity to be supplied later",
  SUBSTITUTE_ACCEPTED: "Substitute accepted",
  PARTIAL_CANCELLATION: "Partially cancelled",
  ENTIRE_LINE_CANCELLED: "Entire line cancelled",
  ENTIRE_ORDER_CANCELLED: "Entire order cancelled",
};

export const DECISION_SOURCE_LABELS: Record<string, string> = {
  CUSTOMER_PHONE_CALL: "Customer (phone call)",
  CUSTOMER_EMAIL: "Customer (email)",
  CUSTOMER_WRITTEN_COMMUNICATION: "Customer (written communication)",
  CUSTOMER_IN_PERSON: "Customer (in person)",
  CUSTOMER_PORTAL_OR_SYSTEM: "Customer (portal/system)",
  SALESPERSON_JUDGEMENT_UNCONFIRMED: "Salesperson judgement -- not yet confirmed by customer",
  OTHER: "Other",
};

export const LOST_SALE_REASON_LABELS: Record<string, string> = {
  PRODUCT_UNAVAILABLE: "Product unavailable",
  INSUFFICIENT_QUANTITY: "Insufficient quantity",
  CUSTOMER_CANCELLED: "Customer cancelled",
  CUSTOMER_SOURCED_ELSEWHERE: "Customer sourced elsewhere",
  DELIVERY_OR_TIMING_ISSUE: "Delivery or timing issue",
  QUALITY_RELATED_ISSUE: "Quality-related issue",
  SUBSTITUTE_REJECTED: "Substitute rejected",
  OTHER: "Other",
};
