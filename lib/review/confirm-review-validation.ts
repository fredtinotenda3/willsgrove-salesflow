/**
 * Milestone 2B. Validates the request body for POST
 * /api/po-intake/[id]/review/confirm -- the one action that turns a
 * reviewed OrderDocument into a real CustomerOrder. Reuses the exact
 * decimal/date primitives lib/order-validation.ts already defines for
 * the same shapes, rather than a second, drift-prone copy.
 */
import { z } from "zod";
import { decimalString, dateOnlyString } from "@/lib/order-validation";

export const lineDecisionSchema = z.object({
  extractedOrderLineId: z.string().trim().min(1).max(64),
  decision: z.enum(["ACCEPTED", "EXCLUDED"]),

  // Only meaningful (and only read) when decision is "ACCEPTED" --
  // otherwise ignored. Overrides the matching engine's suggestion or the
  // extracted value; `null` explicitly clears productId (proceed with no
  // product match), `undefined`/omitted means "use whatever
  // ExtractedOrderLine already has."
  productId: z.string().trim().min(1).max(64).nullable().optional(),
  requestedQuantity: decimalString.nullable().optional(),
  requestedUnitCode: z.string().trim().min(1).max(20).nullable().optional(),
  salesNotes: z.string().trim().max(1000).nullable().optional(),

  // Milestone 2C: multi-store splitting. Omitted/undefined (the
  // overwhelmingly common case) means "this line belongs to the
  // document-level `customerId`" -- exactly today's single-store
  // behavior, unchanged. Set this only when one submitted document
  // actually names several different store-customers at once (see
  // docs/milestones/PROGRESS.md's Milestone 2C section) and this
  // particular line belongs to a DIFFERENT customer than the document's
  // default one; confirm-review.ts groups accepted lines by their
  // effective customer and creates one CustomerOrder per group.
  // Deliberately not nullable -- there is no meaningful "explicitly no
  // customer" for a line, unlike productId.
  customerId: z.string().trim().min(1).max(64).optional(),
});

export type LineDecisionInput = z.infer<typeof lineDecisionSchema>;

export const confirmReviewSchema = z.object({
  // The DEFAULT customer for every line that doesn't carry its own
  // per-line customerId override (see lineDecisionSchema above) -- for
  // the overwhelmingly common single-store document, this is simply
  // "the" customer, exactly as before Milestone 2C.
  customerId: z.string().trim().min(1, "A resolved customer is required.").max(64),
  customerLocationId: z.string().trim().min(1).max(64).nullable().optional(),

  // Set only when the human manually resolved or corrected the customer
  // match in the review UI (i.e. it did NOT come from an exact
  // CustomerAlias hit) -- confirm-review.ts uses this exact text to
  // record/strengthen a CustomerAlias. Omitted when the header had
  // nothing to alias (e.g. a blank customerNameRaw) or the match was
  // already an alias hit with nothing to re-learn.
  customerAliasText: z.string().trim().max(300).nullable().optional(),

  header: z
    .object({
      customerPoReference: z.string().trim().max(100).nullable().optional(),
      orderDate: dateOnlyString,
      requestedDeliveryDate: dateOnlyString,
      deliveryAddress: z.string().trim().max(500).nullable().optional(),
      currency: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code.")
        .optional(),
      internalNotes: z.string().trim().max(2000).nullable().optional(),
    })
    .optional(),

  lines: z.array(lineDecisionSchema).min(1, "At least one line decision is required.").max(500),

  // Must be true when the server's own duplicate check finds a likely
  // duplicate (see lib/review/build-review-session.ts's checkForDuplicates) --
  // otherwise the confirm request is rejected with 409 and the warning,
  // never silently proceeding and never silently blocking.
  acknowledgeDuplicate: z.boolean().optional().default(false),
});

export type ConfirmReviewInput = z.infer<typeof confirmReviewSchema>;
