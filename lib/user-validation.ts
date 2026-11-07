import { z } from "zod";
import { RecordStatus, UserRole } from "@prisma/client";

export const createUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(150),
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .max(254)
    .email("Enter a valid email address."),
  role: z.nativeEnum(UserRole, { message: "role must be SALESPERSON, SALES_MANAGER or ADMINISTRATOR." }),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;

export const updateUserStatusSchema = z.object({
  status: z.nativeEnum(RecordStatus, { message: "status must be ACTIVE or INACTIVE." }),
});

export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
