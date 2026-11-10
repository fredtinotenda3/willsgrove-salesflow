import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 3 completion (Warehouse Assembly Form & Partial Availability).
 * DB-backed acceptance tests for the Warehouse Assembly Form's data path:
 * getOrderById's new live-SAP-product fields, lib/assembly-form/
 * resolve-line.ts's three-way fallback end to end against real data, and
 * -- the spec's hard requirement -- that reading this data (exactly what
 * app/orders/[id]/assembly-form/page.tsx does, and all it does) can never
 * start picking, create a PickingSession, or change the order's status.
 *
 * OFF BY DEFAULT, for the same one reason as every other
 * *-db.integration.test.ts file in this project: @prisma/client in this
 * sandbox is a stub that THROWS when merely constructed (see
 * docs/milestones/PROGRESS.md's "Sandbox-only blocker"). Every import of
 * lib/prisma.ts or anything that imports it is done with a dynamic
 * `await import(...)` INSIDE the (skippable) test bodies below, never a
 * static top-of-file import.
 *
 * On your machine, where `prisma generate` has actually run against a
 * real schema, set RUN_DB_INTEGRATION_TESTS=1 to include it:
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` at least once first (same
 * precondition as tests/handover-db.integration.test.ts). Every row this
 * test creates is marked isDemo: true and deleted in afterAll.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)(
  "Milestone 3 completion: Warehouse Assembly Form data path (getOrderById + resolveAssemblyFormLine)",
  () => {
    let skipAll = false;

    let adminId: string;
    let customerId: string;
    let productAId: string;
    let productAItemName: string;
    let productASapCode: string;

    const createdOrderIds: string[] = [];
    const uniqueSuffix = `assemblyform-${Date.now()}`;

    beforeAll(async () => {
      const { prisma } = await import("@/lib/prisma");

      const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
      const customer = await prisma.customer.findFirst({
        where: { sapCustomerCode: { startsWith: "DEMO-CUST" } },
        select: { id: true },
      });
      const product = await prisma.product.findFirst({
        where: { isDemo: false, status: "ACTIVE" },
        orderBy: { sapItemCode: "asc" },
        select: { id: true, itemName: true, sapItemCode: true },
      });

      if (!admin || !customer || !product) {
        console.log(
          "Skipping Warehouse Assembly Form DB integration test: need an admin user, a DEMO-CUST-* customer, " +
            "and at least one active product. Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
        );
        skipAll = true;
        return;
      }

      adminId = admin.id;
      customerId = customer.id;
      productAId = product.id;
      productAItemName = product.itemName;
      productASapCode = product.sapItemCode;
    });

    afterAll(async () => {
      const { prisma } = await import("@/lib/prisma");
      try {
        for (const orderId of createdOrderIds) {
          await prisma.pickingSession.deleteMany({ where: { orderId } });
          await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
          await prisma.orderLine.deleteMany({ where: { orderId } });
          await prisma.auditEvent.deleteMany({ where: { entityType: "CustomerOrder", entityId: orderId } });
        }
        for (const orderId of createdOrderIds) {
          await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => undefined);
        }
      } finally {
        await prisma.$disconnect();
      }
    });

    async function createThreeLineOrder() {
      const { prisma } = await import("@/lib/prisma");
      const { generateOrderReference } = await import("@/lib/orders");

      const order = await prisma.customerOrder.create({
        data: {
          reference: generateOrderReference(),
          customerId,
          createdById: adminId,
          customerPoReference: `PO-${uniqueSuffix}`,
          source: "MANUAL",
          status: "RECEIVED",
          orderDate: new Date("2026-11-01T00:00:00.000Z"),
          currency: "USD",
          receivedAt: new Date(),
          isDemo: true,
          lines: {
            create: [
              {
                lineNumber: 1,
                originalProductDescription: `Live match ${uniqueSuffix}`,
                productId: productAId,
                requestedQuantity: "10.0000",
                requestedUnitCode: "EA",
                isDemo: true,
              },
              {
                lineNumber: 2,
                originalProductDescription: `Snapshot-only match ${uniqueSuffix}`,
                productId: null,
                sapItemCodeSnapshot: `SNAP-${uniqueSuffix}`,
                requestedQuantity: "5.0000",
                requestedUnitCode: "KG",
                isDemo: true,
              },
              {
                lineNumber: 3,
                originalProductDescription: `No match at all ${uniqueSuffix}`,
                productId: null,
                sapItemCodeSnapshot: null,
                requestedQuantity: "1.0000",
                requestedUnitCode: "BOX",
                isDemo: true,
              },
            ],
          },
        },
        select: { id: true },
      });
      createdOrderIds.push(order.id);
      return order.id;
    }

    it("getOrderById returns the live SAP fields, and resolveAssemblyFormLine applies the same three-way fallback the handover uses", async () => {
      if (skipAll) return;
      const { getOrderById } = await import("@/lib/order-queries");
      const { resolveAssemblyFormLine } = await import("@/lib/assembly-form/resolve-line");

      const orderId = await createThreeLineOrder();
      const order = await getOrderById(orderId);
      expect(order).not.toBeNull();
      if (!order) return;

      const [liveMatch, snapshotOnly, noMatch] = order.lines;

      expect(liveMatch!.productSapItemCode).toBe(productASapCode);
      expect(liveMatch!.officialProductDescription).toBe(productAItemName);

      expect(snapshotOnly!.productSapItemCode).toBeNull();
      expect(snapshotOnly!.officialProductDescription).toBeNull();
      expect(snapshotOnly!.sapItemCodeSnapshot).toBe(`SNAP-${uniqueSuffix}`);

      expect(noMatch!.productSapItemCode).toBeNull();
      expect(noMatch!.sapItemCodeSnapshot).toBeNull();

      const resolved = order.lines.map((line) => resolveAssemblyFormLine(line));

      expect(resolved[0]).toMatchObject({ sapItemCode: productASapCode, description: productAItemName });
      expect(resolved[1]).toMatchObject({ sapItemCode: `SNAP-${uniqueSuffix}`, description: `Snapshot-only match ${uniqueSuffix}` });
      expect(resolved[2]).toMatchObject({ sapItemCode: null, description: `No match at all ${uniqueSuffix}` });

      // Requested quantities and units are carried through untouched --
      // the form must show exactly what the customer ordered.
      expect(resolved[0]!.requestedQuantity).toBe("10.0000");
      expect(resolved[1]!.requestedQuantity).toBe("5.0000");
      expect(resolved[1]!.requestedUnitCode).toBe("KG");
    });

    it("reading the assembly-form data (getOrderById, called repeatedly) never creates a PickingSession or changes the order's status", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { getOrderById } = await import("@/lib/order-queries");

      const orderId = await createThreeLineOrder();

      const sessionCountBefore = await prisma.pickingSession.count({ where: { orderId } });
      const statusBefore = (await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status;
      expect(sessionCountBefore).toBe(0);
      expect(statusBefore).toBe("RECEIVED");

      // Simulate the assembly-form page being opened (and reprinted) a
      // few times -- the exact same read app/orders/[id]/assembly-form/
      // page.tsx performs, and nothing else.
      await getOrderById(orderId);
      await getOrderById(orderId);
      await getOrderById(orderId);

      const sessionCountAfter = await prisma.pickingSession.count({ where: { orderId } });
      const statusAfter = (await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId }, select: { status: true } })).status;

      expect(sessionCountAfter).toBe(0);
      expect(statusAfter).toBe("RECEIVED");
    });
  }
);
