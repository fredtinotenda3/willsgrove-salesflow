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
  // Final Operational Enhancements (spec Part 3.3): "every confirmed
  // dispatch must record Driver, Driver's Assistant, and Truck
  // Registration, selected from registered Settings records" -- all
  // three required (not optional) for every dispatch created from this
  // point forward; see lib/fulfilment/dispatch.ts's createDispatchRecord
  // for the live existence/role/status checks against Personnel/Vehicle.
  driverId: z.string().min(1, "A driver is required."),
  assistantId: z.string().min(1, "A driver's assistant is required."),
  vehicleId: z.string().min(1, "A vehicle is required."),
  // Free-text fallback/supplement -- kept alongside the structured fields
  // above (never replaced by them), e.g. for a courier company name with
  // no registered Vehicle record of its own.
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

/**
 * Changing who/what is assigned to a dispatch after it was created. At least
 * one of driver/assistant/vehicle must be supplied, and a reason is always
 * required -- the change is written to the order's fulfilment history
 * (before and after), so "why" is part of the record, not optional.
 */
export const changeDispatchAssignmentSchema = z
  .object({
    driverId: z.string().min(1).optional(),
    assistantId: z.string().min(1).optional(),
    vehicleId: z.string().min(1).optional(),
    reason: z.string().trim().min(1, "A reason for the change is required.").max(1000),
  })
  .refine((value) => value.driverId || value.assistantId || value.vehicleId, {
    message: "Choose a new driver, assistant or vehicle.",
    path: ["driverId"],
  });
export type ChangeDispatchAssignmentInput = z.infer<typeof changeDispatchAssignmentSchema>;
