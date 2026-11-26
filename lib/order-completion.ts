import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { recordNativeInvoice } from "@/lib/invoice-recording/record-native-invoice";

/**
 * "Mark as Done": the last step of the order workflow
 * (Received > Approval > Picking > Ready to Invoice > Invoiced > Dispatched >
 * Delivered > Done).
 *
 * An order is DONE when every active (non-voided) invoice of the order has its
 * delivery outcome recorded. That is the same fact the rest of the system
 * already keys "delivered and finished" on -- InvoiceDeliveryRecord drives the
 * Delivered Orders page, the active-orders exclusion and the invoice's
 * "Delivered" status -- so this does not introduce a second, parallel notion of
 * "done". It simply records those outcomes for the order's invoices in one
 * action, deriving each outcome from what was actually recorded at delivery:
 *
 *   - rejected quantities were recorded at delivery -> the claim(s) created
 *     from them are attached to the invoice and the outcome is WITH_CLAIM;
 *   - nothing was rejected -> NO_CLAIM.
 *
 * Preconditions (all checked under the order row lock, so two clicks or a
 * concurrent invoice reset cannot interleave):
 *   1. order is READY_TO_INVOICE and has at least one active invoice;
 *   2. it has at least one dispatch and every non-cancelled dispatch is
 *      DELIVERED (a delivery outcome recorded);
 *   3. everything picked has been invoiced AND dispatched (nothing is still
 *      waiting to be invoiced or to leave the warehouse).
 *
 * Idempotent: an order whose invoices all already have outcomes returns 409
 * "already completed" and changes nothing.
 */

export type CompleteOrderResult =
  | { ok: true; invoiceCount: number; withClaimCount: number; claimCount: number }
  | { ok: false; status: number; message: string };

/**
 * Orders that were dispatched and delivered BEFORE the invoice step existed have no invoice on file and, now that
 * delivered orders are read-only, cannot be invoiced from the order page. Completing such an order records the
 * invoice for the delivered quantities first (at each line's order price), so it still ends up with an invoice
 * and a delivery outcome instead of being stuck. Orders that went through the normal flow never take this path.
 */
async function invoiceLegacyDeliveredOrder(orderId: string, actorId: string): Promise<CompleteOrderResult | null> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      status: true,
      lines: { select: { id: true, lineNumber: true, approvedUnitPrice: true, customerUnitPrice: true } },
      dispatchRecords: { where: { status: { not: "CANCELLED" } }, select: { status: true } },
    },
  });
  if (!order || order.status !== "READY_TO_INVOICE" || order.dispatchRecords.length === 0) return null;
  if (order.dispatchRecords.some((d) => d.status !== "DELIVERED")) return null;
  const existing = await prisma.sapInvoice.count({ where: { matchedOrderId: orderId, isCancelledOrReversed: false } });
  if (existing > 0) return null;

  const picked = await prisma.pickingLine.groupBy({
    by: ["orderLineId"],
    where: { orderLine: { orderId }, foundQuantity: { not: null }, pickingSession: { status: "AUTHORIZED" } },
    _sum: { foundQuantity: true },
  });
  const lines: { orderLineId: string; quantityInvoiced: string; unitPrice: string }[] = [];
  for (const row of picked) {
    const quantity = row._sum.foundQuantity;
    if (!quantity || quantity.lessThanOrEqualTo(0)) continue;
    const line = order.lines.find((l) => l.id === row.orderLineId);
    const price = line?.approvedUnitPrice ?? line?.customerUnitPrice ?? null;
    if (!line || price === null) {
      return { ok: false, status: 409, message: `Line #${line?.lineNumber ?? "?"} has no unit price, so the invoice for this delivered order cannot be recorded automatically. Set a price on the line first.` };
    }
    lines.push({ orderLineId: row.orderLineId, quantityInvoiced: quantity.toString(), unitPrice: price.toString() });
  }
  if (lines.length === 0) return null;
  const result = await recordNativeInvoice(orderId, actorId, { invoiceDate: new Date().toISOString().slice(0, 10), lines } as never);
  if (!result.ok) return { ok: false, status: result.status, message: result.message };
  return null;
}

export async function completeOrder(orderId: string, actorId: string): Promise<CompleteOrderResult> {
  const legacy = await invoiceLegacyDeliveredOrder(orderId, actorId);
  if (legacy) return legacy;
  return prisma.$transaction(async (tx): Promise<CompleteOrderResult> => {
    await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${orderId} FOR UPDATE`;

    const order = await tx.customerOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        reference: true,
        lines: { select: { id: true, lineNumber: true } },
        dispatchRecords: { where: { status: { not: "CANCELLED" } }, select: { status: true } },
      },
    });
    if (!order) return { ok: false, status: 404, message: "Order not found." };
    if (order.status !== "READY_TO_INVOICE") {
      return { ok: false, status: 409, message: "Only an order that has been picked and authorised (Ready to Invoice) can be completed." };
    }

    const invoices = await tx.sapInvoice.findMany({
      where: { matchedOrderId: orderId, isCancelledOrReversed: false },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        matchedCustomerId: true,
        deliveryRecord: { select: { id: true } },
        lines: { where: { matchedOrderLineId: { not: null } }, select: { matchedOrderLineId: true } },
      },
    });
    if (invoices.length === 0) {
      return { ok: false, status: 409, message: "This order has not been invoiced yet. Mark it as Invoiced before completing it." };
    }
    const pending = invoices.filter((invoice) => invoice.deliveryRecord === null);
    if (pending.length === 0) {
      return { ok: false, status: 409, message: "This order is already completed." };
    }

    if (order.dispatchRecords.length === 0) {
      return { ok: false, status: 409, message: "This order has not been dispatched yet." };
    }
    const notDelivered = order.dispatchRecords.filter((dispatch) => dispatch.status !== "DELIVERED").length;
    if (notDelivered > 0) {
      return {
        ok: false,
        status: 409,
        message: `${notDelivered} dispatch${notDelivered === 1 ? " has" : "es have"} not been delivered yet. Record the delivery outcome for every dispatch first.`,
      };
    }

    // Nothing may still be waiting to be invoiced or dispatched.
    const [picked, invoiced, dispatched] = await Promise.all([
      tx.pickingLine.groupBy({
        by: ["orderLineId"],
        where: { orderLine: { orderId }, foundQuantity: { not: null }, pickingSession: { status: "AUTHORIZED" } },
        _sum: { foundQuantity: true },
      }),
      tx.sapInvoiceLine.groupBy({
        by: ["matchedOrderLineId"],
        where: { matchedOrderLine: { orderId }, sapInvoice: { isCancelledOrReversed: false } },
        _sum: { quantityInvoiced: true },
      }),
      tx.dispatchLine.groupBy({
        by: ["orderLineId"],
        where: { orderLine: { orderId }, dispatchRecord: { status: { not: "CANCELLED" } } },
        _sum: { dispatchedQuantity: true },
      }),
    ]);
    const invoicedByLine = new Map(invoiced.map((row) => [row.matchedOrderLineId, row._sum.quantityInvoiced ?? new Prisma.Decimal(0)]));
    const dispatchedByLine = new Map(dispatched.map((row) => [row.orderLineId, row._sum.dispatchedQuantity ?? new Prisma.Decimal(0)]));
    const lineNumberById = new Map(order.lines.map((line) => [line.id, line.lineNumber]));
    const unfinished: string[] = [];
    for (const row of picked) {
      const pickedQuantity = row._sum.foundQuantity ?? new Prisma.Decimal(0);
      const invoicedQuantity = invoicedByLine.get(row.orderLineId) ?? new Prisma.Decimal(0);
      const dispatchedQuantity = dispatchedByLine.get(row.orderLineId) ?? new Prisma.Decimal(0);
      if (invoicedQuantity.lessThan(pickedQuantity) || dispatchedQuantity.lessThan(pickedQuantity)) {
        unfinished.push(`#${lineNumberById.get(row.orderLineId) ?? "?"}`);
      }
    }
    if (unfinished.length > 0) {
      return {
        ok: false,
        status: 409,
        message: `Picked goods on line ${unfinished.join(", ")} still need to be invoiced and dispatched before the order can be completed.`,
      };
    }

    // Delivery claims raised at delivery and not yet attached to an invoice outcome.
    const claims = await tx.invoiceClaim.findMany({
      where: { orderId, deliveryRecordId: { not: null }, invoiceDeliveryRecordId: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, lines: { select: { orderLineId: true } } },
    });
    const unattached = new Map(claims.map((claim) => [claim.id, new Set(claim.lines.map((line) => line.orderLineId).filter((id): id is string => id !== null))]));

    let withClaimCount = 0;
    let claimCount = 0;
    for (const invoice of pending) {
      const invoiceLineIds = new Set(invoice.lines.map((line) => line.matchedOrderLineId).filter((id): id is string => id !== null));
      // A claim belongs to the first pending invoice (oldest first) that covers one of its lines.
      const attach: string[] = [];
      for (const [claimId, claimLineIds] of unattached) {
        if ([...claimLineIds].some((lineId) => invoiceLineIds.has(lineId))) attach.push(claimId);
      }
      for (const claimId of attach) unattached.delete(claimId);

      const record = await tx.invoiceDeliveryRecord.create({
        data: {
          sapInvoiceId: invoice.id,
          outcome: attach.length > 0 ? "WITH_CLAIM" : "NO_CLAIM",
          notes: attach.length > 0 ? "Completed from the order: rejected products were recorded at delivery." : "Completed from the order: delivered with nothing rejected.",
          recordedById: actorId,
        },
        select: { id: true },
      });
      if (attach.length > 0) {
        await tx.invoiceClaim.updateMany({
          where: { id: { in: attach } },
          data: { invoiceDeliveryRecordId: record.id, sapInvoiceId: invoice.id },
        });
        withClaimCount += 1;
        claimCount += attach.length;
      }
    }

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "ORDER_COMPLETED",
        entityType: "CustomerOrder",
        entityId: orderId,
        afterData: { orderReference: order.reference, invoicesCompleted: pending.length, withClaim: withClaimCount, claims: claimCount },
      },
    });

    return { ok: true, invoiceCount: pending.length, withClaimCount, claimCount };
  }, TRANSACTION_OPTIONS);
}
