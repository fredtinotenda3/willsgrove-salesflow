/**
 * Milestone 5 (SAP Invoice Reconciliation).
 *
 * Display-only label/style maps -- one definition of each, shared by the
 * /invoice-reconciliation list, detail and import pages. Same role
 * lib/lost-sales/display.ts plays for Milestone 4. No @prisma/client
 * import, so it's safe to import from a Client Component too.
 */
export const INVOICE_RECONCILIATION_STATUS_LABELS: Record<string, string> = {
  UNMATCHED: "Unmatched SAP invoice",
  PARTIALLY_MATCHED: "Partially matched",
  RECONCILIATION_REQUIRED: "Reconciliation required",
  MATCHED: "Matched",
  CANCELLED_REVERSED: "Cancelled / reversed",
};

export const INVOICE_RECONCILIATION_STATUS_STYLES: Record<string, string> = {
  UNMATCHED: "bg-amber-50 text-amber-700",
  PARTIALLY_MATCHED: "bg-cyan-50 text-cyan-700",
  RECONCILIATION_REQUIRED: "bg-red-50 text-red-700",
  MATCHED: "bg-emerald-50 text-emerald-700",
  CANCELLED_REVERSED: "bg-gray-100 text-gray-600",
};

export const ORDER_LINE_INVOICE_STATUS_LABELS: Record<string, string> = {
  NOT_YET_INVOICED: "Not yet invoiced",
  PARTIALLY_INVOICED: "Partially invoiced",
  FULLY_INVOICED: "Fully invoiced",
  OVER_INVOICED: "Over-invoiced",
};

export const ORDER_LINE_INVOICE_STATUS_STYLES: Record<string, string> = {
  NOT_YET_INVOICED: "bg-gray-100 text-gray-600",
  PARTIALLY_INVOICED: "bg-cyan-50 text-cyan-700",
  FULLY_INVOICED: "bg-emerald-50 text-emerald-700",
  OVER_INVOICED: "bg-red-50 text-red-700",
};

export const INVOICE_LINE_MATCH_STATUS_LABELS: Record<string, string> = {
  UNMATCHED: "Unmatched -- needs review",
  AUTO_MATCHED: "Matched automatically",
  MANUALLY_MATCHED: "Matched manually",
  CANNOT_LINK: "Cannot be linked to SalesFlow",
};

export const INVOICE_LINE_MATCH_STATUS_STYLES: Record<string, string> = {
  UNMATCHED: "bg-amber-50 text-amber-700",
  AUTO_MATCHED: "bg-emerald-50 text-emerald-700",
  MANUALLY_MATCHED: "bg-cyan-50 text-cyan-700",
  CANNOT_LINK: "bg-gray-100 text-gray-600",
};
