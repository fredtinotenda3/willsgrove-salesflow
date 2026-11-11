import { z } from "zod";
import { decimalStringSchema } from "@/lib/picking/validation";

/**
 * Milestone 6B (Returns & Credit Notes). Pure logic only -- no
 * `@prisma/client` import, no database access -- so this file is safe to
 * import from a Client Component and to unit-test without a database.
 *
 * Mirrors lib/invoice-claims/validation.ts's own shape exactly: fixed
 * controlled vocabulary with an "OTHER" escape valve, zod input schemas,
 * no business logic that needs a live database connection.
 */

export const RETURN_CONDITIONS = ["GOOD_RESALABLE", "DAMAGED", "EXPIRED", "OTHER"] as const;
export type ReturnCondition = (typeof RETURN_CONDITIONS)[number];

/** Only "OTHER" requires a free-text detail, same rule as every other
 * controlled vocabulary in this codebase. */
export function returnConditionRequiresDetail(condition: ReturnCondition): boolean {
  return condition === "OTHER";
}

export const CREDIT_NOTE_MATCH_STATUSES = ["UNMATCHED", "AUTO_MATCHED", "MANUALLY_MATCHED", "CANNOT_LINK"] as const;
export type CreditNoteMatchStatus = (typeof CREDIT_NOTE_MATCH_STATUSES)[number];

// ---------------------------------------------------------------------------
// Zod input schemas.
// ---------------------------------------------------------------------------

export const recordClaimReturnSchema = z.object({
  claimLineId: z.string().min(1).optional(),
  receivedQuantity: decimalStringSchema,
  condition: z.enum(RETURN_CONDITIONS),
  conditionDetail: z.string().max(2000).optional(),
  conditionNotes: z.string().max(4000).optional(),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "receivedDate must be YYYY-MM-DD"),
});
export type RecordClaimReturnInput = z.infer<typeof recordClaimReturnSchema>;

export const recordCreditNoteManualSchema = z.object({
  claimId: z.string().min(1),
  sapCreditNoteDocNum: z.string().min(1).max(100),
  sapCreditNoteDocEntry: z.string().max(100).optional(),
  creditNoteDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "creditNoteDate must be YYYY-MM-DD").optional(),
  amount: decimalStringSchema,
  currencyCode: z.string().max(10).optional(),
  notes: z.string().max(4000).optional(),
});
export type RecordCreditNoteManualInput = z.infer<typeof recordCreditNoteManualSchema>;

export const manuallyMatchCreditNoteSchema = z.object({
  claimId: z.string().min(1),
  note: z.string().min(1).max(2000),
});
export type ManuallyMatchCreditNoteInput = z.infer<typeof manuallyMatchCreditNoteSchema>;

export const cannotLinkCreditNoteSchema = z.object({
  note: z.string().min(1).max(2000),
});
export type CannotLinkCreditNoteInput = z.infer<typeof cannotLinkCreditNoteSchema>;

export const reopenCreditNoteMatchSchema = z.object({
  reason: z.string().min(1).max(2000),
});
export type ReopenCreditNoteMatchInput = z.infer<typeof reopenCreditNoteMatchSchema>;
