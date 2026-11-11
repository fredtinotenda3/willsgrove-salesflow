/**
 * Milestone 8. Label/style maps -- pure, no @prisma/client import, safe
 * for Client Components, same convention as lib/quotations/display.ts
 * and lib/order-display.ts.
 */

export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
  WITHDRAWN: "Withdrawn",
};

export const APPROVAL_STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-50 text-gray-600",
  PENDING: "bg-amber-50 text-amber-700",
  APPROVED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-gray-50 text-gray-500",
  WITHDRAWN: "bg-slate-50 text-slate-600",
};

export const APPROVAL_MODULE_LABELS: Record<string, string> = {
  QUOTATIONS: "Quotations",
  ORDERS: "Customer Orders",
};

export const APPROVAL_ACTION_TYPE_LABELS: Record<string, string> = {
  QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD: "Quotation discount exceeds limit",
  ORDER_VALUE_EXCEEDS_THRESHOLD: "Order value exceeds limit",
};

export const APPROVAL_EVENT_LABELS: Record<string, string> = {
  SUBMITTED: "Submitted",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  CANCELLED: "Cancelled",
  RESUBMITTED: "Resubmitted",
  INVALIDATED: "Invalidated",
};
