import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { validateQuotationStatusTransition } from "@/lib/quotations/validation";
import type { CancelQuotationInput } from "@/lib/quotations/validation";
import type { MutationFailure } from "@/lib/quotations/create";

/**
 * Milestone 7. Cancelling a quotation (spec section 5's Cancelled state):
 * "record the reason and the user responsible. Prevent inappropriate
 * cancellation of quotations already converted into orders."
 *
 * The convertedOrderId check below is a DATA FACT, deliberately not
 * encoded in validateQuotationStatusTransition's graph (ACCEPTED ->
 * CANCELLED is a structurally allowed edge there) -- the graph has no
 * way to see other columns, so "has this specific quotation already
 * produced a real order" has to be checked here, the one place that
 * actually reads convertedOrderId before writing CANCELLED.
 */

export type CancelQuotationResult = { ok: true } | MutationFailure;

export async function cancelQuotation(quotationId: string, input: CancelQuotationInput, actorId: string): Promise<CancelQuotationResult> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true, status: true, convertedOrderId: true } });
  if (!quotation) {
    return { ok: false, status: 404, message: "Quotation not found." };
  }

  const transition = validateQuotationStatusTransition(quotation.status, "CANCELLED");
  if (!transition.ok) {
    return { ok: false, status: 409, message: transition.message };
  }

  if (quotation.convertedOrderId) {
    return { ok: false, status: 409, message: "This quotation has already been converted into a customer order and cannot be cancelled." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotationId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actorId, cancellationReason: input.cancellationReason },
    });
    await tx.quotationEvent.create({ data: { quotationId, eventType: "CANCELLED", actorId, notes: input.cancellationReason } });
    await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_CANCELLED", entityType: "Quotation", entityId: quotationId, beforeData: { status: quotation.status }, afterData: { status: "CANCELLED", cancellationReason: input.cancellationReason } } });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}
