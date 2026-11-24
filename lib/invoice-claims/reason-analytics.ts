import "server-only";
import type { ReportFilters } from "@/lib/reporting/types";
import { getClaimReasonBreakdown } from "@/lib/lost-sales/unified-queries";

/**
 * Compatibility adapter. The standardised-reason calculation now lives in
 * ONE place (lib/lost-sales/unified-core.ts, fetched by
 * lib/lost-sales/unified-queries.ts) and is shared by the Invoice Claims
 * dashboard, Lost Sales Analytics, the management recommendations and the
 * Action Centre. This function keeps the previous export and shape for any
 * caller that still uses it, but no longer has its own arithmetic.
 *
 * Behaviour changes versus the previous implementation, deliberate:
 *   - exposure is priced at the REAL invoice unit price, not the customer's
 *     own disputedUnitPrice (which is informational only);
 *   - sums are exact decimals, not floating point;
 *   - "resolved" = concluded claims (RESOLVED/REJECTED/CLOSED); a PARTIALLY_RESOLVED
 *     claim is still outstanding, and counts are distinct CLAIMS, not lines;
 *   - lines with no reasonCategory are reported as their own row instead of
 *     being silently dropped.
 */

export type ClaimReasonBreakdownRow = {
  reasonCategory: string;
  label: string;
  claimLineCount: number;
  distinctClaimCount: number;
  claimedQuantity: string;
  informationalExposureByCurrency: { currency: string; amount: string }[];
  resolvedCount: number;
  outstandingCount: number;
  topProducts: { sapItemCode: string | null; description: string | null; claimLineCount: number; claimedQuantity: string }[];
  topCustomers: { customerId: string; customerName: string; claimLineCount: number; claimedQuantity: string }[];
};

export type ClaimReasonAnalytics = {
  effectiveDateFrom: string | null;
  effectiveDateTo: string | null;
  totalClaimLines: number;
  byReason: ClaimReasonBreakdownRow[];
};

export async function getClaimReasonAnalytics(filters: Pick<ReportFilters, "includeDemo" | "dateFrom" | "dateTo" | "customerId">): Promise<ClaimReasonAnalytics> {
  const { breakdown } = await getClaimReasonBreakdown(filters);
  return {
    effectiveDateFrom: filters.dateFrom ?? null,
    effectiveDateTo: filters.dateTo ?? null,
    totalClaimLines: breakdown.totalClaimLines,
    byReason: breakdown.rows.map((row) => ({
      reasonCategory: row.reasonCategory,
      label: row.label,
      claimLineCount: row.claimLineCount,
      distinctClaimCount: row.claimCount,
      // quantities are per unit and never added across units; this legacy field keeps only a single-unit total
      claimedQuantity: row.quantityByUnit.length === 1 ? row.quantityByUnit[0].rejected : "0",
      informationalExposureByCurrency: row.exposureByCurrency.map((e) => ({ currency: e.currency, amount: e.value })),
      resolvedCount: row.concludedClaimCount,
      outstandingCount: row.openClaimCount,
      topProducts: row.topProducts.map((p) => ({ sapItemCode: p.sapItemCode, description: p.description, claimLineCount: p.claimLineCount, claimedQuantity: p.rejectedQuantity })),
      topCustomers: row.topCustomers.map((c) => ({ ...c, claimedQuantity: "0" })),
    })),
  };
}
