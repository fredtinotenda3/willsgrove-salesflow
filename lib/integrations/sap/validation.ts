import { z } from "zod";

/**
 * Milestone 9 (SAP Business One Integration). Pure logic only -- no
 * `@prisma/client` import -- same convention as lib/approvals/
 * validation.ts.
 */

// baseUrl/companyDb/username are the only connection fields an
// ADMINISTRATOR can set through the UI (spec section 6) -- the password
// is environment-only (lib/integrations/sap/config.ts) and has no field
// here at all.
export const updateSapConnectionSchema = z.object({
  mode: z.enum(["MOCK", "LIVE"]).optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().trim().max(500).url().nullable().optional(),
  companyDb: z.string().trim().max(200).nullable().optional(),
  username: z.string().trim().max(200).nullable().optional(),
});
export type UpdateSapConnectionInput = z.infer<typeof updateSapConnectionSchema>;

export const SYNC_JOB_SLUGS = ["products", "customers", "invoices", "credit-notes"] as const;
export type SyncJobSlug = (typeof SYNC_JOB_SLUGS)[number];

export function isValidSyncJobSlug(value: string): value is SyncJobSlug {
  return (SYNC_JOB_SLUGS as readonly string[]).includes(value);
}

export const sinceQuerySchema = z.object({
  since: z
    .string()
    .trim()
    .refine((v) => !Number.isNaN(Date.parse(v)), "since must be a valid ISO date")
    .optional(),
});

export const resolveUncertainOperationSchema = z.discriminatedUnion("confirmedCreated", [
  z.object({
    confirmedCreated: z.literal(true),
    sapDocEntry: z.string().trim().min(1).max(100),
    sapDocNum: z.string().trim().min(1).max(100),
  }),
  z.object({
    confirmedCreated: z.literal(false),
    notes: z.string().trim().min(1).max(2000),
  }),
]);
