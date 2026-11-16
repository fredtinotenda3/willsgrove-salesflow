import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreatePersonnelInput, UpdatePersonnelInput } from "@/lib/personnel-validation";
import { personnelRoleRequiresDetail } from "@/lib/personnel-validation";

/**
 * Final Operational Enhancements (spec Part 4). Personnel CRUD --
 * create/view/edit/search/filter/deactivate/delete-where-safe -- modeled
 * directly on lib/users.ts's existing pattern (MutationFailure shape,
 * AuditEvent on every write, ADMINISTRATOR-only enforced at the route
 * layer, never here). See prisma/schema.prisma's Personnel model comment
 * for why this is a separate roster from User/sales-personnel, not a
 * duplicate of it.
 */

export type MutationFailure = {
  ok: false;
  status: number;
  message: string;
  fieldErrors?: Record<string, string>;
};

function isForeignKeyViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003";
}

export type ListPersonnelOptions = {
  role?: "DRIVER" | "DRIVER_ASSISTANT" | "OTHER";
  status?: "ACTIVE" | "INACTIVE";
  search?: string;
};

export async function listPersonnel(options: ListPersonnelOptions = {}) {
  const where: Prisma.PersonnelWhereInput = {};
  if (options.role) where.role = options.role;
  if (options.status) where.status = options.status;
  if (options.search && options.search.trim()) {
    where.OR = [
      { name: { contains: options.search.trim(), mode: "insensitive" } },
      { phone: { contains: options.search.trim(), mode: "insensitive" } },
    ];
  }

  const rows = await prisma.personnel.findMany({
    where,
    orderBy: [{ status: "asc" }, { name: "asc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      role: true,
      roleDetail: true,
      phone: true,
      notes: true,
      status: true,
      isDemo: true,
      createdAt: true,
      _count: { select: { dispatchesAsDriver: true, dispatchesAsAssistant: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    role: row.role,
    roleDetail: row.roleDetail,
    phone: row.phone,
    notes: row.notes,
    status: row.status,
    isDemo: row.isDemo,
    createdAt: row.createdAt.toISOString(),
    dispatchHistoryCount: row._count.dispatchesAsDriver + row._count.dispatchesAsAssistant,
  }));
}

export type CreatePersonnelResult = { ok: true; id: string } | MutationFailure;

export async function createPersonnel(input: CreatePersonnelInput, actorId: string): Promise<CreatePersonnelResult> {
  if (personnelRoleRequiresDetail(input.role) && !input.roleDetail?.trim()) {
    return { ok: false, status: 400, message: "A detail is required when role is OTHER.", fieldErrors: { roleDetail: "Required when role is OTHER." } };
  }

  const created = await prisma.$transaction(async (tx) => {
    const personnel = await tx.personnel.create({
      data: {
        name: input.name,
        role: input.role,
        roleDetail: input.roleDetail ?? null,
        phone: input.phone ?? null,
        notes: input.notes ?? null,
        createdById: actorId,
        isDemo: false,
      },
      select: { id: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PERSONNEL_CREATE",
        entityType: "Personnel",
        entityId: personnel.id,
        afterData: { name: input.name, role: input.role },
      },
    });

    return personnel;
  });

  return { ok: true, id: created.id };
}

export type UpdatePersonnelResult = { ok: true } | MutationFailure;

export async function updatePersonnel(id: string, input: UpdatePersonnelInput, actorId: string): Promise<UpdatePersonnelResult> {
  const effectiveRole = input.role;
  if (effectiveRole && personnelRoleRequiresDetail(effectiveRole) && !input.roleDetail?.trim()) {
    return { ok: false, status: 400, message: "A detail is required when role is OTHER.", fieldErrors: { roleDetail: "Required when role is OTHER." } };
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.personnel.findUnique({ where: { id }, select: { name: true, role: true, roleDetail: true, phone: true, notes: true, status: true } });
    if (!existing) {
      return { ok: false, status: 404, message: "Personnel record not found." } satisfies MutationFailure;
    }

    const data: Prisma.PersonnelUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.role !== undefined) data.role = input.role;
    if (input.roleDetail !== undefined) data.roleDetail = input.roleDetail;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.status !== undefined && input.status !== existing.status) {
      data.status = input.status;
      data.statusChangedById = actorId;
      data.statusChangedAt = new Date();
    }

    await tx.personnel.update({ where: { id }, data });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PERSONNEL_UPDATE",
        entityType: "Personnel",
        entityId: id,
        beforeData: existing,
        afterData: input,
      },
    });

    return { ok: true } as const;
  });
}

export type DeletePersonnelResult = { ok: true } | MutationFailure;

/**
 * "delete-where-safe" (spec Part 4): a hard delete is attempted directly;
 * the database's own onDelete: Restrict foreign key (DispatchRecord.
 * driver/assistant -> Personnel) is what makes this safe -- if this
 * Personnel row is referenced by ANY dispatch history, Postgres itself
 * refuses the delete (P2003), which this function turns into a clear
 * message asking the caller to deactivate instead. No separate
 * "has history?" pre-check is needed: the constraint IS the safety
 * check, so there is no window for a race between checking and deleting.
 */
export async function deletePersonnel(id: string, actorId: string): Promise<DeletePersonnelResult> {
  const existing = await prisma.personnel.findUnique({ where: { id }, select: { name: true } });
  if (!existing) {
    return { ok: false, status: 404, message: "Personnel record not found." };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.personnel.delete({ where: { id } });
      await tx.auditEvent.create({
        data: { actorId, action: "PERSONNEL_DELETE", entityType: "Personnel", entityId: id, beforeData: existing },
      });
    });
    return { ok: true };
  } catch (error) {
    if (isForeignKeyViolation(error)) {
      return {
        ok: false,
        status: 409,
        message: `${existing.name} has dispatch history and cannot be deleted. Deactivate this record instead to keep it out of future selections while preserving that history.`,
      };
    }
    throw error;
  }
}
