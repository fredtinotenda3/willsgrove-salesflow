import { z } from "zod";
import { decimalStringSchema, parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Milestone 6A (Invoice Claims Management). Pure logic only -- no
 * `@prisma/client` import, no database access -- so this file is safe to
 * import from a Client Component and to unit-test without a database.
 *
 * `decimalStringSchema`/`parseScaledDecimal` are imported directly from
 * lib/picking/validation.ts rather than duplicated, same reuse this
 * project has followed since Milestone 4 -- they are the exact
 * non-negative, 4-decimal-place scaled-BigInt arithmetic every milestone
 * since has needed for quantities and money.
 */

// ---------------------------------------------------------------------------
// Controlled vocabularies (confirmed: fixed enum, not a DB-configurable
// list -- see docs/milestones/PROGRESS.md's Milestone 6A section for the
// rationale). "OTHER" is every list's own explicit escape valve.
// ---------------------------------------------------------------------------

export const CLAIM_CATEGORIES = [
  "QUALITY_ISSUE",
  "DAMAGED_PRODUCTS",
  "SPOILAGE",
  "SHORT_DELIVERY",
  "MISSING_PRODUCTS",
  "WRONG_PRODUCT_SUPPLIED",
  "QUANTITY_DISCREPANCY",
  "PRICING_DISPUTE",
  "INCORRECT_INVOICE",
  "CUSTOMER_REJECTION",
  "OTHER",
] as const;
export type ClaimCategory = (typeof CLAIM_CATEGORIES)[number];

export const CLAIM_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
export type ClaimPriority = (typeof CLAIM_PRIORITIES)[number];

// Spec Part 1 section 5, verbatim.
export const CLAIM_STATUSES = [
  "OPEN",
  "UNDER_INVESTIGATION",
  "AWAITING_CUSTOMER",
  "AWAITING_INTERNAL_ACTION",
  "APPROVED",
  "PARTIALLY_RESOLVED",
  "RESOLVED",
  "REJECTED",
  "CLOSED",
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_LINE_DISPUTE_TYPES = ["QUANTITY", "AMOUNT_ONLY"] as const;
export type ClaimLineDisputeType = (typeof CLAIM_LINE_DISPUTE_TYPES)[number];

// Spec Part 1 section 6, verbatim (reworded to identifiers).
export const RESOLUTION_DECISIONS = [
  "NO_ACTION_REQUIRED",
  "CLAIM_REJECTED",
  "REPLACEMENT_APPROVED",
  "PHYSICAL_RETURN_REQUIRED",
  "PARTIAL_CREDIT_RECOMMENDED",
  "FULL_CREDIT_RECOMMENDED",
  "PRICING_CORRECTION_REQUIRED",
  "DELIVERY_INVESTIGATION_REQUIRED",
  "OTHER",
] as const;
export type ResolutionDecision = (typeof RESOLUTION_DECISIONS)[number];

// ---------------------------------------------------------------------------
// Status transition graph. Spec section 5: "do not allow arbitrary status
// changes that bypass required investigation or approval steps." This is
// the single source of truth both the lib layer and the API route consult
// -- never re-derived or duplicated elsewhere. Statuses this project
// considers "approval-weight" (require SALES_MANAGER/ADMINISTRATOR,
// enforced at the route -- see app/api/invoice-claims/[id]/status/
// route.ts) are exactly the ones a plain investigation-workflow move can
// never reach on its own.
// ---------------------------------------------------------------------------

const APPROVAL_WEIGHT_STATUSES: ReadonlySet<ClaimStatus> = new Set([
  "APPROVED",
  "PARTIALLY_RESOLVED",
  "RESOLVED",
  "REJECTED",
  "CLOSED",
]);

export function isApprovalWeightStatus(status: ClaimStatus): boolean {
  return APPROVAL_WEIGHT_STATUSES.has(status);
}

// Exhaustive: every one of the 9 statuses has an entry, even CLOSED
// (terminal -- empty array). A future status added to CLAIM_STATUSES
// without a matching entry here is a type error (Record<ClaimStatus, ...>
// below), not a silent gap.
const CLAIM_STATUS_TRANSITIONS: Record<ClaimStatus, readonly ClaimStatus[]> = {
  OPEN: ["UNDER_INVESTIGATION", "AWAITING_CUSTOMER", "AWAITING_INTERNAL_ACTION", "REJECTED", "CLOSED"],
  UNDER_INVESTIGATION: ["AWAITING_CUSTOMER", "AWAITING_INTERNAL_ACTION", "REJECTED"],
  AWAITING_CUSTOMER: ["UNDER_INVESTIGATION", "AWAITING_INTERNAL_ACTION", "REJECTED", "CLOSED"],
  // RESOLVED is reachable directly from here (not only via APPROVED)
  // because resolutionDecisionToClaimStatus() maps NO_ACTION_REQUIRED
  // straight to RESOLVED -- approving a "no action required"
  // recommendation IS the full resolution, with nothing further for a
  // manager to execute afterward, unlike a credit/return/pricing
  // decision which lands on APPROVED pending that execution.
  AWAITING_INTERNAL_ACTION: ["UNDER_INVESTIGATION", "APPROVED", "RESOLVED", "REJECTED"],
  APPROVED: ["PARTIALLY_RESOLVED", "RESOLVED", "CLOSED"],
  PARTIALLY_RESOLVED: ["RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED"],
  REJECTED: ["CLOSED"],
  CLOSED: [],
};

export type ClaimStatusTransitionResult =
  | { ok: true; requiresApproval: boolean }
  | { ok: false; message: string };

/**
 * Validates one proposed status transition. Does NOT check who is making
 * the request -- `requiresApproval: true` tells the caller (the API
 * route) that this specific transition needs SALES_MANAGER/ADMINISTRATOR;
 * the route is the only place that actually checks the acting user's
 * role, same two-tier convention as every prior milestone.
 */
export function validateClaimStatusTransition(from: ClaimStatus, to: ClaimStatus): ClaimStatusTransitionResult {
  if (from === to) {
    return { ok: false, message: `The claim is already ${to}.` };
  }
  const allowed = CLAIM_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return { ok: false, message: `Cannot move a claim from ${from} directly to ${to}.` };
  }
  return { ok: true, requiresApproval: isApprovalWeightStatus(to) };
}

/**
 * The claim-status statuses that count as "concluded" for
 * resolvedAt/closedAt bookkeeping (spec section 8's "average resolution
 * time" reporting reads these timestamps directly rather than scanning a
 * full event history).
 */
export function isConcludedStatus(status: ClaimStatus): boolean {
  return status === "RESOLVED" || status === "PARTIALLY_RESOLVED" || status === "REJECTED" || status === "CLOSED";
}

// ---------------------------------------------------------------------------
// Resolution decision -> claim status. Exhaustive, so adding a new
// decision without updating this mapping is a compile error, not a
// runtime surprise. This is what makes "a recommendation is not the same
// as an executed action" (spec section 6) structural: approving a
// resolution always lands the claim on exactly this status, never a
// free choice at approval time -- see lib/invoice-claims/claim-
// resolution.ts's approveClaimResolution().
// ---------------------------------------------------------------------------

export function resolutionDecisionToClaimStatus(decision: ResolutionDecision): ClaimStatus {
  switch (decision) {
    case "NO_ACTION_REQUIRED":
      return "RESOLVED";
    case "CLAIM_REJECTED":
      return "REJECTED";
    case "REPLACEMENT_APPROVED":
      return "APPROVED";
    case "PHYSICAL_RETURN_REQUIRED":
      return "APPROVED";
    case "PARTIAL_CREDIT_RECOMMENDED":
      return "APPROVED";
    case "FULL_CREDIT_RECOMMENDED":
      return "APPROVED";
    case "PRICING_CORRECTION_REQUIRED":
      return "APPROVED";
    // This one is genuinely not a resolution yet -- it means more
    // investigation is needed before any real decision can be made, so
    // approving it sends the claim back to UNDER_INVESTIGATION rather
    // than forward to APPROVED.
    case "DELIVERY_INVESTIGATION_REQUIRED":
      return "UNDER_INVESTIGATION";
    case "OTHER":
      return "APPROVED";
    default: {
      const exhaustive: never = decision;
      throw new Error(`Unhandled resolution decision: ${exhaustive}`);
    }
  }
}

/** Only "OTHER" requires a free-text detail, same rule as LostSaleReason. */
export function resolutionDecisionRequiresDetail(decision: ResolutionDecision): boolean {
  return decision === "OTHER";
}

export function claimCategoryRequiresDetail(category: ClaimCategory): boolean {
  return category === "OTHER";
}

// ---------------------------------------------------------------------------
// Claim-line quantity/amount validation. Spec section 4: "accepted
// quantity + rejected/disputed quantity must not exceed the invoiced
// quantity" -- read as a rule over the invoice line as a WHOLE, across
// every claim ever filed against it, not just within one claim. Callers
// pass `alreadyClaimedElsewhereRaw` as a live-computed aggregate (see
// lib/invoice-claims/queries.ts's getAlreadyClaimedQuantity()) -- never a
// stored running total.
// ---------------------------------------------------------------------------

export type QuantityValidationResult = { ok: true } | { ok: false; message: string };

export function validateClaimLineQuantities(
  invoicedQuantityRaw: string,
  alreadyClaimedElsewhereRaw: string,
  acceptedQuantityRaw: string,
  rejectedQuantityRaw: string
): QuantityValidationResult {
  const invoiced = parseScaledDecimal(invoicedQuantityRaw);
  const alreadyClaimed = parseScaledDecimal(alreadyClaimedElsewhereRaw);
  const accepted = parseScaledDecimal(acceptedQuantityRaw);
  const rejected = parseScaledDecimal(rejectedQuantityRaw);

  if (invoiced === null || alreadyClaimed === null || accepted === null || rejected === null) {
    return { ok: false, message: "Quantities must be non-negative numbers with at most 4 decimal places." };
  }
  if (accepted === BigInt(0) && rejected === BigInt(0)) {
    return { ok: false, message: "At least one of accepted quantity or rejected/disputed quantity must be greater than zero." };
  }

  const remaining = invoiced - alreadyClaimed;
  if (accepted + rejected > remaining) {
    return {
      ok: false,
      message: `Accepted (${acceptedQuantityRaw}) plus rejected/disputed (${rejectedQuantityRaw}) quantity exceeds what is still available to claim on this invoice line (${remaining < BigInt(0) ? "0.0000" : formatNonNegativeScaled(remaining)} of ${invoicedQuantityRaw} remaining after ${alreadyClaimedElsewhereRaw} already claimed elsewhere).`,
    };
  }

  return { ok: true };
}

export function validateDisputedAmount(disputedAmountRaw: string, lineTotalRaw: string | null): QuantityValidationResult {
  const disputed = parseScaledDecimal(disputedAmountRaw);
  if (disputed === null) {
    return { ok: false, message: "Disputed amount must be a non-negative number with at most 4 decimal places." };
  }
  if (disputed === BigInt(0)) {
    return { ok: false, message: "Disputed amount must be greater than zero." };
  }
  // Only enforce a ceiling when the invoice line actually carries a
  // lineTotal (it's nullable -- spec section 3's "do not invent missing
  // SAP fields" applies here too: no ceiling is invented when SAP's own
  // export didn't provide one).
  if (lineTotalRaw !== null) {
    const lineTotal = parseScaledDecimal(lineTotalRaw);
    if (lineTotal !== null && disputed > lineTotal) {
      return { ok: false, message: `Disputed amount (${disputedAmountRaw}) cannot exceed this invoice line's own total (${lineTotalRaw}).` };
    }
  }
  return { ok: true };
}

function formatNonNegativeScaled(scaled: bigint): string {
  const digits = scaled.toString().padStart(5, "0");
  return `${digits.slice(0, -4)}.${digits.slice(-4)}`;
}

// ---------------------------------------------------------------------------
// Zod input schemas.
// ---------------------------------------------------------------------------

const quantityLineSchema = z.object({
  sapInvoiceLineId: z.string().min(1),
  disputeType: z.literal("QUANTITY"),
  acceptedQuantity: decimalStringSchema,
  rejectedQuantity: decimalStringSchema,
  disputedUnitPrice: decimalStringSchema.optional(),
  reason: z.string().min(1).max(2000),
  evidenceNotes: z.string().max(4000).optional(),
});

const amountOnlyLineSchema = z.object({
  sapInvoiceLineId: z.string().min(1),
  disputeType: z.literal("AMOUNT_ONLY"),
  disputedAmount: decimalStringSchema,
  disputedUnitPrice: decimalStringSchema.optional(),
  reason: z.string().min(1).max(2000),
  evidenceNotes: z.string().max(4000).optional(),
});

export const claimLineInputSchema = z.discriminatedUnion("disputeType", [quantityLineSchema, amountOnlyLineSchema]);
export type ClaimLineInput = z.infer<typeof claimLineInputSchema>;

export const createInvoiceClaimSchema = z.object({
  sapInvoiceId: z.string().min(1),
  orderId: z.string().min(1).optional(),
  customerId: z.string().min(1),
  customerComplaintReference: z.string().max(200).optional(),
  category: z.enum(CLAIM_CATEGORIES),
  categoryDetail: z.string().max(2000).optional(),
  description: z.string().min(1).max(4000),
  assignedToId: z.string().min(1).optional(),
  priority: z.enum(CLAIM_PRIORITIES).optional(),
  claimDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "claimDate must be YYYY-MM-DD"),
  customerCommunicationNotes: z.string().max(4000).optional(),
  lines: z.array(claimLineInputSchema).min(1, "A claim must have at least one disputed line."),
});
export type CreateInvoiceClaimInput = z.infer<typeof createInvoiceClaimSchema>;

export const recordClaimResolutionSchema = z.object({
  findings: z.string().max(4000).optional(),
  responsibleDepartment: z.string().max(200).optional(),
  rootCause: z.string().max(2000).optional(),
  correctiveAction: z.string().max(2000).optional(),
  customerResponse: z.string().max(2000).optional(),
  decision: z.enum(RESOLUTION_DECISIONS),
  decisionDetail: z.string().max(2000).optional(),
  resolutionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "resolutionDate must be YYYY-MM-DD").optional(),
});
export type RecordClaimResolutionInput = z.infer<typeof recordClaimResolutionSchema>;

export const approveClaimResolutionSchema = z.object({
  approvedCreditAmount: decimalStringSchema.optional(),
});

export const rejectClaimResolutionSchema = z.object({
  rejectionReason: z.string().min(1).max(2000),
});

export const changeClaimStatusSchema = z.object({
  toStatus: z.enum(CLAIM_STATUSES),
  reason: z.string().min(1).max(2000),
});
