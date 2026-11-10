import { describe, it, expect, beforeAll, afterAll } from "vitest";

/**
 * Milestone 3D (SAP Invoice Handover Specification, final stage: tests,
 * docs, verification). DB-backed acceptance tests for
 * lib/picking/queries.ts's three read-only functions --
 * `listPickingQueue` (added in Milestone 3B, for the `/fulfilment` queue
 * list), and `getLatestPickingSessionForOrder`/`getPickingSessionDetail`
 * (added in Milestone 3A, used by the picking API's GET routes) -- none
 * of which had any dedicated test coverage through 3A/3B. Closing exactly
 * that gap is 3D's own stated charter ("full test coverage for 3A-3C");
 * until now these three functions were exercised only by hand, through
 * the `/fulfilment` UI or SETUP-WINDOWS.md's manual walkthroughs.
 *
 * OFF BY DEFAULT, for the exact same reason as every other
 * *-db.integration.test.ts in this project: @prisma/client in this
 * sandbox is a stub that THROWS when merely constructed (see
 * docs/milestones/PROGRESS.md's "Sandbox-only blocker"). Every lib
 * touched here is imported with a dynamic `await import(...)` INSIDE the
 * (skippable) test bodies below, never a static top-of-file import.
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` at least once first (an admin user
 * and at least one DEMO-CUST-* customer must already exist). Every row
 * this test creates is marked isDemo: true.
 */
const RUN_DB_INTEGRATION_TESTS =
  Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("Milestone 3D: lib/picking/queries.ts", () => {
  let skipAll = false;
  let adminId: string;
  let customerId: string;

  const createdOrderIds: string[] = [];
  const uniqueSuffix = `inttest-${Date.now()}`;

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    const customer = await prisma.customer.findFirst({
      where: { sapCustomerCode: { startsWith: "DEMO-CUST" } },
      select: { id: true },
    });

    if (!admin || !customer) {
      console.log(
        "Skipping Milestone 3D picking-queries DB integration test: need an admin user and a DEMO-CUST-* customer. " +
          "Run `npm run db:seed` first, then re-run with RUN_DB_INTEGRATION_TESTS=1."
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
        // PickingLine rows cascade-delete with their PickingSession;
        // PickingSession.order is onDelete: Restrict, so it must go
        // before the order itself can.
        await prisma.pickingSession.deleteMany({ where: { orderId } });
        await prisma.orderStatusHistory.deleteMany({ where: { orderId } });
        await prisma.auditEvent.deleteMany({ where: { entityType: { in: ["CustomerOrder", "PickingSession", "PickingLine"] } } });
        await prisma.orderLine.deleteMany({ where: { orderId } });
      }
      for (const orderId of createdOrderIds) {
        await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => undefined);
      }
    } finally {
      await prisma.$disconnect();
    }
  });

  async function createOrder(status: string, lineCount = 1) {
    const { prisma } = await import("@/lib/prisma");
    const { generateOrderReference } = await import("@/lib/orders");

    const order = await prisma.customerOrder.create({
      data: {
        reference: generateOrderReference(),
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status,
        currency: "USD",
        receivedAt: new Date(),
        isDemo: true,
        lines: {
          create: Array.from({ length: lineCount }, (_, i) => ({
            lineNumber: i + 1,
            originalProductDescription: `Query test line ${i + 1} ${uniqueSuffix}`,
            requestedQuantity: "1.0000",
            requestedUnitCode: "EA",
            isDemo: true,
          })),
        },
      },
      select: { id: true },
    });
    createdOrderIds.push(order.id);
    return order.id;
  }

  describe("listPickingQueue", () => {
    it("includes every live order not yet handed to SAP, and excludes DRAFT/CANCELLED/REJECTED and anything already handed to SAP", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { listPickingQueue } = await import("@/lib/picking/queries");

      const received = await createOrder("RECEIVED");
      const picking = await createOrder("PICKING");
      const readyToInvoice = await createOrder("READY_TO_INVOICE");
      const draft = await createOrder("DRAFT");
      const cancelled = await createOrder("CANCELLED");
      const rejected = await createOrder("REJECTED");
      const alreadyHanded = await createOrder("READY_TO_INVOICE");
      await prisma.customerOrder.update({ where: { id: alreadyHanded }, data: { handedToSapAt: new Date() } });

      const { orders } = await listPickingQueue({ page: 1, pageSize: 100, includeDemo: true });
      const ids = orders.map((o) => o.id);

      expect(ids).toContain(received);
      expect(ids).toContain(picking);
      expect(ids).toContain(readyToInvoice);
      expect(ids).not.toContain(draft);
      expect(ids).not.toContain(cancelled);
      expect(ids).not.toContain(rejected);
      // Once handed to SAP, an order's picking relevance is over --
      // whatever OrderStatus it happens to be sitting at.
      expect(ids).not.toContain(alreadyHanded);
    });

    it("excludes demo orders unless includeDemo is set, and paginates correctly", async () => {
      if (skipAll) return;
      const { listPickingQueue } = await import("@/lib/picking/queries");

      const orderId = await createOrder("RECEIVED");

      const excludingDemo = await listPickingQueue({ page: 1, pageSize: 100 });
      expect(excludingDemo.orders.map((o) => o.id)).not.toContain(orderId);

      const includingDemo = await listPickingQueue({ page: 1, pageSize: 100, includeDemo: true });
      expect(includingDemo.orders.map((o) => o.id)).toContain(orderId);
      const totalWithDemo = includingDemo.pagination.totalItems;
      expect(totalWithDemo).toBeGreaterThan(0);

      const onePerPage = await listPickingQueue({ page: 1, pageSize: 1, includeDemo: true });
      expect(onePerPage.orders).toHaveLength(1);
      expect(onePerPage.pagination.totalItems).toBe(totalWithDemo);
      expect(onePerPage.pagination.totalPages).toBe(Math.ceil(totalWithDemo / 1));
    });
  });

  describe("getLatestPickingSessionForOrder / getPickingSessionDetail", () => {
    it("returns null before any session exists, the most recent session once more than one does, and null for an unknown session id", async () => {
      if (skipAll) return;
      const { prisma } = await import("@/lib/prisma");
      const { getLatestPickingSessionForOrder, getPickingSessionDetail } = await import("@/lib/picking/queries");
      const { startPickingSession } = await import("@/lib/picking/start-picking");
      const { recordPickedLine } = await import("@/lib/picking/record-picked-line");
      const { completePickingSession } = await import("@/lib/picking/complete-picking");
      const { authorizePickingSession } = await import("@/lib/picking/authorize-picking");

      const orderId = await createOrder("RECEIVED", 1);
      expect(await getLatestPickingSessionForOrder(orderId)).toBeNull();

      const orderLine = await prisma.orderLine.findFirstOrThrow({ where: { orderId }, select: { id: true } });

      const first = await startPickingSession(orderId, adminId);
      if (!first.ok) throw new Error(first.message);
      const recorded = await recordPickedLine(first.session.id, orderLine.id, "1.0000", "0.0000", undefined, adminId);
      if (!recorded.ok) throw new Error(recorded.message);
      const completed = await completePickingSession(first.session.id, adminId);
      if (!completed.ok) throw new Error(completed.message);
      const authorized = await authorizePickingSession(first.session.id, adminId);
      if (!authorized.ok) throw new Error(authorized.message);

      // A re-pick: a second, newer session for the same order.
      const second = await startPickingSession(orderId, adminId);
      if (!second.ok) throw new Error(second.message);

      const latest = await getLatestPickingSessionForOrder(orderId);
      expect(latest).not.toBeNull();
      expect(latest!.id).toBe(second.session.id);
      expect(latest!.status).toBe("IN_PROGRESS");

      const firstDetail = await getPickingSessionDetail(first.session.id);
      expect(firstDetail).not.toBeNull();
      expect(firstDetail!.status).toBe("AUTHORIZED");
      expect(firstDetail!.lines).toHaveLength(1);
      expect(firstDetail!.lines[0]!.foundQuantity).toBe("1.0000");

      expect(await getPickingSessionDetail("this-session-id-does-not-exist")).toBeNull();
    });
  });
});
