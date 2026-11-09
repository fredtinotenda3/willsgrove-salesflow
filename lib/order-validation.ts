import { z } from "zod";
import { OrderSource } from "@prisma/client";
import { isValidDateOnlyString } from "@/lib/dates";

/**
 * Decimal-as-string pattern for every money/quantity field: the project
 * rule is "never floating point" for these (schema.prisma uses
 * @db.Decimal(18, 4) throughout), so input is accepted and validated as a
 * string and only ever converted via Prisma.Decimal, never Number(), at the
 * point of use in lib/orders.ts.
 */
const decimalString = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, "Must be a positive decimal number with up to 4 decimal places.")
  .refine((value) => Number(value) > 0, "Must be greater than zero.");

const optionalDecimalString = z
  .string()
  .trim()
  .regex(/^\d{1,14}(\.\d{1,4})?$/, "Must be a positive decimal number with up to 4 decimal places.")
  .nullable()
  .optional();

/**
 * Milestone 0 fix (round 5): was `.refine(... !Number.isNaN(...))`, which
 * matches "2026-02-30" (JS's Date constructor silently rolls invalid
 * calendar days forward instead of producing NaN) -- now delegates to
 * lib/dates.ts's isValidDateOnlyString, the one shared, round-trip-based
 * check that actually catches that. Still just a shape/value check: this
 * schema's inferred TYPE stays `string | null | undefined` (no
 * `.transform()`), by design -- see lib/dates.ts's module comment for why
 * converting to a real Date happens in lib/orders.ts, at the one place
 * that value actually reaches Prisma, not here.
 */
const dateOnlyString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date in YYYY-MM-DD format.")
  .refine(isValidDateOnlyString, "Not a valid date.")
  .nullable()
  .optional();

export const orderLineInputSchema = z.object({
  // Preserved verbatim from the customer's PO, even if it doesn't match a
  // known Product -- see Product.id below, which is a best-effort match,
  // not a correction of what the customer wrote.
  originalProductDescription: z.string().trim().min(1, "Product description is required.").max(500),

  // Best-effort link to a known SAP product; left null when unmatched.
  productId: z.string().trim().min(1).max(64).nullable().optional(),
  sapItemCodeSnapshot: z.string().trim().max(50).nullable().optional(),

  // Quantity keyed by staff: still an open assumption pending confirmation
  // with invoicing (per Stanley's explicit note) -- accepted and stored
  // as given, never silently adjusted.
  requestedQuantity: decimalString,
  requestedUnitCode: z.string().trim().min(1, "Unit is required.").max(20),

  // The customer's own submitted price. This is NEVER treated as the
  // approved selling price -- approvedUnitPrice is a separate field, set
  // only through the (future milestone's) price-decision workflow.
  customerUnitPrice: optionalDecimalString,

  salesNotes: z.string().trim().max(1000).nullable().optional(),
});

export type OrderLineInput = z.infer<typeof orderLineInputSchema>;

export const createOrderSchema = z.object({
  customerId: z.string().trim().min(1, "Customer is required.").max(64),
  customerLocationId: z.string().trim().min(1).max(64).nullable().optional(),
  customerPoReference: z.string().trim().max(100).nullable().optional(),
  source: z.nativeEnum(OrderSource, { message: "source must be EMAIL, WHATSAPP or MANUAL." }),
  orderDate: dateOnlyString,
  requestedDeliveryDate: dateOnlyString,
  deliveryAddress: z.string().trim().max(500).nullable().optional(),

  // The customer's own message/PO text, preserved verbatim -- see
  // prisma/schema.prisma's comment on CustomerOrder.originalSourceText.
  // Separate from internalNotes (staff-only commentary), never merged
  // into it.
  originalSourceText: z.string().trim().max(5000).nullable().optional(),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code.")
    .optional(),
  internalNotes: z.string().trim().max(2000).nullable().optional(),

  // Lets a client safely retry a submission (e.g. after a dropped
  // response) without creating a duplicate order -- see lib/orders.ts.
  idempotencyKey: z.string().trim().min(1).max(100).optional(),

  // Milestone 0 fix (2nd round): an order may now be created with zero
  // lines when it was submitted via pasted text and/or an uploaded
  // document (modes (b)/(c) in the brief) with no AI line extraction yet
  // -- that's Milestone 2. Such an order waits for a human to add lines
  // after reading what was pasted/attached, rather than being blocked at
  // intake. This schema deliberately does not re-add a cross-field "must
  // have lines OR text" rule: a document is uploaded in a separate
  // request after the order id exists (see POST /api/orders/[id]/documents),
  // so at the time this schema runs there is no reliable way to know "a
  // file is on its way." The real guard against a truly empty submission
  // (no lines, no text, no file) lives in the client's own validation
  // (app/orders/new/page.tsx's validateClientSide), which is where it
  // belongs since only the client knows whether a file is queued.
  lines: z.array(orderLineInputSchema).max(200),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
