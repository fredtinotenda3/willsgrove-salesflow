import { z } from "zod";
import { RecordStatus } from "@prisma/client";

/**
 * Final Operational Enhancements (spec Part 4). Same shape as
 * lib/personnel-validation.ts/lib/user-validation.ts.
 */

export const createVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(1, "Registration number is required.").max(50),
  description: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CreateVehicleInput = z.infer<typeof createVehicleSchema>;

export const updateVehicleSchema = z.object({
  registrationNumber: z.string().trim().min(1, "Registration number is required.").max(50).optional(),
  description: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: z.nativeEnum(RecordStatus, { message: "status must be ACTIVE or INACTIVE." }).optional(),
});

export type UpdateVehicleInput = z.infer<typeof updateVehicleSchema>;
