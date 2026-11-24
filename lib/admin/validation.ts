import { z } from "zod";
import { isValidId } from "@/lib/http";

const id = z.string().refine(isValidId, "Invalid id.");
const reason = z.string().trim().min(3, "Record the reason (at least 3 characters).").max(500);
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

export const departmentSchema = z.enum(["PURCHASING", "WAREHOUSE", "QUALITY_CONTROL", "SALES", "FINANCE", "OPERATIONS", "MANAGEMENT"]);

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    role: z.enum(["SALESPERSON", "SALES_MANAGER", "ADMINISTRATOR"]).optional(),
    department: departmentSchema.nullable().optional(),
    reason,
  })
  .refine((v) => v.name !== undefined || v.role !== undefined || v.department !== undefined, { message: "Nothing to change." });

export const userStatusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]), reason });
export const passwordActionSchema = z.object({ action: z.enum(["reset", "require-change"]), reason });

export const productCreateSchema = z.object({
  sapItemCode: z.string().trim().min(1).max(50).regex(/^[A-Za-z0-9._\-/]+$/, "Item codes may contain letters, digits and . _ - / only."),
  itemName: z.string().trim().min(2).max(200),
  barcode: optionalText(64),
  category: optionalText(100),
  unitOfMeasure: optionalText(20),
  packSize: optionalText(50),
  isVariableWeight: z.boolean().default(false),
  vatCode: optionalText(20),
});

/** sapItemCode is intentionally absent: SAP identifiers are never edited here. */
export const productUpdateSchema = z
  .object({
    itemName: z.string().trim().min(2).max(200).optional(),
    barcode: optionalText(64),
    category: optionalText(100),
    unitOfMeasure: optionalText(20),
    packSize: optionalText(50),
    isVariableWeight: z.boolean().optional(),
    vatCode: optionalText(20),
    reason,
  })
  .strict();

export const statusReasonSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]), reason });

export const priceListUpdateSchema = z.object({ name: z.string().trim().min(2).max(120), reason });

export const reassignSchema = z.object({
  entityType: z.enum(["ORDER", "QUOTATION", "CUSTOMER", "CLAIM", "MANAGEMENT_ACTION"]),
  ids: z.array(id).min(1).max(500),
  toUserId: id,
  reason,
  /** false = dry run: returns what would change, writes nothing. */
  confirm: z.boolean().default(false),
});

export const reassignAllFromUserSchema = z.object({
  fromUserId: id,
  toUserId: id,
  entityTypes: z.array(z.enum(["ORDER", "QUOTATION", "CUSTOMER", "CLAIM", "MANAGEMENT_ACTION"])).min(1),
  reason,
  confirm: z.boolean().default(false),
});

export const settingSchema = z.object({
  key: z.string().min(3).max(100),
  value: z.number().int().nullable(),
  reason,
});

export const accountManagerSchema = z.object({ accountManagerId: id.nullable(), reason });

export type ReassignEntityType = z.infer<typeof reassignSchema>["entityType"];
