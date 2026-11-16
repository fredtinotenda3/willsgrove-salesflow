import { z } from "zod";
import { createInvoiceClaimSchema } from "@/lib/invoice-claims/validation";

/**
 * Final Operational Enhancements (spec Part 5) -- the "central
 * requirement": once an invoiced order has been delivered, its outcome
 * must be explicitly recorded as either "No Claim" or "With Claim".
 * "No Claim" must leave an explicit record (never just the absence of
 * one), and "With Claim" allows one-or-more linked InvoiceClaim records
 * to be created in the SAME transaction (see lib/invoice-delivery/
 * record-outcome.ts), so a request that fails partway never leaves a
 * delivery record with no claim behind it, or a claim with no delivery
 * record behind it.
 *
 * Pure logic/schemas only -- no @prisma/client import -- same
 * client-safe convention as lib/invoice-claims/validation.ts.
 */

export const INVOICE_DELIVERY_OUTCOMES = ["NO_CLAIM", "WITH_CLAIM"] as const;
export type InvoiceDeliveryOutcomeValue = (typeof INVOICE_DELIVERY_OUTCOMES)[number];

/**
 * Each claim line's input is identical to createInvoiceClaimSchema's,
 * minus `sapInvoiceId` -- which this schema's own `outcome: "WITH_CLAIM"`
 * branch always derives from the SapInvoice whose delivery is being
 * recorded (the URL/route param), never accepted from the request body,
 * so a caller cannot create a claim against a different invoice than the
 * one it is nominally being recorded against.
 *
 * `customerId` is relaxed to optional here (createInvoiceClaimSchema
 * requires it): recording a delivery outcome almost always happens on an
 * invoice that already has a resolved matchedCustomerId (Milestone 5), so
 * lib/invoice-delivery/record-outcome.ts defaults it from there when the
 * caller omits it, sparing the UI from re-asking for a customer the
 * invoice already resolved. If the invoice genuinely has no resolved
 * customer, record-outcome.ts reports a clear field error rather than
 * silently failing.
 */
const deliveryClaimInputSchema = createInvoiceClaimSchema.omit({ sapInvoiceId: true, customerId: true }).extend({
  customerId: z.string().min(1).optional(),
});
export type DeliveryClaimInput = z.infer<typeof deliveryClaimInputSchema>;

export const recordInvoiceDeliveryOutcomeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("NO_CLAIM"),
    podReference: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
  }),
  z.object({
    outcome: z.literal("WITH_CLAIM"),
    podReference: z.string().max(200).optional(),
    notes: z.string().max(2000).optional(),
    claims: z.array(deliveryClaimInputSchema).min(1, "At least one claim is required when the outcome is 'With Claim'."),
  }),
]);
export type RecordInvoiceDeliveryOutcomeInput = z.infer<typeof recordInvoiceDeliveryOutcomeSchema>;
