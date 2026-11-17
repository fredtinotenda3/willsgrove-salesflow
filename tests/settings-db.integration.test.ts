import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Final Operational Enhancements (spec Part 4). DB-backed acceptance
 * tests for Personnel and Vehicle CRUD (lib/personnel.ts, lib/vehicles.ts)
 * against a REAL database through a REAL generated @prisma/client.
 *
 * OFF BY DEFAULT, for the exact same reason as every other
 * *-db.integration test in this project: @prisma/client in this sandbox
 * is a stub (see docs/milestones/PROGRESS.md's "Sandbox-only blocker").
 * Every lib touched here is imported with a dynamic `await import(...)`
 * inside the (skippable) test bodies below, never a static top-of-file
 * import.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` first (an admin user and a
 * DEMO-CUST-* customer must exist).
 *
 * "delete-where-safe" (lib/personnel.ts's own comment): a hard delete is
 * attempted directly, and the database's own onDelete: Restrict foreign
 * key (DispatchRecord.driver/assistant -> Personnel,
 * DispatchRecord.vehicle -> Vehicle) is what makes it safe. This file
 * builds a minimal CustomerOrder/OrderLine/DispatchRecord fixture directly
 * (not through the full picking -> authorize -> dispatch lifecycle, which
 * is already covered by tests/fulfilment-db.integration.test.ts) purely to
 * put a real DispatchRecord row in place to reference, since that FK is
 * the only thing this file needs to exercise.
 *
 * Every row this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Final Operational Enhancements Part 4: Personnel & Vehicle settings", () => {
  let skipAll = false;

  let adminId: string;
  let customerId: string;
  const uniqueSuffix = `settingstest-${Date.now()}`;

  const createdPersonnelIds: string[] = [];
  const createdVehicleIds: string[] = [];
  const createdOrderIds: string[] = [];

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({ where: { sapCustomerCode: { startsWith: "DEMO-CUST" } }, select: { id: true } });

    if (!admin || !customer) {
      console.log(
        "Skipping Final Operational Enhancements Part 4 settings DB integration test: need an admin user and a " +
          "DEMO-CUST-* customer. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
      );
      skipAll = true;
      return;
    }

    adminId = admin.id;
    customerId = customer.id;
  });

  afterAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    try {
      for (const orderId of createdOrderIds) {
        const dispatchRecordIds: { id: string }[] = await prisma.dispatchRecord.findMany({ where: { orderId }, select: { id: true } });
        await prisma.dispatchRecord.deleteMany({ where: { id: { in: dispatchRecordIds.map((d) => d.id) } } });
        await prisma.orderLine.deleteMany({ where: { orderId } });
      }
      for (const orderId of createdOrderIds) {
        await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => undefined);
      }
      await prisma.personnel.deleteMany({ where: { id: { in: createdPersonnelIds } } });
      await prisma.vehicle.deleteMany({ where: { id: { in: createdVehicleIds } } });
    } finally {
      await prisma.$disconnect();
    }
  });

  /** A minimal CustomerOrder + OrderLine + DispatchRecord referencing the given driver/assistant/vehicle -- built directly, not through createDispatchRecord(), since the only thing needed here is a real FK reference to restrict a delete against. */
  async function createDispatchReferencing(driverId: string, assistantId: string, vehicleId: string) {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");

    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "READY_TO_INVOICE",
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: { create: [{ lineNumber: 1, originalProductDescription: `Settings test item ${uniqueSuffix}`, requestedQuantity: "1.0000", requestedUnitCode: "EA", isDemo: true }] },
      },
      select: { id: true, lines: { select: { id: true } } },
    });
    createdOrderIds.push(order.id);

    await prisma.dispatchRecord.create({
      data: {
        orderId: order.id,
        createdById: adminId,
        driverId,
        assistantId,
        vehicleId,
        lines: { create: [{ orderLineId: order.lines[0]!.id, dispatchedQuantity: "1.0000" }] },
      },
    });
  }

  describe("Personnel", () => {
    it("createPersonnel requires roleDetail when role is OTHER, succeeds otherwise, and records an audit event", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { createPersonnel } = await import("@/lib/personnel");

      const missingDetail = await createPersonnel({ name: `Loader ${uniqueSuffix}`, role: "OTHER" }, adminId);
      expect(missingDetail.ok).toBe(false);
      if (!missingDetail.ok) expect(missingDetail.status).toBe(400);

      const created = await createPersonnel({ name: `Loader ${uniqueSuffix}`, role: "OTHER", roleDetail: "Warehouse loader, not a driver" }, adminId);
      expect(created.ok).toBe(true);
      if (!created.ok) throw new Error(created.message);
      createdPersonnelIds.push(created.id);

      const audit = await prisma.auditEvent.findFirst({ where: { action: "PERSONNEL_CREATE", entityId: created.id } });
      expect(audit).not.toBeNull();
    });

    it("listPersonnel filters by role, status, and search", async () => {
      if (skipAll) return;
      const { createPersonnel, listPersonnel, updatePersonnel } = await import("@/lib/personnel");

      const driver = await createPersonnel({ name: `Unique Driver Name ${uniqueSuffix}`, role: "DRIVER" }, adminId);
      if (!driver.ok) throw new Error(driver.message);
      createdPersonnelIds.push(driver.id);

      const byRole = await listPersonnel({ role: "DRIVER" });
      expect(byRole.some((p) => p.id === driver.id)).toBe(true);
      expect(byRole.every((p) => p.role === "DRIVER")).toBe(true);

      const bySearch = await listPersonnel({ search: `Unique Driver Name ${uniqueSuffix}` });
      expect(bySearch.map((p) => p.id)).toEqual([driver.id]);

      await updatePersonnel(driver.id, { status: "INACTIVE" }, adminId);
      const activeOnly = await listPersonnel({ status: "ACTIVE" });
      expect(activeOnly.some((p) => p.id === driver.id)).toBe(false);
      const inactiveOnly = await listPersonnel({ status: "INACTIVE" });
      expect(inactiveOnly.some((p) => p.id === driver.id)).toBe(true);
    });

    it("updatePersonnel records statusChangedById/At only when status actually changes", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { createPersonnel, updatePersonnel } = await import("@/lib/personnel");

      const created = await createPersonnel({ name: `Status Test ${uniqueSuffix}`, role: "DRIVER" }, adminId);
      if (!created.ok) throw new Error(created.message);
      createdPersonnelIds.push(created.id);

      // No-op status (ACTIVE -> ACTIVE, the default) must not stamp statusChangedAt.
      await updatePersonnel(created.id, { status: "ACTIVE", phone: "0771111111" }, adminId);
      const afterNoOp = await prisma.personnel.findUniqueOrThrow({ where: { id: created.id } });
      expect(afterNoOp.statusChangedAt).toBeNull();
      expect(afterNoOp.phone).toBe("0771111111");

      await updatePersonnel(created.id, { status: "INACTIVE" }, adminId);
      const afterChange = await prisma.personnel.findUniqueOrThrow({ where: { id: created.id } });
      expect(afterChange.status).toBe("INACTIVE");
      expect(afterChange.statusChangedById).toBe(adminId);
      expect(afterChange.statusChangedAt).not.toBeNull();
    });

    it("deletePersonnel succeeds when there is no dispatch history, and is refused (409) once there is -- deactivation is suggested instead", async () => {
      if (skipAll) return;
      const { createPersonnel, deletePersonnel } = await import("@/lib/personnel");
      const { prisma } = await import("@/lib/prisma");

      const unreferenced = await createPersonnel({ name: `Deletable ${uniqueSuffix}`, role: "DRIVER" }, adminId);
      if (!unreferenced.ok) throw new Error(unreferenced.message);
      const deleted = await deletePersonnel(unreferenced.id, adminId);
      expect(deleted.ok).toBe(true);
      const goneCheck = await prisma.personnel.findUnique({ where: { id: unreferenced.id } });
      expect(goneCheck).toBeNull();

      const driver = await createPersonnel({ name: `Referenced Driver ${uniqueSuffix}`, role: "DRIVER" }, adminId);
      if (!driver.ok) throw new Error(driver.message);
      createdPersonnelIds.push(driver.id);
      const assistant = await createPersonnel({ name: `Referenced Assistant ${uniqueSuffix}`, role: "DRIVER_ASSISTANT" }, adminId);
      if (!assistant.ok) throw new Error(assistant.message);
      createdPersonnelIds.push(assistant.id);
      const { createVehicle } = await import("@/lib/vehicles");
      const vehicle = await createVehicle({ registrationNumber: `SETTINGS-${uniqueSuffix}` }, adminId);
      if (!vehicle.ok) throw new Error(vehicle.message);
      createdVehicleIds.push(vehicle.id);

      await createDispatchReferencing(driver.id, assistant.id, vehicle.id);

      const refused = await deletePersonnel(driver.id, adminId);
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.status).toBe(409);
        expect(refused.message).toMatch(/dispatch history/i);
        expect(refused.message).toMatch(/deactivate/i);
      }

      // Still present, untouched, after the refused delete.
      const stillThere = await prisma.personnel.findUnique({ where: { id: driver.id } });
      expect(stillThere).not.toBeNull();
    });
  });

  describe("Vehicle", () => {
    it("createVehicle refuses a duplicate registration number", async () => {
      if (skipAll) return;
      const { createVehicle } = await import("@/lib/vehicles");

      const first = await createVehicle({ registrationNumber: `DUP-${uniqueSuffix}` }, adminId);
      expect(first.ok).toBe(true);
      if (first.ok) createdVehicleIds.push(first.id);

      const duplicate = await createVehicle({ registrationNumber: `DUP-${uniqueSuffix}` }, adminId);
      expect(duplicate.ok).toBe(false);
      if (!duplicate.ok) {
        expect(duplicate.status).toBe(409);
        expect(duplicate.fieldErrors?.registrationNumber).toBeDefined();
      }
    });

    it("updateVehicle also refuses renaming into a duplicate registration number", async () => {
      if (skipAll) return;
      const { createVehicle, updateVehicle } = await import("@/lib/vehicles");

      const existing = await createVehicle({ registrationNumber: `EXISTING-${uniqueSuffix}` }, adminId);
      if (!existing.ok) throw new Error(existing.message);
      createdVehicleIds.push(existing.id);

      const other = await createVehicle({ registrationNumber: `OTHER-${uniqueSuffix}` }, adminId);
      if (!other.ok) throw new Error(other.message);
      createdVehicleIds.push(other.id);

      const renameIntoDuplicate = await updateVehicle(other.id, { registrationNumber: `EXISTING-${uniqueSuffix}` }, adminId);
      expect(renameIntoDuplicate.ok).toBe(false);
      if (!renameIntoDuplicate.ok) expect(renameIntoDuplicate.status).toBe(409);
    });

    it("updateVehicle records statusChangedById/At only when status actually changes (surgical TS fix regression: data.statusChangedBy connect, not the raw scalar)", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { createVehicle, updateVehicle } = await import("@/lib/vehicles");

      const created = await createVehicle({ registrationNumber: `STATUS-${uniqueSuffix}` }, adminId);
      if (!created.ok) throw new Error(created.message);
      createdVehicleIds.push(created.id);

      // No-op status (ACTIVE -> ACTIVE, the default) must not stamp statusChangedAt.
      await updateVehicle(created.id, { status: "ACTIVE", notes: "no-op check" }, adminId);
      const afterNoOp = await prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } });
      expect(afterNoOp.statusChangedAt).toBeNull();
      expect(afterNoOp.notes).toBe("no-op check");

      await updateVehicle(created.id, { status: "INACTIVE" }, adminId);
      const afterChange = await prisma.vehicle.findUniqueOrThrow({ where: { id: created.id } });
      expect(afterChange.status).toBe("INACTIVE");
      expect(afterChange.statusChangedById).toBe(adminId);
      expect(afterChange.statusChangedAt).not.toBeNull();
    });

    it("deleteVehicle succeeds when unreferenced, and is refused (409) once a dispatch references it", async () => {
      if (skipAll) return;
      const { createVehicle, deleteVehicle } = await import("@/lib/vehicles");
      const { createPersonnel } = await import("@/lib/personnel");
      const { prisma } = await import("@/lib/prisma");

      const unreferenced = await createVehicle({ registrationNumber: `DELETABLE-${uniqueSuffix}` }, adminId);
      if (!unreferenced.ok) throw new Error(unreferenced.message);
      const deleted = await deleteVehicle(unreferenced.id, adminId);
      expect(deleted.ok).toBe(true);

      const driver = await createPersonnel({ name: `Vehicle Test Driver ${uniqueSuffix}`, role: "DRIVER" }, adminId);
      if (!driver.ok) throw new Error(driver.message);
      createdPersonnelIds.push(driver.id);
      const assistant = await createPersonnel({ name: `Vehicle Test Assistant ${uniqueSuffix}`, role: "DRIVER_ASSISTANT" }, adminId);
      if (!assistant.ok) throw new Error(assistant.message);
      createdPersonnelIds.push(assistant.id);
      const vehicle = await createVehicle({ registrationNumber: `REFERENCED-${uniqueSuffix}` }, adminId);
      if (!vehicle.ok) throw new Error(vehicle.message);
      createdVehicleIds.push(vehicle.id);

      await createDispatchReferencing(driver.id, assistant.id, vehicle.id);

      const refused = await deleteVehicle(vehicle.id, adminId);
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.status).toBe(409);
        expect(refused.message).toMatch(/dispatch history/i);
      }

      const stillThere = await prisma.vehicle.findUnique({ where: { id: vehicle.id } });
      expect(stillThere).not.toBeNull();
    });
  });
});
