import { parseScaledDecimal } from "@/lib/picking/validation";
import { formatScaledDecimal } from "@/lib/fulfilment/decimal";

/**
 * Pure derivation of an invoice's claim outcome for the Invoice Claims
 * register. Two independent facets, both derived (never stored, so they can
 * never drift from the claims/returns they summarise):
 *
 *   claim facet  -- NO_CLAIM | CLAIM_RECORDED | PENDING_RESOLUTION | RESOLVED
 *   return facet -- NONE | PARTIAL_RETURN | FULL_RETURN
 *
 * A recorded claim is NOT a confirmed financial loss: `claimedQuantity`
 * (rejected/disputed) is exposure only. Confirmed losses come solely from
 * the existing returned-product valuation (ClaimReturnLostSale) and are
 * never computed here.
 */
export type ClaimFacet = "NO_CLAIM" | "CLAIM_RECORDED" | "PENDING_RESOLUTION" | "RESOLVED";
export type ReturnFacet = "NONE" | "PARTIAL_RETURN" | "FULL_RETURN";

export const CLAIM_FACET_LABELS: Record<ClaimFacet, string> = {
  NO_CLAIM: "No claim",
  CLAIM_RECORDED: "Claim recorded",
  PENDING_RESOLUTION: "Pending resolution",
  RESOLVED: "Resolved",
};

export const RETURN_FACET_LABELS: Record<ReturnFacet, string> = {
  NONE: "No return",
  PARTIAL_RETURN: "Partial return",
  FULL_RETURN: "Full return",
};

/** Claim statuses after which nothing further is expected. */
const TERMINAL_STATUSES = new Set(["RESOLVED", "REJECTED", "CLOSED"]);

export function deriveClaimFacet(claimStatuses: string[]): ClaimFacet {
  if (claimStatuses.length === 0) return "NO_CLAIM";
  if (claimStatuses.every((status) => TERMINAL_STATUSES.has(status))) return "RESOLVED";
  // Every claim still plain OPEN: recorded, but nobody has started on it.
  if (claimStatuses.every((status) => status === "OPEN")) return "CLAIM_RECORDED";
  return "PENDING_RESOLUTION";
}

/**
 * Return facet from the total quantity received back against the invoiced
 * quantity. Full = everything invoiced came back; partial = some did.
 */
export function deriveReturnFacet(returnedQuantity: string, invoicedQuantity: string): ReturnFacet {
  const returned = parseScaledDecimal(returnedQuantity);
  const invoiced = parseScaledDecimal(invoicedQuantity);
  if (returned === null || invoiced === null || returned <= BigInt(0)) return "NONE";
  return invoiced > BigInt(0) && returned >= invoiced ? "FULL_RETURN" : "PARTIAL_RETURN";
}

/** Exact decimal sum of 4dp quantity strings (ignores unparsable entries). */
export function sumQuantities(values: Array<string | null | undefined>): string {
  let total = BigInt(0);
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const scaled = parseScaledDecimal(value);
    if (scaled !== null) total += scaled;
  }
  return formatScaledDecimal(total);
}
