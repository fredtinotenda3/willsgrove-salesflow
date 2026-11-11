import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { createOrderCore, generateOrderReference, isUniqueViolation, TRANSACTION_OPTIONS, type OrderCreationInput } from "@/lib/orders";
import { utcDateToDateOnlyString } from "@/lib/dates";
import { isConvertibleStatus } from "@/lib/quotations/validation";
import type { ConvertQuotationToOrderInput } from "@/lib/quotations/validation";
import type { MutationFailure } from "@/lib/quotations/create";

/**
 * Milestone 7 (spec section 8): converting an ACCEPTED quotation into a
 * real CustomerOrder. Reuses lib/orders.ts's own createOrderCore
 * directly (the identical nested-create+OrderStatusHistory+AuditEvent
 * logic every other order in this system goes through) rather than
 * duplicating it -- "identify reusable services" (spec section 1.5).
 *
 * "Avoid duplicate orders" / "do not overwrite an existing customer PO"
 * (spec section 8) is enforced TWICE, deliberately redundant:
 *   1. An application-level pre-check on Quotation.convertedOrderId
 *      before doing any work (fast path, catches the common case).
 *   2. A deterministic idempotencyKey ("QUO-CONVERT-<quotationId>") on
 *      the created CustomerOrder, the same column/mechanism
 *      lib/orders.ts's own createOrder() already uses for safe client
 *      retries -- its UNIQUE constraint is what actually makes a
 *      genuine race between two concurrent conversion requests
 *      impossible to turn into two orders, not just unlikely. Both the
 *      order creation AND the Quotation.convertedOrderId write happen
 *      inside ONE transaction, so there is no window where an order
 *      exists without its quotation link, or vice versa.
 *
 * Never auto-triggered by ACCEPTED status alone (spec: "do not silently
 * create an order just because a quotation is accepted") -- this is
 * always an explicit action a human takes from the quotation's detail
 * page.
 */

export type ConvertQuotationToOrderResult =
  | { ok: true; orderId: string; orderReference: string; alreadyConverted: boolean }
  | MutationFailure;

export async function convertQuotationToOrder(
  quotationId: string,
  input: ConvertQuotationToOrderInput,
  actorId: string
): Promise<ConvertQuotationToOrderResult> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { lines: true },
  });
  if (!quotation) {
    return { ok: false, status: 404, message: "Quotation not found." };
  }

  if (quotation.convertedOrderId) {
    const existingOrder = await prisma.customerOrder.findUnique({ where: { id: quotation.convertedOrderId }, select: { id: true, reference: true } });
    if (existingOrder) {
      return { ok: true, orderId: existingOrder.id, orderReference: existingOrder.reference, alreadyConverted: true };
    }
    // The link exists but the order row is somehow gone -- should be
    // unreachable (CustomerOrder is onDelete: Restrict against this FK,
    // and nothing in this codebase deletes orders), but fail loudly
    // rather than silently re-converting.
    return { ok: false, status: 500, message: "This quotation's recorded order could not be found." };
  }

  if (!isConvertibleStatus(quotation.status)) {
    return { ok: false, status: 409, message: `Cannot convert a quotation that is ${quotation.status} -- only an ACCEPTED quotation may be converted into an order.` };
  }

  if (quotation.lines.length === 0) {
    return { ok: false, status: 400, message: "Cannot convert a quotation with no lines." };
  }

  if (input.customerLocationId) {
    const location = await prisma.customerLocation.findFirst({ where: { id: input.customerLocationId, customerId: quotation.customerId }, select: { id: true } });
    if (!location) {
      return { ok: false, status: 400, message: "The selected location does not belong to this customer.", fieldErrors: { customerLocationId: "Location does not belong to this customer." } };
    }
  }

  const today = utcDateToDateOnlyString(new Date())!;
  const idempotencyKey = `QUO-CONVERT-${quotationId}`;

  const orderInput: OrderCreationInput = {
    customerId: quotation.customerId,
    customerLocationId: input.customerLocationId ?? null,
    customerPoReference: input.customerPoReference ?? null,
    source: "QUOTATION",
    orderDate: today,
    requestedDeliveryDate: input.requestedDeliveryDate ?? null,
    deliveryAddress: input.deliveryAddress ?? null,
    currency: quotation.currency,
    originalSourceText: null,
    internalNotes: input.internalNotes ?? `Converted from quotation ${quotation.quotationNumber} (revision ${quotation.revisionNumber}).`,
    idempotencyKey,
    lines: quotation.lines.map((line) => ({
      originalProductDescription: line.isUnlistedItem ? (line.unlistedItemDescription ?? "Unlisted item") : (line.sapItemDescriptionSnapshot ?? "Unknown product"),
      productId: line.productId,
      sapItemCodeSnapshot: line.sapItemCodeSnapshot,
      requestedQuantity: line.quantity.toString(),
      // OrderLine.requestedUnitCode is required; QuotationLine.unitOfMeasure
      // is "where available" (spec section 3) and so is nullable --
      // defaulted to "EA" only here, at the one boundary where a
      // non-null value is actually required, never upstream.
      requestedUnitCode: line.unitOfMeasure ?? "EA",
      customerUnitPrice: line.unitPrice.toString(),
      salesNotes: line.notes,
    })),
  };

  const MAX_ATTEMPTS = 5;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const reference = generateOrderReference();

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Re-check inside the transaction: closes the race window
        // between the pre-check above and this write (the idempotencyKey
        // unique constraint below is the final, authoritative guard
        // either way).
        const fresh = await tx.quotation.findUnique({ where: { id: quotationId }, select: { convertedOrderId: true, status: true } });
        if (fresh?.convertedOrderId) {
          throw new AlreadyConvertedError();
        }
        if (!fresh || !isConvertibleStatus(fresh.status)) {
          throw new NoLongerConvertibleError();
        }

        const order = await createOrderCore(tx, reference, orderInput, actorId, false);

        await tx.quotation.update({
          where: { id: quotationId },
          data: { convertedOrderId: order.id, convertedAt: new Date(), convertedById: actorId },
        });
        await tx.quotationEvent.create({
          data: { quotationId, eventType: "CONVERTED", actorId, notes: `Converted into order ${reference}.` },
        });
        await tx.auditEvent.create({
          data: { actorId, action: "QUOTATION_CONVERTED", entityType: "Quotation", entityId: quotationId, afterData: { orderId: order.id, orderReference: reference } },
        });

        return order;
      }, TRANSACTION_OPTIONS);

      return { ok: true, orderId: result.id, orderReference: reference, alreadyConverted: false };
    } catch (error) {
      if (error instanceof AlreadyConvertedError) {
        const fresh = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { convertedOrderId: true } });
        if (fresh?.convertedOrderId) {
          const existingOrder = await prisma.customerOrder.findUnique({ where: { id: fresh.convertedOrderId }, select: { id: true, reference: true } });
          if (existingOrder) {
            return { ok: true, orderId: existingOrder.id, orderReference: existingOrder.reference, alreadyConverted: true };
          }
        }
        return { ok: false, status: 409, message: "This quotation has already been converted into an order." };
      }
      if (error instanceof NoLongerConvertibleError) {
        return { ok: false, status: 409, message: "This quotation is no longer in a convertible state." };
      }
      if (isUniqueViolation(error)) {
        const target = (error as Prisma.PrismaClientKnownRequestError).meta?.target;
        const targetsIdempotencyKey = Array.isArray(target) && target.includes("idempotencyKey");
        if (targetsIdempotencyKey) {
          const raceWinner = await prisma.customerOrder.findUnique({ where: { idempotencyKey }, select: { id: true, reference: true } });
          if (raceWinner) {
            return { ok: true, orderId: raceWinner.id, orderReference: raceWinner.reference, alreadyConverted: true };
          }
        }
        continue; // an order-reference collision -- retry with a fresh reference
      }
      throw error;
    }
  }

  return { ok: false, status: 500, message: "Could not generate a unique order reference after several attempts." };
}

class AlreadyConvertedError extends Error {}
class NoLongerConvertibleError extends Error {}
