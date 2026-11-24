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

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.").refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), "Invalid date.");
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v === undefined ? undefined : v === null || v === "" ? null : v));

export const orderUpdateSchema = z
  .object({
    customerPoReference: nullableText(100),
    requestedDeliveryDate: dateOnly.nullable().optional(),
    deliveryAddress: nullableText(500),
    internalNotes: nullableText(2000),
    reason,
  })
  .strict();

export const reasonOnlySchema = z.object({ reason }).strict();

export const priceListCreateSchema = z.object({
  code: z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9._\-/]+$/, "Codes may contain letters, digits and . _ - / only."),
  name: z.string().trim().min(2).max(120),
  currencyCode: z.enum(["USD", "ZWG"]),
});

export const priceEntryCreateSchema = z
  .object({
    sapItemCode: z.string().trim().min(1).max(50),
    unitPrice: z.string().trim().regex(/^\d{1,14}(\.\d{1,4})?$/, "Enter a positive price with up to 4 decimals.").refine((v) => Number(v) > 0, "Price must be above zero."),
    validFrom: dateOnly,
    validTo: dateOnly.nullable().optional(),
    reason,
  })
  .refine((v) => !v.validTo || v.validTo >= v.validFrom, { message: "Valid to must not be before valid from.", path: ["validTo"] });
