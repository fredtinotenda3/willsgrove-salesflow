import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreateVehicleInput, UpdateVehicleInput } from "@/lib/vehicle-validation";

/**
 * Final Operational Enhancements (spec Part 4). Vehicle CRUD -- same
 * shape as lib/personnel.ts, see that file's own comment.
 */

export type MutationFailure = {
  ok: false;
  status: number;
  message: string;
  fieldErrors?: Record<string, string>;
};

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

const duplicateRegistrationFailure: MutationFailure = {
  ok: false,
  status: 409,
  message: "A vehicle with this registration number already exists.",
  fieldErrors: { registrationNumber: "This registration number is already used." },
};

export type ListVehiclesOptions = {
  status?: "ACTIVE" | "INACTIVE";
  search?: string;
};

export async function listVehicles(options: ListVehiclesOptions = {}) {
  const where: Prisma.VehicleWhereInput = {};
  if (options.status) where.status = options.status;
  if (options.search && options.search.trim()) {
    where.OR = [
      { registrationNumber: { contains: options.search.trim(), mode: "insensitive" } },
      { description: { contains: options.search.trim(), mode: "insensitive" } },
    ];
  }

  const rows = await prisma.vehicle.findMany({
    where,
    orderBy: [{ status: "asc" }, { registrationNumber: "asc" }],
    select: {
      id: true,
      registrationNumber: true,
      description: true,
      notes: true,
      status: true,
      isDemo: true,
      createdAt: true,
      _count: { select: { dispatchRecords: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    registrationNumber: row.registrationNumber,
    description: row.description,
    notes: row.notes,
    status: row.status,
    isDemo: row.isDemo,
    createdAt: row.createdAt.toISOString(),
    dispatchHistoryCount: row._count.dispatchRecords,
  }));
}

export type CreateVehicleResult = { ok: true; id: string } | MutationFailure;

export async function createVehicle(input: CreateVehicleInput, actorId: string): Promise<CreateVehicleResult> {
  try {
    const created = await prisma.$transaction(async (tx) => {
      const vehicle = await tx.vehicle.create({
        data: {
          registrationNumber: input.registrationNumber,
          description: input.description ?? null,
          notes: input.notes ?? null,
          createdById: actorId,
          isDemo: false,
        },
        select: { id: true },
      });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "VEHICLE_CREATE",
          entityType: "Vehicle",
          entityId: vehicle.id,
          afterData: { registrationNumber: input.registrationNumber },
        },
      });

      return vehicle;
    });

    return { ok: true, id: created.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateRegistrationFailure;
    }
    throw error;
  }
}

export type UpdateVehicleResult = { ok: true } | MutationFailure;

export async function updateVehicle(id: string, input: UpdateVehicleInput, actorId: string): Promise<UpdateVehicleResult> {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.vehicle.findUnique({ where: { id }, select: { registrationNumber: true, description: true, notes: true, status: true } });
      if (!existing) {
        return { ok: false, status: 404, message: "Vehicle not found." } satisfies MutationFailure;
      }

      const data: Prisma.VehicleUpdateInput = {};
      if (input.registrationNumber !== undefined) data.registrationNumber = input.registrationNumber;
      if (input.description !== undefined) data.description = input.description;
      if (input.notes !== undefined) data.notes = input.notes;
      if (input.status !== undefined && input.status !== existing.status) {
        data.status = input.status;
        data.statusChangedById = actorId;
        data.statusChangedAt = new Date();
      }

      await tx.vehicle.update({ where: { id }, data });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "VEHICLE_UPDATE",
          entityType: "Vehicle",
          entityId: id,
          beforeData: existing,
          afterData: input,
        },
      });

      return { ok: true } as const;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateRegistrationFailure;
    }
    throw error;
  }
}

export type DeleteVehicleResult = { ok: true } | MutationFailure;

/** "delete-where-safe" -- same database-enforced convention as lib/personnel.ts's deletePersonnel(). */
export async function deleteVehicle(id: string, actorId: string): Promise<DeleteVehicleResult> {
  const existing = await prisma.vehicle.findUnique({ where: { id }, select: { registrationNumber: true } });
  if (!existing) {
    return { ok: false, status: 404, message: "Vehicle not found." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.vehicle.delete({ where: { id } });
      await tx.auditEvent.create({
        data: { actorId, action: "VEHICLE_DELETE", entityType: "Vehicle", entityId: id, beforeData: existing },
      });
    });
    return { ok: true };
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return {
        ok: false,
        status: 409,
        message: `${existing.registrationNumber} has dispatch history and cannot be deleted. Deactivate this record instead to keep it out of future selections while preserving that history.`,
      };
    }
    throw error;
  }
}
