import { randomBytes } from "node:crypto";
import { Prisma, OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreateOrderInput } from "@/lib/order-validation";
import { getOrderById } from "@/lib/order-queries";

export type MutationFailure = {
  ok: false;
  status: number;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type CreateOrderResult =
  | { ok: true; id: string; idempotentReplay: boolean }
  | MutationFailure;

const TRANSACTION_OPTIONS = { maxWait: 15000, timeout: 15000 };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function generateOrderReference(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `ORD-${datePart}-${randomPart}`;
}

/**
 * Creates a new customer order (the "order intake" step).
 *
 * Deliberately does NOT compute subtotal/taxTotal/total/lineTotal from the
 * customer-submitted prices: those fields represent Willsgrove's APPROVED
 * amounts, set later by the price-decision/approval workflow (a later
 * milestone -- see PROGRESS.md). Auto-filling them from customerUnitPrice
 * would silently let a customer's claimed price become the approved price,
 * which is exactly the rule the product spec calls out as never allowed.
 *
 * Idempotency: if idempotencyKey is provided and an order with that key
 * already exists, that existing order's id is returned instead of creating
 * a duplicate (idempotentReplay: true) -- safe for a client to retry a
 * submission after a dropped response.
 */
export async function createOrder(
  input: CreateOrderInput,
  createdById: string,
  // Same rationale as lib/customers.ts createCustomer: isDemo is not part
  // of CreateOrderInput, so it can never arrive via the public
  // /api/orders route body -- only prisma/seed.ts passes { isDemo: true }.
  options?: { isDemo?: boolean }
): Promise<CreateOrderResult> {
  const isDemo = options?.isDemo ?? false;
  if (input.idempotencyKey) {
    const existing = await prisma.customerOrder.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, id: existing.id, idempotentReplay: true };
    }
  }

  const customer = await prisma.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true },
  });
  if (!customer) {
    return { ok: false, status: 404, message: "Customer not found." };
  }

  if (input.customerLocationId) {
    const location = await prisma.customerLocation.findFirst({
      where: { id: input.customerLocationId, customerId: input.customerId },
      select: { id: true },
    });
    if (!location) {
      return {
        ok: false,
        status: 400,
        message: "The selected location does not belong to this customer.",
        fieldErrors: { customerLocationId: "Location does not belong to this customer." },
      };
    }
  }

  // Best-effort link to known SAP products -- validated here rather than
  // trusted blindly from the client, since a wrong productId would attach
  // the order line to the wrong SAP item.
  const productIds = [...new Set(input.lines.map((line) => line.productId).filter((id): id is string => Boolean(id)))];
  if (productIds.length > 0) {
    const foundProducts = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true },
    });
    const foundIds = new Set(foundProducts.map((p) => p.id));
    const missing = productIds.filter((id) => !foundIds.has(id));
    if (missing.length > 0) {
      return {
        ok: false,
        status: 400,
        message: `One or more referenced products do not exist: ${missing.join(", ")}`,
      };
    }
  }

  const now = new Date();
  const MAX_REFERENCE_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
    const reference = generateOrderReference();

    try {
      const order = await prisma.$transaction(async (tx) => {
        const created = await tx.customerOrder.create({
          data: {
            reference,
            customerId: input.customerId,
            customerLocationId: input.customerLocationId ?? null,
            createdById,
            customerPoReference: input.customerPoReference ?? null,
            source: input.source,
            status: OrderStatus.RECEIVED,
            orderDate: input.orderDate ?? null,
            requestedDeliveryDate: input.requestedDeliveryDate ?? null,
            deliveryAddress: input.deliveryAddress ?? null,
            currency: input.currency ?? "USD",
            internalNotes: input.internalNotes ?? null,
            idempotencyKey: input.idempotencyKey ?? null,
            receivedAt: now,
            isDemo,
            lines: {
              create: input.lines.map((line, index) => ({
                lineNumber: index + 1,
                originalProductDescription: line.originalProductDescription,
                productId: line.productId ?? null,
                sapItemCodeSnapshot: line.sapItemCodeSnapshot ?? null,
                requestedQuantity: new Prisma.Decimal(line.requestedQuantity),
                requestedUnitCode: line.requestedUnitCode,
                customerUnitPrice:
                  line.customerUnitPrice != null ? new Prisma.Decimal(line.customerUnitPrice) : null,
                salesNotes: line.salesNotes ?? null,
                isDemo,
              })),
            },
          },
          select: { id: true },
        });

        await tx.orderStatusHistory.create({
          data: {
            orderId: created.id,
            changedById: createdById,
            fromStatus: null,
            toStatus: OrderStatus.RECEIVED,
            notes: "Order received.",
          },
        });

        await tx.auditEvent.create({
          data: {
            actorId: createdById,
            action: "ORDER_CREATE",
            entityType: "CustomerOrder",
            entityId: created.id,
            afterData: {
              reference,
              customerId: input.customerId,
              source: input.source,
              lineCount: input.lines.length,
              idempotencyKey: input.idempotencyKey ?? null,
            },
          },
        });

        return created;
      }, TRANSACTION_OPTIONS);

      return { ok: true, id: order.id, idempotentReplay: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const target = (error as Prisma.PrismaClientKnownRequestError).meta?.target;
        const targetsIdempotencyKey =
          Array.isArray(target) && target.includes("idempotencyKey");

        if (targetsIdempotencyKey && input.idempotencyKey) {
          // Lost a race with a concurrent identical retry -- return the
          // row the other request just created rather than erroring.
          const raceWinner = await prisma.customerOrder.findUnique({
            where: { idempotencyKey: input.idempotencyKey },
            select: { id: true },
          });
          if (raceWinner) {
            return { ok: true, id: raceWinner.id, idempotentReplay: true };
          }
        }

        // Otherwise this was a reference collision (astronomically
        // unlikely given the random component) -- retry with a new one.
        continue;
      }

      throw error;
    }
  }

  return {
    ok: false,
    status: 500,
    message: "Could not generate a unique order reference. Please try again.",
  };
}

export async function createOrderAndReturn(input: CreateOrderInput, createdById: string) {
  const result = await createOrder(input, createdById);
  if (!result.ok) return result;

  const order = await getOrderById(result.id);
  return { ok: true as const, order, idempotentReplay: result.idempotentReplay };
}
