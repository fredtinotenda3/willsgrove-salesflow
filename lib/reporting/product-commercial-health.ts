/**
 * Milestone 14 (Product Intelligence). Pure claim/credit-note/return
 * product-attribution resolution.
 *
 * Mandatory schema facts established during inspection (prisma/schema.prisma):
 *   - CreditNote has NO product or line-level field at all -- only
 *     claimId/sapInvoiceId (both nullable). There is no direct way to
 *     know which product a credit note relates to.
 *   - ClaimReturn.claimLineId is OPTIONAL -- a return can be recorded
 *     against the whole claim with no specific line, so it may span
 *     whichever products the claim's lines cover.
 *
 * Per spec sections 5.7/7 ("never infer product-level credit allocations
 * from invoice-level totals unless the database explicitly supports that
 * allocation... where claims/returns cannot reliably be attributed to a
 * product, show the limitation rather than inventing an association"),
 * the rule implemented here is:
 *
 *   A claim (and, by extension, any credit note or claim-level return
 *   tied to it) is attributable to ONE product only when every one of
 *   its lines resolves to the SAME single SAP item code. A claim whose
 *   lines span two or more distinct item codes -- or whose lines carry
 *   no resolvable item code at all -- is NOT attributed to any product;
 *   it is counted in an explicit "unattributable to a single product"
 *   bucket instead of being guessed or split pro-rata.
 *
 * This module is pure (no @prisma/client import) so the attribution rule
 * itself is unconditionally unit-testable, exactly like every other
 * pure reporting module in this project. The actual claim/line fetch and
 * the credit-note union live in lib/reporting/
 * product-commercial-health-queries.ts.
 */

export type ProductAttributionResolution =
  | { kind: "single"; sapItemCode: string }
  | { kind: "multiple" }
  | { kind: "none" };

/**
 * Resolves a set of SAP item codes (typically a claim's own lines' item
 * codes, via InvoiceClaimLine.sapInvoiceLine.sapItemCode) to a single
 * product, or explicitly flags why it cannot be resolved. Null/blank
 * entries (an unmatched or missing item code on one of the lines) are
 * excluded before counting distinct values -- a claim with one resolved
 * code and one missing code is still "single" if the resolved set has
 * exactly one member, since the missing code carries no conflicting
 * information, only an absence of it.
 */
export function resolveSingleProductSapItemCode(sapItemCodes: readonly (string | null | undefined)[]): ProductAttributionResolution {
  const distinct = new Set(sapItemCodes.map((c) => (c ?? "").trim()).filter((c) => c !== ""));
  if (distinct.size === 0) return { kind: "none" };
  if (distinct.size > 1) return { kind: "multiple" };
  return { kind: "single", sapItemCode: [...distinct][0] };
}
