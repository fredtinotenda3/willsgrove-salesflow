import { z } from "zod";
import { decimalStringSchema } from "@/lib/picking/validation";

/**
 * Milestone 10 (Communication Channels & Fulfilment). Zod request schemas
 * for the dispatch/delivery API routes -- same "pure validation module,
 * no @prisma/client import" convention as lib/picking/validation.ts
 * (whose decimalStringSchema is reused here unchanged, imported not
 * copied).
 */

export const createDispatchLineSchema = z.object({
  orderLineId: z.string().min(1),
  quantity: decimalStringSchema,
});

export const createDispatchSchema = z.object({
  lines: z.array(createDispatchLineSchema).min(1, "At least one line is required."),
  vehicleOrCourierReference: z.string().max(200).optional(),
  plannedDepartureAt: z.string().datetime().optional(),
  notes: z.string().max(2000).optional(),
  // The specific AUTHORIZED PickingSession this dispatch's quantities are
  // being sourced from, where the caller wants that traceability recorded
  // (DispatchRecord.pickingSessionId) -- optional, since the outstanding-
  // quantity check itself (lib/fulfilment/queries.ts) already sums across
  // every authorized session for the order, not just one.
  pickingSessionId: z.string().min(1).optional(),
});
export type CreateDispatchInput = z.infer<typeof createDispatchSchema>;

export const departDispatchSchema = z.object({
  vehicleOrCourierReference: z.string().max(200).optional(),
});
export type DepartDispatchInput = z.infer<typeof departDispatchSchema>;

export const cancelDispatchSchema = z.object({
  reason: z.string().min(1, "A cancellation reason is required.").max(2000),
});
export type CancelDispatchInput = z.infer<typeof cancelDispatchSchema>;

export const recordDeliveryLineSchema = z.object({
  dispatchLineId: z.string().min(1),
  acceptedQuantity: decimalStringSchema,
  rejectedQuantity: decimalStringSchema,
  rejectionReason: z.string().max(2000).optional(),
});

export const recordDeliverySchema = z.object({
  lines: z.array(recordDeliveryLineSchema).min(1, "At least one line is required."),
  recipientName: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
});
export type RecordDeliveryInput = z.infer<typeof recordDeliverySchema>;
