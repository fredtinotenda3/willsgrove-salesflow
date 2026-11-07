import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").max(254).email("Enter a valid email address."),
  password: z.string().min(1, "Password is required.").max(256),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required.").max(256),
  newPassword: z.string().min(1, "New password is required.").max(256),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
