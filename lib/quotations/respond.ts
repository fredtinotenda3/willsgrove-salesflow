import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { validateQuotationStatusTransition } from "@/lib/quotations/validation";
import type { RespondToQuotationInput } from "@/lib/quotations/validation";
import type { MutationFailure } from "@/lib/quotations/create";

/**
 * Milestone 7. Recording the customer's response to an ISSUED quotation
 * (spec section 5's Accepted/Rejected states + section 7's "customer
 * response date, response notes, rejection reason"). Records a FACT
 * reported by the customer -- same tier as recording claim investigation
 * findings in Milestone 6A -- never an SAP/financial transaction:
 * "do not automatically claim that an SAP invoice or financial
 * transaction has been created" (spec section 5's Accepted rule).
 *
 * Deliberately does NOT create a CustomerOrder as a side effect of
 * ACCEPTED -- spec section 8: "do not silently create an order just
 * because a quotation is accepted." That is always a separate, explicit
 * action (lib/quotations/convert-to-order.ts).
 */

export type RespondToQuotationResult = { ok: true } | MutationFailure;

export async function respondToQuotation(quotationId: string, input: RespondToQuotationInput, actorId: string): Promise<RespondToQuotationResult> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true, status: true } });
  if (!quotation) {
    return { ok: false, status: 404, message: "Quotation not found." };
  }

  const transition = validateQuotationStatusTransition(quotation.status, input.decision);
  if (!transition.ok) {
    return { ok: false, status: 409, message: transition.message };
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    if (input.decision === "ACCEPTED") {
      await tx.quotation.update({
        where: { id: quotationId },
        data: {
          status: "ACCEPTED",
          respondedAt: now,
          respondedById: actorId,
          responseNotes: input.responseNotes ?? null,
          customerResponseReference: input.customerResponseReference ?? null,
        },
      });
      await tx.quotationEvent.create({ data: { quotationId, eventType: "ACCEPTED", actorId, notes: input.responseNotes ?? null } });
      await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_ACCEPTED", entityType: "Quotation", entityId: quotationId, beforeData: { status: quotation.status }, afterData: { status: "ACCEPTED" } } });
    } else {
      await tx.quotation.update({
        where: { id: quotationId },
        data: {
          status: "REJECTED",
          respondedAt: now,
          respondedById: actorId,
          responseNotes: input.responseNotes ?? null,
          rejectionReason: input.rejectionReason,
        },
      });
      await tx.quotationEvent.create({ data: { quotationId, eventType: "REJECTED", actorId, notes: input.rejectionReason } });
      await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_REJECTED", entityType: "Quotation", entityId: quotationId, beforeData: { status: quotation.status }, afterData: { status: "REJECTED", rejectionReason: input.rejectionReason } } });
    }
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}
