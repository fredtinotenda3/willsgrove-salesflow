import { randomBytes } from "node:crypto";
import { Prisma, OrderStatus } from "@prisma/client";
import type { OrderSource } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { CreateOrderInput } from "@/lib/order-validation";
import { getOrderById } from "@/lib/order-queries";
import { dateOnlyStringToUtcDate } from "@/lib/dates";

export type MutationFailure = {
  ok: false;
  status: number;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type CreateOrderResult =
  | { ok: true; id: string; idempotentReplay: boolean }
  | MutationFailure;

// Milestone 2B. The same shape as CreateOrderInput, except `source` is the
// FULL OrderSource enum rather than lib/order-validation.ts's deliberately
// narrowed EMAIL/WHATSAPP/MANUAL tuple. createOrderCore (below) is called
// from two places: this file's own createOrder() (HTTP-facing, always a
// CreateOrderInput -- a narrower type than this one, so it's always
// assignable here with no cast) and lib/review/confirm-review.ts (which
// creates an order from a reviewed intake document and legitimately needs
// source values like "EXCEL"/"PDF" that manual entry must never accept --
// see lib/order-validation.ts's comment on why that restriction exists).
// Milestone 11 (Operational BI). salespersonId is optional here (not on
// the base CreateOrderInput / createOrderSchema) deliberately -- no
// order-creation UI changes this round. createOrderCore below defaults
// it to createdById when omitted, which is every HTTP-facing creation
// path (manual entry, PO-intake review) today. The one caller that
// supplies a real value is lib/quotations/convert-to-order.ts, which
// passes the source quotation's own salespersonId so pipeline continuity
// survives the quotation-to-order conversion. See CustomerOrder.
// salespersonId's own schema comment for the full rationale.
export type OrderCreationInput = Omit<CreateOrderInput, "source"> & { source: OrderSource; salespersonId?: string | null };

export type OrderCreationCoreResult = {
  id: string;
  lines: { id: string; lineNumber: number }[];
};

// Exported (not just module-local) so lib/review/confirm-review.ts's own
// transaction/retry loop uses the exact same timeout budget and collision
// handling as this file's, rather than silently drifting from it.
export const TRANSACTION_OPTIONS = { maxWait: 15000, timeout: 15000 };

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export function generateOrderReference(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `ORD-${datePart}-${randomPart}`;
}

/**
 * Milestone 2B. The actual CustomerOrder+OrderLine+OrderStatusHistory+
 * AuditEvent creation, extracted out of createOrder()'s transaction
 * callback so lib/review/confirm-review.ts can run the exact same logic
 * inside ITS OWN transaction (which also, atomically, links the
 * originating OrderDocument and records which ExtractedOrderLine became
 * which OrderLine -- see that file) without duplicating this ~30 lines a
 * second time, and without the two separate prisma.$transaction calls
 * that would otherwise be needed not actually nesting (Prisma's
 * interactive transactions don't support that).
 *
 * Takes an already-generated `reference` (the caller owns the
 * reference-collision retry loop -- see createOrder below) and the
 * caller's own `tx`, so this function itself never opens a transaction
 * and is safe to call from inside any already-open one.
 *
 * Deliberately does NOT re-validate `input` with a zod schema: exactly
 * like createOrder() today, that is the caller's responsibility (the
 * HTTP route validates with createOrderSchema; lib/review/confirm-review.ts
 * validates its own request shape with its own schema and constructs this
 * value directly from already-validated/known-good data -- see that
 * file's module comment for why re-running createOrderSchema itself would
 * be the wrong fit there, not an oversight).
 */
export async function createOrderCore(
  tx: Prisma.TransactionClient,
  reference: string,
  input: OrderCreationInput,
  createdById: string,
  isDemo: boolean
): Promise<OrderCreationCoreResult> {
  const now = new Date();

  const created = await tx.customerOrder.create({
    data: {
      reference,
      customerId: input.customerId,
      customerLocationId: input.customerLocationId ?? null,
      createdById,
      // Milestone 11. Defaults to the creator when the caller doesn't
      // supply a real assigned salesperson -- see OrderCreationInput's
      // own comment above.
      salespersonId: input.salespersonId ?? createdById,
      customerPoReference: input.customerPoReference ?? null,
      source: input.source,
      status: OrderStatus.RECEIVED,
      // Milestone 0 fix (round 5): see lib/dates.ts -- Prisma's @db.Date
      // columns need a Date object or a full ISO-8601 datetime string,
      // never a bare "YYYY-MM-DD" string.
      orderDate: dateOnlyStringToUtcDate(input.orderDate),
      requestedDeliveryDate: dateOnlyStringToUtcDate(input.requestedDeliveryDate),
      deliveryAddress: input.deliveryAddress ?? null,
      currency: input.currency ?? "USD",
      originalSourceText: input.originalSourceText ?? null,
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
    select: { id: true, lines: { select: { id: true, lineNumber: true } } },
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
        hasOriginalSourceText: Boolean(input.originalSourceText),
        idempotencyKey: input.idempotencyKey ?? null,
        salespersonId: input.salespersonId ?? createdById,
      },
    },
  });

  return created;
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

  const MAX_REFERENCE_ATTEMPTS = 5;

  for (let attempt = 0; attempt < MAX_REFERENCE_ATTEMPTS; attempt++) {
    const reference = generateOrderReference();

    try {
      const order = await prisma.$transaction(
        (tx) => createOrderCore(tx, reference, input, createdById, isDemo),
        TRANSACTION_OPTIONS
      );

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
