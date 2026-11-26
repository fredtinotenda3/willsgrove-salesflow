import { z } from "zod";
import { decimalStringSchema, parseScaledDecimal } from "@/lib/picking/validation";

/**
 * Real-world fix (native invoice recording).
 *
 * Root cause this closes: recordInvoiceDeliveryOutcome() (lib/invoice-
 * delivery/record-outcome.ts) and the entire Delivered Orders detail view
 * (app/delivered-orders/[id]/page.tsx, lib/delivered-orders/queries.ts)
 * are keyed off a SapInvoice row -- and until now, the only code path in
 * this codebase that ever created one was the SAP CSV import
 * (lib/invoice-reconciliation/execute-import.ts). An order invoiced and
 * delivered without a SAP file ever being imported could never reach
 * that page or have its "No Claim / With Claim" outcome recorded at all.
 *
 * This module, together with record-native-invoice.ts, lets an order be
 * marked as invoiced directly in SalesFlow -- reusing the existing
 * SapInvoice/SapInvoiceLine/SapInvoiceImportBatch tables exactly as they
 * already exist (deliberately NO schema migration: see
 * record-native-invoice.ts's own comment for why), so every downstream
 * consumer (Delivered Orders, delivery-outcome recording, Invoice Claims)
 * keeps working completely unchanged, rather than growing a second,
 * parallel "native invoice" pipeline next to the SAP one.
 *
 * Pure logic/schemas only -- no @prisma/client import -- same
 * client-safe convention as lib/invoice-claims/validation.ts.
 */

export const recordNativeInvoiceLineInputSchema = z.object({
  orderLineId: z.string().min(1),
  quantityInvoiced: decimalStringSchema,
  unitPrice: decimalStringSchema,
});
export type RecordNativeInvoiceLineInput = z.infer<typeof recordNativeInvoiceLineInputSchema>;

export const recordNativeInvoiceSchema = z.object({
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "invoiceDate must be YYYY-MM-DD"),
  lines: z.array(recordNativeInvoiceLineInputSchema).min(1, "At least one line is required."),
});
export type RecordNativeInvoiceInput = z.infer<typeof recordNativeInvoiceSchema>;

/**
 * quantityInvoiced for a line must be greater than zero and may never
 * exceed what is actually still outstanding to invoice on that line --
 * the quantity picked and authorised for it, minus whatever an earlier
 * invoice (native OR SAP-imported; see getInvoiceRecordingEligibility's
 * own comment) already covered. Invoicing happens BEFORE dispatch (goods
 * may only leave once invoiced), so the ceiling is what was picked, never
 * what has already been dispatched. Nothing else stops an operator from
 * typing an arbitrary quantity, so it is enforced explicitly.
 */
export function validateNativeInvoiceLineQuantity(
  remainingToInvoiceRaw: string,
  quantityInvoicedRaw: string
): { ok: true } | { ok: false; message: string } {
  const remaining = parseScaledDecimal(remainingToInvoiceRaw);
  const quantity = parseScaledDecimal(quantityInvoicedRaw);
  if (remaining === null || quantity === null) {
    return { ok: false, message: "Invalid quantity." };
  }
  if (quantity <= BigInt(0)) {
    return { ok: false, message: "Quantity invoiced must be greater than zero." };
  }
  if (quantity > remaining) {
    return {
      ok: false,
      message: "Quantity invoiced cannot exceed what is still outstanding to invoice on this line (picked and authorised, minus any earlier invoice).",
    };
  }
  return { ok: true };
}

/**
 * Reset (void) of a natively-recorded invoice. The reason is mandatory:
 * it lands in the audit history and on the invoice itself, so "who undid
 * this and why" is always answerable.
 */
export const resetNativeInvoiceSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(5, "Please give a reason (at least 5 characters).")
    .max(500, "Reason must be 500 characters or fewer."),
});
export type ResetNativeInvoiceInput = z.infer<typeof resetNativeInvoiceSchema>;

/** Roles allowed to reset a recorded invoice. Recording stays open to any authenticated user (existing precedent); undoing it is a manager-level correction. */
export const INVOICE_RESET_ROLES = ["SALES_MANAGER", "ADMINISTRATOR"] as const;

export type ResetBlockerCounts = {
  claims: number;
  creditNotes: number;
  hasDeliveryRecord: boolean;
  /** Order lines on this invoice whose dispatched quantity would exceed the still-invoiced quantity if this invoice were voided. */
  dispatchedLines?: number;
};

/**
 * Downstream records that make a reset unsafe: a claim, a credit note or a
 * delivery outcome all reference this invoice as their anchor, so voiding
 * the invoice underneath them would orphan real business records. Pure so
 * the rule is unit-testable without a database.
 */
export function describeResetBlockers(counts: ResetBlockerCounts): string[] {
  const blockers: string[] = [];
  if (counts.claims > 0) blockers.push(`${counts.claims} invoice claim(s) are raised against it`);
  if (counts.creditNotes > 0) blockers.push(`${counts.creditNotes} credit note(s) are recorded against it`);
  if (counts.hasDeliveryRecord) blockers.push("a delivery outcome (No Claim / With Claim) has been recorded for it");
  if ((counts.dispatchedLines ?? 0) > 0) blockers.push(`goods on ${counts.dispatchedLines} line(s) have already been dispatched against it`);
  return blockers;
}
