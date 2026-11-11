import { z } from "zod";
import { decimalStringSchema, parseScaledDecimal } from "@/lib/picking/validation";
import { isValidDateOnlyString } from "@/lib/dates";

/**
 * Milestone 7 (Quotations Management). Pure logic only -- no
 * `@prisma/client` import, no database access -- so this file is safe to
 * import from a Client Component and to unit-test without a database,
 * same convention as lib/invoice-claims/validation.ts and
 * lib/picking/validation.ts.
 *
 * `decimalStringSchema`/`parseScaledDecimal` are imported directly from
 * lib/picking/validation.ts rather than duplicated -- this project's
 * established reuse for non-negative, 4-decimal-place scaled-BigInt
 * quantity/money validation since Milestone 4.
 */

// ---------------------------------------------------------------------------
// Status + transition graph (spec section 5).
//
// "At minimum, consider" DRAFT/ISSUED/ACCEPTED/REJECTED/EXPIRED/CANCELLED
// -- exactly these 6, nothing added. A quotation that needs to change
// after being issued is REVISED (a new Quotation row -- see
// lib/quotations/revise.ts), never a 7th status: the OLD row's status
// here is frozen exactly as it was at the moment of revision ("preserve
// the acceptance/rejection history of previous versions," spec section
// 6) via Quotation.supersededAt, not by inventing a SUPERSEDED/REVISED
// status value that would have to be threaded through this transition
// graph as a dead end from every other status.
// ---------------------------------------------------------------------------

export const QUOTATION_STATUSES = ["DRAFT", "ISSUED", "ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

// Exhaustive: every one of the 6 statuses has an entry (Record<QuotationStatus, ...>
// makes a status added to QUOTATION_STATUSES without a matching entry here
// a compile error, not a silent runtime gap -- same pattern as
// lib/invoice-claims/validation.ts's CLAIM_STATUS_TRANSITIONS).
const QUOTATION_STATUS_TRANSITIONS: Record<QuotationStatus, readonly QuotationStatus[]> = {
  DRAFT: ["ISSUED", "CANCELLED"],
  // ACCEPTED/REJECTED/EXPIRED are reached only through their own named
  // actions (lib/quotations/respond.ts, lib/quotations/expiry.ts), never
  // through a generic "change status" call -- see
  // validateQuotationStatusTransition's own comment below.
  ISSUED: ["ACCEPTED", "REJECTED", "EXPIRED", "CANCELLED"],
  // Whether an ACCEPTED quotation may still move to CANCELLED depends on
  // a DATA FACT (has it already been converted into a CustomerOrder?),
  // not on status alone -- spec section 8's "prevent inappropriate
  // cancellation of quotations already converted into orders." That
  // check lives in lib/quotations/cancel.ts (reads convertedOrderId),
  // deliberately NOT encoded as a missing edge here, since the graph
  // itself has no way to see other columns.
  ACCEPTED: ["CANCELLED"],
  REJECTED: [],
  EXPIRED: ["CANCELLED"],
  CANCELLED: [],
};

export type QuotationStatusTransitionResult = { ok: true } | { ok: false; message: string };

/**
 * Validates one proposed status transition against the graph above.
 * Deliberately NOT exposed as a free "change to any status" action
 * anywhere in the API surface (unlike lib/invoice-claims's
 * changeClaimStatus) -- every quotation status change has its own named,
 * purpose-built action (issue/respond/expire/cancel) with its own extra
 * business rules that a single generic endpoint could not enforce
 * correctly (e.g. "a rejection needs a reason," "cancelling an ACCEPTED
 * quotation checks convertedOrderId first"). This function is still the
 * single source of truth each of those actions consults before writing,
 * so the graph itself can never be bypassed or duplicated.
 */
export function validateQuotationStatusTransition(from: QuotationStatus, to: QuotationStatus): QuotationStatusTransitionResult {
  if (from === to) {
    return { ok: false, message: `The quotation is already ${to}.` };
  }
  const allowed = QUOTATION_STATUS_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    return { ok: false, message: `Cannot move a quotation from ${from} directly to ${to}.` };
  }
  return { ok: true };
}

/** Terminal statuses -- nothing further can ever happen to the quotation itself (a revision creates a NEW row instead). */
export function isTerminalQuotationStatus(status: QuotationStatus): boolean {
  return status === "REJECTED" || status === "CANCELLED";
}

/**
 * Which statuses a NEW revision may legitimately be created from.
 * DRAFT is excluded (nothing has been sent yet -- just edit it in
 * place); CANCELLED is excluded (a dead quotation is not revised, a new
 * one is created from scratch); an already-superseded quotation is
 * excluded by lib/quotations/revise.ts's own check against
 * supersededAt/previousRevisionId, not by this function (status alone
 * can't tell the two apart, since a superseded row keeps its original
 * status forever).
 */
const REVISABLE_STATUSES: ReadonlySet<QuotationStatus> = new Set(["ISSUED", "ACCEPTED", "REJECTED", "EXPIRED"]);
export function isRevisableStatus(status: QuotationStatus): boolean {
  return REVISABLE_STATUSES.has(status);
}

/** Only ACCEPTED quotations may be converted into a CustomerOrder (spec section 8). */
export function isConvertibleStatus(status: QuotationStatus): boolean {
  return status === "ACCEPTED";
}

/** A quotation's lines/header may only be edited while it is still DRAFT. */
export function isEditableStatus(status: QuotationStatus): boolean {
  return status === "DRAFT";
}

// ---------------------------------------------------------------------------
// Money/quantity helpers. Percent is a separate, narrower schema from
// decimalStringSchema -- bounded [0, 100] with at most 2 decimal places
// (same scale as TaxCode.ratePercent/Decimal(5,2)), since a discount or
// VAT rate can never legitimately be 150% or negative.
// ---------------------------------------------------------------------------

const PERCENT_STRING_PATTERN = /^\d{1,3}(\.\d{1,2})?$/;
export const percentStringSchema = z
  .string()
  .regex(PERCENT_STRING_PATTERN, "Must be a non-negative percentage with at most 2 decimal places.")
  .refine((value) => Number(value) <= 100, "Must not exceed 100%.");

export type PositiveQuantityResult = { ok: true } | { ok: false; message: string };

/** A quotation line's quantity must be strictly positive -- zero means "remove the line," not "quote zero of it." */
export function validatePositiveQuantity(quantityRaw: string): PositiveQuantityResult {
  const scaled = parseScaledDecimal(quantityRaw);
  if (scaled === null) {
    return { ok: false, message: "Quantity must be a non-negative number with at most 4 decimal places." };
  }
  if (scaled <= BigInt(0)) {
    return { ok: false, message: "Quantity must be greater than zero." };
  }
  return { ok: true };
}

/** validUntil must not be before quotationDate (an already-expired quote on arrival makes no sense). */
export function validateValidityWindow(quotationDateRaw: string, validUntilRaw: string): QuotationStatusTransitionResult {
  if (!isValidDateOnlyString(quotationDateRaw) || !isValidDateOnlyString(validUntilRaw)) {
    return { ok: false, message: "quotationDate and validUntil must both be valid YYYY-MM-DD dates." };
  }
  if (validUntilRaw < quotationDateRaw) {
    return { ok: false, message: "validUntil cannot be before quotationDate." };
  }
  return { ok: true };
}

/**
 * Spec section 5's expiry rule: "a quotation becomes eligible for expiry
 * when its validity date passes... do not rely only on a UI label."
 * Pure, live-computed eligibility check -- never a stored flag, so it can
 * never itself drift from `now`. The actual DRAFT->EXPIRED write only
 * ever happens through lib/quotations/expiry.ts's explicit, audited
 * action (manual button or scripts/expire-quotations.ts), which calls
 * this same function rather than re-deriving the rule.
 */
export function isEligibleForExpiry(status: QuotationStatus, validUntilDateOnly: string, todayDateOnly: string): boolean {
  return status === "ISSUED" && validUntilDateOnly < todayDateOnly;
}

// ---------------------------------------------------------------------------
// Zod input schemas.
// ---------------------------------------------------------------------------

const cataloguedLineSchema = z.object({
  isUnlistedItem: z.literal(false).optional().default(false),
  productId: z.string().min(1),
  unlistedItemDescription: z.undefined().optional(),
  quantity: decimalStringSchema,
  unitOfMeasure: z.string().max(40).optional(),
  unitPrice: decimalStringSchema,
  discountPercent: percentStringSchema.optional(),
  notes: z.string().max(2000).optional(),
});

const unlistedLineSchema = z.object({
  isUnlistedItem: z.literal(true),
  productId: z.undefined().optional(),
  unlistedItemDescription: z.string().min(1).max(500),
  quantity: decimalStringSchema,
  unitOfMeasure: z.string().max(40).optional(),
  unitPrice: decimalStringSchema,
  discountPercent: percentStringSchema.optional(),
  notes: z.string().max(2000).optional(),
});

export const quotationLineInputSchema = z.union([cataloguedLineSchema, unlistedLineSchema]);
export type QuotationLineInput = z.infer<typeof quotationLineInputSchema>;

const dateOnlySchema = z.string().refine(isValidDateOnlyString, "Must be a valid YYYY-MM-DD date.");

export const createQuotationSchema = z.object({
  customerId: z.string().min(1),
  customerContactId: z.string().min(1).optional(),
  quotationDate: dateOnlySchema,
  validUntil: dateOnlySchema,
  currency: z.string().min(1).max(10).optional(),
  customerReference: z.string().max(200).optional(),
  salespersonId: z.string().min(1).optional(), // defaults to the creating user -- see create.ts
  internalNotes: z.string().max(4000).optional(),
  customerNotes: z.string().max(4000).optional(),
  lines: z.array(quotationLineInputSchema).max(200).optional().default([]),
});
export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;

export const updateQuotationHeaderSchema = z.object({
  customerId: z.string().min(1).optional(),
  customerContactId: z.string().min(1).nullable().optional(),
  quotationDate: dateOnlySchema.optional(),
  validUntil: dateOnlySchema.optional(),
  currency: z.string().min(1).max(10).optional(),
  customerReference: z.string().max(200).nullable().optional(),
  salespersonId: z.string().min(1).optional(),
  internalNotes: z.string().max(4000).nullable().optional(),
  customerNotes: z.string().max(4000).nullable().optional(),
});
export type UpdateQuotationHeaderInput = z.infer<typeof updateQuotationHeaderSchema>;

export const addQuotationLineSchema = quotationLineInputSchema;
export const updateQuotationLineSchema = quotationLineInputSchema;

export const respondToQuotationSchema = z.discriminatedUnion("decision", [
  z.object({
    decision: z.literal("ACCEPTED"),
    responseNotes: z.string().max(2000).optional(),
    customerResponseReference: z.string().max(200).optional(),
  }),
  z.object({
    decision: z.literal("REJECTED"),
    rejectionReason: z.string().min(1).max(2000),
    responseNotes: z.string().max(2000).optional(),
  }),
]);
export type RespondToQuotationInput = z.infer<typeof respondToQuotationSchema>;

export const cancelQuotationSchema = z.object({
  cancellationReason: z.string().min(1).max(2000),
});
export type CancelQuotationInput = z.infer<typeof cancelQuotationSchema>;

export const reviseQuotationSchema = z.object({
  reason: z.string().max(2000).optional(),
});
export type ReviseQuotationInput = z.infer<typeof reviseQuotationSchema>;

export const convertQuotationToOrderSchema = z.object({
  customerLocationId: z.string().min(1).optional(),
  customerPoReference: z.string().max(200).optional(),
  requestedDeliveryDate: dateOnlySchema.optional(),
  deliveryAddress: z.string().max(500).optional(),
  internalNotes: z.string().max(4000).optional(),
});
export type ConvertQuotationToOrderInput = z.infer<typeof convertQuotationToOrderSchema>;

// Follow-up tracking (spec section 7: "next follow-up date, follow-up
// notes, responsible salesperson") gets its OWN schema/endpoint,
// deliberately separate from updateQuotationHeaderSchema above: header
// edits are DRAFT-only (lib/quotations/edit.ts's updateQuotationHeader),
// but follow-up is exactly as meaningful -- arguably more so -- on an
// ISSUED quotation awaiting a response, which must NOT be blocked by the
// "no editing once issued" rule that protects the quotation's financial
// values. It is pure staff-side scheduling data with no effect on price,
// VAT, or status, so it carries no status restriction at all.
export const updateQuotationFollowUpSchema = z.object({
  nextFollowUpDate: dateOnlySchema.nullable().optional(),
  followUpNotes: z.string().max(2000).nullable().optional(),
});
export type UpdateQuotationFollowUpInput = z.infer<typeof updateQuotationFollowUpSchema>;
