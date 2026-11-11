/**
 * Milestone 6B (Returns & Credit Notes).
 *
 * Display-only label/style maps -- one definition of each, shared by the
 * claim detail page's returns/credit-notes sections and the /returns-
 * credits import and reconciliation pages. Same role lib/invoice-claims/
 * display.ts plays for 6A. No @prisma/client import, so it's safe to
 * import from a Client Component.
 */

export const RETURN_CONDITION_LABELS: Record<string, string> = {
  GOOD_RESALABLE: "Good / resalable",
  DAMAGED: "Damaged",
  EXPIRED: "Expired",
  OTHER: "Other",
};

export const RETURN_CONDITION_STYLES: Record<string, string> = {
  GOOD_RESALABLE: "bg-emerald-50 text-emerald-700",
  DAMAGED: "bg-red-50 text-red-700",
  EXPIRED: "bg-amber-50 text-amber-700",
  OTHER: "bg-gray-100 text-gray-600",
};

export const CREDIT_NOTE_MATCH_STATUS_LABELS: Record<string, string> = {
  UNMATCHED: "Unmatched",
  AUTO_MATCHED: "Auto-matched",
  MANUALLY_MATCHED: "Manually matched",
  CANNOT_LINK: "Cannot link",
};

export const CREDIT_NOTE_MATCH_STATUS_STYLES: Record<string, string> = {
  UNMATCHED: "bg-amber-50 text-amber-700",
  AUTO_MATCHED: "bg-emerald-50 text-emerald-700",
  MANUALLY_MATCHED: "bg-emerald-100 text-emerald-800",
  CANNOT_LINK: "bg-gray-100 text-gray-600",
};
