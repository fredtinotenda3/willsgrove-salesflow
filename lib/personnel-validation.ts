import { z } from "zod";
import { PersonnelRole, RecordStatus } from "@prisma/client";

/**
 * Final Operational Enhancements (spec Part 4). Same shape as
 * lib/user-validation.ts's createUserSchema/updateUserStatusSchema --
 * Personnel is a roster of named people (drivers, driver's assistants,
 * other named operational roles) who do NOT have a login account; see
 * prisma/schema.prisma's own comment on the Personnel model for why this
 * is not a duplicate of User/sales-personnel management.
 */

export const createPersonnelSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(150),
  role: z.nativeEnum(PersonnelRole, { message: "role must be DRIVER, DRIVER_ASSISTANT or OTHER." }),
  roleDetail: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export type CreatePersonnelInput = z.infer<typeof createPersonnelSchema>;

export const updatePersonnelSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(150).optional(),
  role: z.nativeEnum(PersonnelRole, { message: "role must be DRIVER, DRIVER_ASSISTANT or OTHER." }).optional(),
  roleDetail: z.string().trim().max(2000).optional(),
  phone: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(2000).optional(),
  status: z.nativeEnum(RecordStatus, { message: "status must be ACTIVE or INACTIVE." }).optional(),
});

export type UpdatePersonnelInput = z.infer<typeof updatePersonnelSchema>;

/** "Other requires detail" -- same rule as LostSaleReason/InvoiceClaimCategory. */
export function personnelRoleRequiresDetail(role: PersonnelRole): boolean {
  return role === "OTHER";
}
