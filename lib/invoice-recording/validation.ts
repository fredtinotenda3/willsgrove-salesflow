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
 * dispatched so far, minus whatever an earlier invoice (native OR
 * SAP-imported; see getInvoiceRecordingEligibility's own comment) already
 * covered. This is the same "never invoice more than went out the door"
 * guarantee a real SAP export gets implicitly (a SapInvoiceLine can only
 * exist for a line SAP itself has already invoiced) -- here it has to be
 * enforced explicitly, since nothing else stops an operator from typing
 * an arbitrary quantity.
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
      message: "Quantity invoiced cannot exceed what is still outstanding to invoice on this line (dispatched so far, minus any earlier invoice).",
    };
  }
  return { ok: true };
}
