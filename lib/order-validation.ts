import { z } from "zod";
import { OrderSource } from "@prisma/client";

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

const dateOnlyString = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be a date in YYYY-MM-DD format.")
  .refine((value) => !Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime()), "Not a valid date.")
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

  lines: z.array(orderLineInputSchema).min(1, "At least one order line is required.").max(200),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
