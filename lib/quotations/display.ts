/**
 * Milestone 7 (Quotations Management).
 *
 * Display-only label/style maps -- one definition of each, shared by
 * every /quotations page. Same role lib/invoice-claims/display.ts and
 * lib/returns-credits/display.ts play for their own milestones. No
 * @prisma/client import, so it's safe to import from a Client Component.
 */

export const QUOTATION_STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
};

export const QUOTATION_STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  ISSUED: "bg-cyan-50 text-cyan-700",
  ACCEPTED: "bg-emerald-50 text-emerald-700",
  REJECTED: "bg-red-50 text-red-700",
  EXPIRED: "bg-amber-50 text-amber-700",
  CANCELLED: "bg-gray-100 text-gray-500",
};

export const QUOTATION_EVENT_LABELS: Record<string, string> = {
  CREATED: "Created",
  EDITED: "Edited",
  ISSUED: "Issued to customer",
  ACCEPTED: "Customer accepted",
  REJECTED: "Customer rejected",
  EXPIRED: "Expired",
  CANCELLED: "Cancelled",
  REVISED: "Revised",
  CONVERTED: "Converted into order",
};
