import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";

/**
 * Milestone 9 (SAP Business One Integration). Real-database integration
 * tests for the order-eligibility -> outbox -> reconciliation/resolution
 * flow (lib/integrations/sap/order-eligibility.ts and order-outbox.ts),
 * run against the mock adapter (SAP_B1_PROVIDER is not set to "live" in
 * any test environment, so lib/integrations/sap/get-adapter.ts always
 * resolves to MockSapAdapter here -- see lib/integrations/sap/config.ts's
 * fail-safe-to-mock default).
 *
 * OFF BY DEFAULT, same reason and same convention as tests/orders-
 * db.integration.test.ts: needs a real database connection and a real
 * generated @prisma/client, neither of which this sandbox has ever had.
 * Every import of lib/prisma.ts, or of anything that imports it
 * (lib/integrations/sap/{order-eligibility,order-outbox,get-adapter,
 * connection,sync-job}.ts all do), is therefore a dynamic
 * `await import(...)` INSIDE each (skippable) hook/test body below, never
 * a static top-of-file import -- a static import would construct the
 * stub @prisma/client and crash `npm test` here even when this suite is
 * skipped, since Vitest still evaluates a test file's top-level imports
 * before deciding what to skip.
 *
 * On a machine where `prisma generate` has actually run against a real
 * schema:
 *
 *   RUN_DB_INTEGRATION_TESTS=1 npm test
 *
 * Precondition: run `npm run db:seed` at least once first, so an admin
 * user exists (looked up, never created by this file). This test creates
 * its own demo Customer/Product/Quotation/CustomerOrder/OrderLine rows
 * (all isDemo: true), reusing a pre-existing Customer/Product with the
 * mock adapter's own fixture codes (CUS-0001/ITM-0001) if one is already
 * present rather than risking a duplicate-unique-code conflict, and
 * deletes everything it created itself in `afterAll`.
 */
const RUN_DB_INTEGRATION_TESTS = Boolean(process.env.DATABASE_URL) && process.env.RUN_DB_INTEGRATION_TESTS === "1";

describe.skipIf(!RUN_DB_INTEGRATION_TESTS)("SAP order eligibility + outbox against a real database (mock adapter)", () => {
  let skipAll = false;
  let adminId = "";
  let customerId = "";
  let createdCustomer = false;
  let productId = "";
  let createdProduct = false;

  async function makeQuotationConvertedOrder(opts: { customerUnitPrice: string; quantity?: string; referenceSuffix?: string }) {
    const { prisma } = await import("@/lib/prisma");
    const reference = `SAP-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}${opts.referenceSuffix ?? ""}`;

    const order = await prisma.customerOrder.create({
      data: {
        reference,
        customerId,
        createdById: adminId,
        source: "QUOTATION",
        status: "CONFIRMED",
        currency: "USD",
        orderDate: new Date("2026-11-11"),
        isDemo: true,
        lines: {
          create: [
            {
              lineNumber: 1,
              originalProductDescription: "Maize Meal 10kg",
              productId,
              requestedQuantity: opts.quantity ?? "10",
              requestedUnitCode: "EA",
              customerUnitPrice: opts.customerUnitPrice,
              isDemo: true,
            },
          ],
        },
      },
    });

    const quotation = await prisma.quotation.create({
      data: {
        quotationNumber: `QUO-SAP-TEST-${Date.now()}`,
        customerId,
        quotationDate: new Date("2026-11-01"),
        validUntil: new Date("2026-12-01"),
        preparedById: adminId,
        salespersonId: adminId,
        status: "ACCEPTED",
        convertedOrderId: order.id,
        convertedAt: new Date(),
        convertedById: adminId,
        isDemo: true,
      },
    });

    return { orderId: order.id, quotationId: quotation.id };
  }

  async function deleteOrder(orderId: string, quotationId?: string) {
    const { prisma } = await import("@/lib/prisma");
    if (quotationId) await prisma.quotation.delete({ where: { id: quotationId } }).catch(() => {});
    await prisma.integrationOperation.deleteMany({ where: { customerOrderId: orderId } });
    await prisma.orderLine.deleteMany({ where: { orderId } });
    await prisma.customerOrder.delete({ where: { id: orderId } }).catch(() => {});
  }

  beforeAll(async () => {
    const { prisma } = await import("@/lib/prisma");
    const { resetMockSapAdapterState } = await import("@/lib/integrations/sap/mock-adapter");
    resetMockSapAdapterState();

    const admin = await prisma.user.findFirst({ where: { role: "ADMINISTRATOR" }, select: { id: true } });
    if (!admin) {
      console.log("Skipping SAP outbox DB integration tests: no ADMINISTRATOR user found. Run `npm run db:seed` first.");
      skipAll = true;
      return;
    }
    adminId = admin.id;

    const existingCustomer = await prisma.customer.findUnique({ where: { sapCustomerCode: "CUS-0001" }, select: { id: true } });
    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const customer = await prisma.customer.create({
        data: { name: "TM Supermarkets - Chinhoyi North (SAP test)", sapCustomerCode: "CUS-0001", isDemo: true },
      });
      customerId = customer.id;
      createdCustomer = true;
    }

    const existingProduct = await prisma.product.findUnique({ where: { sapItemCode: "ITM-0001" }, select: { id: true } });
    if (existingProduct) {
      productId = existingProduct.id;
    } else {
      const product = await prisma.product.create({ data: { sapItemCode: "ITM-0001", itemName: "Maize Meal 10kg", isDemo: true } });
      productId = product.id;
      createdProduct = true;
    }
  });

  afterAll(async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    try {
      if (createdProduct) await prisma.product.delete({ where: { id: productId } }).catch(() => {});
      if (createdCustomer) await prisma.customer.delete({ where: { id: customerId } }).catch(() => {});
    } finally {
      await prisma.$disconnect();
    }
  });

  beforeEach(async () => {
    const { resetMockSapAdapterState } = await import("@/lib/integrations/sap/mock-adapter");
    resetMockSapAdapterState();
  });

  it("checkOrderEligibility blocks a non-quotation order with NOT_FROM_QUOTATION", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { checkOrderEligibility } = await import("@/lib/integrations/sap/order-eligibility");

    const order = await prisma.customerOrder.create({
      data: {
        reference: `SAP-TEST-MANUAL-${Date.now()}`,
        customerId,
        createdById: adminId,
        source: "MANUAL",
        status: "CONFIRMED",
        isDemo: true,
        lines: {
          create: [{ lineNumber: 1, originalProductDescription: "Untracked line", requestedQuantity: "1", requestedUnitCode: "EA", isDemo: true }],
        },
      },
    });

    try {
      const result = await checkOrderEligibility(order.id);
      expect(result.eligible).toBe(false);
      expect(result.blockers.map((b) => b.code)).toContain("NOT_FROM_QUOTATION");
    } finally {
      await deleteOrder(order.id);
    }
  });

  it("checkOrderEligibility returns eligible: true with a correctly-shaped submission for a quotation-converted order with a mapped customer/product/price", async () => {
    if (skipAll) return;
    const { checkOrderEligibility } = await import("@/lib/integrations/sap/order-eligibility");
    const { buildSapSalesOrderIdempotencyKey } = await import("@/lib/integrations/sap/idempotency");

    const { orderId, quotationId } = await makeQuotationConvertedOrder({ customerUnitPrice: "5.0000" });
    try {
      const result = await checkOrderEligibility(orderId);
      expect(result.eligible).toBe(true);
      expect(result.blockers).toEqual([]);
      expect(result.submission?.idempotencyKey).toBe(buildSapSalesOrderIdempotencyKey(orderId));
      expect(result.submission?.sapCustomerCode).toBe("CUS-0001");
      expect(result.submission?.lines[0]?.sapItemCode).toBe("ITM-0001");
      expect(result.submission?.lines[0]?.unitPrice).toBe("5.0000");
    } finally {
      await deleteOrder(orderId, quotationId);
    }
  });

  it("submitOrderToSap succeeds end-to-end and is idempotent on resubmission (no second IntegrationOperation row)", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { submitOrderToSap } = await import("@/lib/integrations/sap/order-outbox");

    const { orderId, quotationId } = await makeQuotationConvertedOrder({ customerUnitPrice: "5.0000" });
    try {
      const first = await submitOrderToSap(orderId);
      expect(first.ok).toBe(true);
      if (!first.ok) throw new Error("unreachable");
      expect(first.status).toBe("SUCCEEDED");

      const second = await submitOrderToSap(orderId);
      expect(second.ok).toBe(true);
      if (!second.ok) throw new Error("unreachable");
      // Same operation row -- createOrFindOutboxRow found the existing one
      // via the customerOrderId unique constraint rather than creating a
      // second submission.
      expect(second.operationId).toBe(first.operationId);

      const operations = await prisma.integrationOperation.findMany({ where: { customerOrderId: orderId } });
      expect(operations).toHaveLength(1);
      expect(operations[0]?.status).toBe("SUCCEEDED");
    } finally {
      await deleteOrder(orderId, quotationId);
    }
  });

  it("a TIMEOUT (lost response) resolves to UNCERTAIN, and reconciliation then finds the order and resolves it to SUCCEEDED (spec 7.2's critical scenario)", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { submitOrderToSap, reconcileUncertainOperation } = await import("@/lib/integrations/sap/order-outbox");

    const { orderId, quotationId } = await makeQuotationConvertedOrder({
      customerUnitPrice: "5.0000",
      referenceSuffix: "__SIMULATE_TIMEOUT__",
    });
    try {
      const submitResult = await submitOrderToSap(orderId);
      expect(submitResult.ok).toBe(true);
      if (!submitResult.ok) throw new Error("unreachable");
      expect(submitResult.status).toBe("UNCERTAIN");

      const uncertain = await prisma.integrationOperation.findUnique({ where: { customerOrderId: orderId } });
      expect(uncertain?.status).toBe("UNCERTAIN");
      expect(uncertain?.lastErrorCategory).toBe("TIMEOUT");

      const reconciliation = await reconcileUncertainOperation(submitResult.operationId);
      expect(reconciliation.outcome).toBe("FOUND");

      const resolved = await prisma.integrationOperation.findUnique({ where: { customerOrderId: orderId } });
      expect(resolved?.status).toBe("SUCCEEDED");
      expect(resolved?.externalDocEntry).toBeTruthy();
    } finally {
      await deleteOrder(orderId, quotationId);
    }
  });

  it("an UNCERTAIN submission that reconciliation cannot find requires a human decision via resolveUncertainOperation, and is never auto-resubmitted", async () => {
    if (skipAll) return;
    const { prisma } = await import("@/lib/prisma");
    const { submitOrderToSap, reconcileUncertainOperation, resolveUncertainOperation } = await import("@/lib/integrations/sap/order-outbox");

    const { orderId, quotationId } = await makeQuotationConvertedOrder({
      customerUnitPrice: "5.0000",
      referenceSuffix: "__SIMULATE_UNCERTAIN_LOST__",
    });
    try {
      const submitResult = await submitOrderToSap(orderId);
      expect(submitResult.ok).toBe(true);
      if (!submitResult.ok) throw new Error("unreachable");
      expect(submitResult.status).toBe("UNCERTAIN");

      const reconciliation = await reconcileUncertainOperation(submitResult.operationId);
      expect(reconciliation.outcome).toBe("NOT_FOUND");

      const stillUncertain = await prisma.integrationOperation.findUnique({ where: { customerOrderId: orderId } });
      expect(stillUncertain?.status).toBe("UNCERTAIN");

      await resolveUncertainOperation(submitResult.operationId, adminId, {
        confirmedCreated: false,
        notes: "Verified directly in SAP Business One: no matching sales order exists.",
      });

      const resolved = await prisma.integrationOperation.findUnique({ where: { customerOrderId: orderId } });
      expect(resolved?.status).toBe("FAILED");

      const auditEvent = await prisma.auditEvent.findFirst({
        where: { entityType: "IntegrationOperation", entityId: submitResult.operationId, action: "SAP_UNCERTAIN_SUBMISSION_RESOLVED" },
      });
      expect(auditEvent).not.toBeNull();
    } finally {
      await deleteOrder(orderId, quotationId);
    }
  });
});
