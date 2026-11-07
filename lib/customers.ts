import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type {
  CreateCustomerInput,
  FieldErrors,
  UpdateCustomerInput,
} from "@/lib/customer-validation";

export type MutationFailure = {
  ok: false;
  status: number;
  message: string;
  fieldErrors?: FieldErrors;
};

export type CreateCustomerResult =
  | { ok: true; id: string }
  | MutationFailure;

export type UpdateCustomerResult =
  | { ok: true; changed: boolean }
  | MutationFailure;

const TRANSACTION_OPTIONS = { maxWait: 15000, timeout: 15000 };

// The only unique column besides the id is sapCustomerCode, so any unique
// violation on the customer table is a duplicate SAP customer code.
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

const duplicateCodeFailure: MutationFailure = {
  ok: false,
  status: 409,
  message: "A customer with this SAP customer code already exists.",
  fieldErrors: { sapCustomerCode: "This SAP customer code is already used." },
};

export async function createCustomer(
  input: CreateCustomerInput,
  // isDemo is intentionally not part of CreateCustomerInput (and therefore
  // never settable via the public /api/customers route) -- only
  // prisma/seed.ts passes { isDemo: true }, so a demo row can only ever be
  // produced by the seed script, never by an HTTP request.
  options?: { isDemo?: boolean }
): Promise<CreateCustomerResult> {
  const isDemo = options?.isDemo ?? false;

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          name: input.name,
          sapCustomerCode: input.sapCustomerCode,
          email: input.email,
          phone: input.phone,
          category: input.category,
          notes: input.notes,
          isDemo,
          ...(input.location
            ? { locations: { create: { ...input.location, isDefault: true, isDemo } } }
            : {}),
        },
        select: { id: true },
      });

      await tx.auditEvent.create({
        data: {
          actorId: null,
          action: "CUSTOMER_CREATE",
          entityType: "Customer",
          entityId: created.id,
          afterData: {
            name: input.name,
            sapCustomerCode: input.sapCustomerCode,
            email: input.email,
            phone: input.phone,
            category: input.category,
            notes: input.notes,
            status: "ACTIVE",
            location: input.location,
          },
        },
      });

      return created;
    }, TRANSACTION_OPTIONS);

    return { ok: true, id: customer.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateCodeFailure;
    }

    throw error;
  }
}

const UPDATABLE_KEYS = [
  "name",
  "sapCustomerCode",
  "email",
  "phone",
  "category",
  "notes",
  "status",
] as const;

export async function updateCustomer(
  id: string,
  changes: UpdateCustomerInput
): Promise<UpdateCustomerResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.customer.findUnique({
        where: { id },
        select: {
          name: true,
          sapCustomerCode: true,
          email: true,
          phone: true,
          category: true,
          notes: true,
          status: true,
        },
      });

      if (!existing) {
        return {
          ok: false,
          status: 404,
          message: "Customer not found.",
        } satisfies MutationFailure;
      }

      const before: Record<string, string | null> = {};
      const after: Record<string, string | null> = {};
      const data: Prisma.CustomerUpdateInput = {};

      for (const key of UPDATABLE_KEYS) {
        const next = changes[key];

        if (next === undefined || next === existing[key]) {
          continue;
        }

        before[key] = existing[key];
        after[key] = next;
        Object.assign(data, { [key]: next });
      }

      if (Object.keys(after).length === 0) {
        return { ok: true, changed: false } as const;
      }

      await tx.customer.update({ where: { id }, data });

      await tx.auditEvent.create({
        data: {
          actorId: null,
          action: "CUSTOMER_UPDATE",
          entityType: "Customer",
          entityId: id,
          beforeData: before,
          afterData: after,
        },
      });

      return { ok: true, changed: true } as const;
    }, TRANSACTION_OPTIONS);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateCodeFailure;
    }

    throw error;
  }
}