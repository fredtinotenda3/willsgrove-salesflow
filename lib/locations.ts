import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { MutationFailure } from "@/lib/customers";
import type {
  CreateLocationInput,
  UpdateLocationInput,
} from "@/lib/location-validation";

export type CreateLocationResult = { ok: true; id: string } | MutationFailure;
export type UpdateLocationResult =
  | { ok: true; changed: boolean }
  | MutationFailure;

const TRANSACTION_OPTIONS = { maxWait: 15000, timeout: 15000 };

const customerNotFound: MutationFailure = {
  ok: false,
  status: 404,
  message: "Customer not found.",
};

const locationNotFound: MutationFailure = {
  ok: false,
  status: 404,
  message: "Location not found.",
};

export async function createLocation(
  customerId: string,
  input: CreateLocationInput
): Promise<CreateLocationResult> {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: { id: true },
    });

    if (!customer) {
      return customerNotFound;
    }

    const activeDefault = await tx.customerLocation.findFirst({
      where: { customerId, isActive: true, isDefault: true },
      select: { id: true },
    });

    const becomesDefault = input.makeDefault || activeDefault === null;

    if (becomesDefault) {
      await tx.customerLocation.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const created = await tx.customerLocation.create({
      data: {
        customerId,
        label: input.label,
        addressLine1: input.addressLine1,
        addressLine2: input.addressLine2,
        city: input.city,
        province: input.province,
        isDefault: becomesDefault,
        isActive: true,
      },
      select: { id: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId: null,
        action: "LOCATION_CREATE",
        entityType: "CustomerLocation",
        entityId: created.id,
        afterData: {
          customerId,
          label: input.label,
          addressLine1: input.addressLine1,
          addressLine2: input.addressLine2,
          city: input.city,
          province: input.province,
          isDefault: becomesDefault,
          previousDefaultLocationId:
            becomesDefault && activeDefault ? activeDefault.id : null,
        },
      },
    });

    return { ok: true, id: created.id } as const;
  }, TRANSACTION_OPTIONS);
}

const TEXT_KEYS = [
  "label",
  "addressLine1",
  "addressLine2",
  "city",
  "province",
] as const;

export async function updateLocation(
  customerId: string,
  locationId: string,
  changes: UpdateLocationInput
): Promise<UpdateLocationResult> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customerLocation.findFirst({
      where: { id: locationId, customerId },
      select: {
        label: true,
        addressLine1: true,
        addressLine2: true,
        city: true,
        province: true,
        isDefault: true,
        isActive: true,
      },
    });

    if (!existing) {
      return locationNotFound;
    }

    const finalActive = changes.isActive ?? existing.isActive;

    if (changes.isDefault === true && !finalActive) {
      return {
        ok: false,
        status: 409,
        message: "An inactive location cannot be the default.",
      } satisfies MutationFailure;
    }

    const deactivating = changes.isActive === false && existing.isActive;

    if (deactivating && existing.isDefault) {
      const otherActive = await tx.customerLocation.count({
        where: { customerId, isActive: true, id: { not: locationId } },
      });

      if (otherActive > 0) {
        return {
          ok: false,
          status: 409,
          message:
            "Choose another default location before deactivating this one.",
        } satisfies MutationFailure;
      }
    }

    const before: Record<string, string | boolean | null> = {};
    const after: Record<string, string | boolean | null> = {};
    const data: Prisma.CustomerLocationUpdateInput = {};

    for (const key of TEXT_KEYS) {
      const next = changes[key];

      if (next === undefined || next === existing[key]) {
        continue;
      }

      before[key] = existing[key];
      after[key] = next;
      Object.assign(data, { [key]: next });
    }

    if (changes.isActive !== undefined && changes.isActive !== existing.isActive) {
      before.isActive = existing.isActive;
      after.isActive = changes.isActive;
      Object.assign(data, { isActive: changes.isActive });
    }

    let previousDefaultLocationId: string | null = null;

    if (changes.isDefault === true && !existing.isDefault) {
      const currentDefault = await tx.customerLocation.findFirst({
        where: { customerId, isDefault: true, id: { not: locationId } },
        select: { id: true },
      });

      previousDefaultLocationId = currentDefault?.id ?? null;

      await tx.customerLocation.updateMany({
        where: { customerId, isDefault: true, id: { not: locationId } },
        data: { isDefault: false },
      });

      before.isDefault = false;
      after.isDefault = true;
      Object.assign(data, { isDefault: true });
    }

    // Deactivating the only active location also clears its default flag.
    if (deactivating && existing.isDefault) {
      before.isDefault = true;
      after.isDefault = false;
      Object.assign(data, { isDefault: false });
    }

    if (Object.keys(after).length === 0) {
      return { ok: true, changed: false } as const;
    }

    await tx.customerLocation.update({ where: { id: locationId }, data });

    await tx.auditEvent.create({
      data: {
        actorId: null,
        action: "LOCATION_UPDATE",
        entityType: "CustomerLocation",
        entityId: locationId,
        beforeData: before,
        afterData: {
          ...after,
          customerId,
          ...(previousDefaultLocationId
            ? { previousDefaultLocationId }
            : {}),
        },
      },
    });

    return { ok: true, changed: true } as const;
  }, TRANSACTION_OPTIONS);
}