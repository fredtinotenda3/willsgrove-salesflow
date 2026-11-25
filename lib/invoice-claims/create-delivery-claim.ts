import "server-only";
import { Prisma } from "@prisma/client";
import type { PrismaTransactionClient } from "@/lib/prisma";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import { generateClaimReference } from "@/lib/invoice-claims/create-claim";
import { deriveClaimHeaderCategory, mapRejectionReasonToCategory, selectRejectedLines } from "@/lib/invoice-claims/delivery-claim-core";

/**
 * Creates the invoice claim for a Record Delivery outcome -- the delivery
 * rejection IS the claim in this business, so the claim must exist the moment
 * the outcome is submitted.
 *
 * Runs INSIDE recordDelivery's transaction (it takes the caller's `tx`), so a
 * delivery can never be saved without its claim, or the reverse.
 *
 * Idempotent by construction:
 *   - InvoiceClaim.deliveryRecordId is @unique  -> one claim per delivery
 *   - InvoiceClaimLine.deliveryLineId is @unique -> one claim line per delivery line
 * and an existing claim for the delivery is returned unchanged rather than
 * duplicated.
 *
 * Standalone: reads only the application's own order/delivery/product data.
 * No SAP invoice, SAP customer or SAP synchronisation is needed or consulted.
 */

export type DeliveryClaimResult =
  | { created: false; reason: "NO_REJECTED_QUANTITY" | "ALREADY_EXISTS"; claimId?: string }
  | { created: true; claimId: string; claimReference: string; lineCount: number };

export async function createClaimFromDelivery(
  tx: PrismaTransactionClient,
  params: { deliveryRecordId: string; actorId: string }
): Promise<DeliveryClaimResult> {
  const existing = await tx.invoiceClaim.findUnique({ where: { deliveryRecordId: params.deliveryRecordId }, select: { id: true } });
  if (existing) return { created: false, reason: "ALREADY_EXISTS", claimId: existing.id };

  const delivery = await tx.deliveryRecord.findUnique({
    where: { id: params.deliveryRecordId },
    select: {
      id: true,
      recordedAt: true,
      recipientName: true,
      notes: true,
      isDemo: true,
      dispatchRecord: { select: { id: true, orderId: true, order: { select: { id: true, reference: true, customerId: true, isDemo: true } } } },
      lines: {
        select: {
          id: true,
          acceptedQuantity: true,
          rejectedQuantity: true,
          rejectionReason: true,
          dispatchLine: {
            select: {
              orderLineId: true,
              orderLine: { select: { originalProductDescription: true, sapItemCodeSnapshot: true, product: { select: { sapItemCode: true, itemName: true } } } },
            },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!delivery) throw new Error(`Delivery record ${params.deliveryRecordId} not found while creating its claim.`);

  const rejected = selectRejectedLines(delivery.lines.map((line) => ({ line, rejectedQuantity: line.rejectedQuantity.toString() })));
  if (rejected.length === 0) return { created: false, reason: "NO_REJECTED_QUANTITY" };

  const order = delivery.dispatchRecord.order;
  const lineSpecs = rejected.map(({ line }) => ({
    line,
    category: mapRejectionReasonToCategory(line.rejectionReason),
  }));
  const headerCategory = deriveClaimHeaderCategory(lineSpecs.map((spec) => spec.category));
  const claimDate = dateOnlyStringToUtcDate(delivery.recordedAt.toISOString().slice(0, 10));
  if (!claimDate) throw new Error("Could not derive the claim date from the delivery record.");

  const descriptionParts = [`Created automatically from the delivery outcome recorded for order ${order.reference}.`];
  if (delivery.recipientName) descriptionParts.push(`Received by: ${delivery.recipientName}.`);
  if (delivery.notes) descriptionParts.push(`Delivery notes: ${delivery.notes}`);

  const claim = await tx.invoiceClaim.create({
    data: {
      claimReference: generateClaimReference(),
      customerId: order.customerId,
      orderId: order.id,
      deliveryRecordId: delivery.id,
      category: headerCategory,
      description: descriptionParts.join(" "),
      reportedById: params.actorId,
      priority: "MEDIUM",
      claimDate,
      status: "OPEN",
      isDemo: delivery.isDemo || order.isDemo,
      lines: {
        create: lineSpecs.map(({ line, category }) => {
          const orderLine = line.dispatchLine.orderLine;
          return {
            orderLineId: line.dispatchLine.orderLineId,
            deliveryLineId: line.id,
            sapItemCodeSnapshot: orderLine.product?.sapItemCode ?? orderLine.sapItemCodeSnapshot ?? null,
            sapItemDescriptionSnapshot: orderLine.product?.itemName ?? orderLine.originalProductDescription,
            disputeType: "QUANTITY" as const,
            acceptedQuantity: new Prisma.Decimal(line.acceptedQuantity),
            rejectedQuantity: new Prisma.Decimal(line.rejectedQuantity),
            reasonCategory: category,
            reason: line.rejectionReason?.trim() || "Rejected at delivery",
            evidenceNotes: "Recorded at delivery (Record Delivery).",
            isDemo: delivery.isDemo || order.isDemo,
          };
        }),
      },
    },
    select: { id: true, claimReference: true },
  });

  await tx.auditEvent.create({
    data: {
      actorId: params.actorId,
      action: "CLAIM_CREATED_FROM_DELIVERY",
      entityType: "InvoiceClaim",
      entityId: claim.id,
      afterData: {
        claimReference: claim.claimReference,
        deliveryRecordId: delivery.id,
        orderId: order.id,
        lines: lineSpecs.map(({ line, category }) => ({
          deliveryLineId: line.id,
          rejectedQuantity: line.rejectedQuantity.toString(),
          acceptedQuantity: line.acceptedQuantity.toString(),
          reasonCategory: category,
        })),
      },
    },
  });

  return { created: true, claimId: claim.id, claimReference: claim.claimReference, lineCount: lineSpecs.length };
}
