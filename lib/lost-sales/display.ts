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
  // Additional Implementation Requirements (lost-sales automation): a
  // superseded record was replaced by a later re-pick/correction on the
  // same order line -- see UnfulfilledDemandStatus.SUPERSEDED's
  // schema.prisma comment. Still shown, never hidden -- it's history,
  // just no longer the current figure.
  SUPERSEDED: "Superseded by correction",
};

export const UNFULFILLED_DEMAND_STATUS_STYLES: Record<string, string> = {
  PENDING_DECISION: "bg-amber-50 text-amber-700",
  AWAITING_SUPPLY: "bg-cyan-50 text-cyan-700",
  PARTIALLY_CANCELLED: "bg-orange-50 text-orange-700",
  FULLY_CANCELLED: "bg-gray-100 text-gray-600",
  CONFIRMED_LOST: "bg-red-50 text-red-700",
  RESOLVED: "bg-emerald-50 text-emerald-700",
  SUPERSEDED: "bg-slate-100 text-slate-500",
};

// Real Business Data Onboarding round (spec PART A): DECISION_TYPE_LABELS
// removed -- no surviving page renders a CustomerDecisionEvent.decisionType
// any more (the "Decision History" section on the lost-sale detail page,
// its only consumer, is deleted along with the rest of the Customer
// Decision workflow's UI). CustomerDecisionType itself is kept at the
// schema level only for historical-data safety (see prisma/schema.prisma);
// if a future page ever needs to display that history, its labels belong
// there.

export const DECISION_SOURCE_LABELS: Record<string, string> = {
  CUSTOMER_PHONE_CALL: "Customer (phone call)",
  CUSTOMER_EMAIL: "Customer (email)",
  CUSTOMER_WRITTEN_COMMUNICATION: "Customer (written communication)",
  CUSTOMER_IN_PERSON: "Customer (in person)",
  CUSTOMER_PORTAL_OR_SYSTEM: "Customer (portal/system)",
  SALESPERSON_JUDGEMENT_UNCONFIRMED: "Salesperson judgement -- not yet confirmed by customer",
  OTHER: "Other",
  // Real Business Data Onboarding round (spec PART A): the only value any
  // surviving code path ever writes -- every LostSaleRecord is now
  // created automatically, with no human decision involved at all.
  AUTOMATIC_SYSTEM_RECORDED: "Recorded automatically (no customer decision)",
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

/**
 * Follow-up fix: "clearly distinguish the different sources of lost
 * sales... shortage losses... returned-product losses" --
 * lib/lost-sales/consolidated-analytics.ts's LostSaleSource, the tag
 * distinguishing a confirmed-shortage loss (UnfulfilledDemand/
 * LostSaleRecord, picking-time) from a confirmed returned-product loss
 * (ClaimReturnLostSale, a physical return later found unsellable) in the
 * consolidated Lost Sales Analytics view.
 */
export const LOST_SALE_SOURCE_VALUES = ["SHORTAGE", "RETURNED_PRODUCT"] as const;
export type LostSaleSource = (typeof LOST_SALE_SOURCE_VALUES)[number];

export const LOST_SALE_SOURCE_LABELS: Record<string, string> = {
  SHORTAGE: "Shortage (unavailable at picking)",
  RETURNED_PRODUCT: "Returned product (non-resalable)",
};

export const LOST_SALE_SOURCE_STYLES: Record<string, string> = {
  SHORTAGE: "bg-red-50 text-red-700",
  RETURNED_PRODUCT: "bg-purple-50 text-purple-700",
};
