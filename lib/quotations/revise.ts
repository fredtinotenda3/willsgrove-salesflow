import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { isRevisableStatus } from "@/lib/quotations/validation";
import type { ReviseQuotationInput } from "@/lib/quotations/validation";
import type { MutationFailure } from "@/lib/quotations/create";

/**
 * Milestone 7 (spec section 6: revisions and quotation history).
 *
 * Creates a brand-new Quotation row (status DRAFT) that is an exact copy
 * of the current one's header + lines, linked back via previousRevisionId,
 * and freezes the OLD row by setting supersededAt/supersededById on it --
 * the old row's own `status` is left exactly as it was (spec: "preserve
 * the acceptance/rejection history of previous versions"). Line values
 * are copied VERBATIM (not re-resolved against current Product/TaxCode
 * data) -- a revision starts as a faithful copy of what was last issued,
 * editable from there via lib/quotations/edit.ts; nothing should
 * silently change just because a revision was created.
 *
 * "Do not allow an old version to be mistaken for the currently issued
 * quotation" (spec section 6) is enforced at the query layer
 * (lib/quotations/queries.ts excludes supersededAt: { not: null } from
 * every default list/dashboard view), not by this function -- the old
 * row still fully exists and is still reachable from its own detail
 * page and from the new revision's previousRevision link.
 */

export type ReviseQuotationResult = { ok: true; id: string; quotationNumber: string; revisionNumber: number } | MutationFailure;

export async function reviseQuotation(quotationId: string, input: ReviseQuotationInput, actorId: string): Promise<ReviseQuotationResult> {
  const original = await prisma.quotation.findUnique({
    where: { id: quotationId },
    include: { lines: true },
  });
  if (!original) {
    return { ok: false, status: 404, message: "Quotation not found." };
  }

  if (!isRevisableStatus(original.status)) {
    return { ok: false, status: 409, message: `Cannot revise a quotation that is ${original.status} -- a quotation may only be revised from ISSUED, ACCEPTED, REJECTED, or EXPIRED.` };
  }

  if (original.supersededAt) {
    return { ok: false, status: 409, message: "This quotation has already been superseded by a later revision. Revise the current revision instead." };
  }

  const newRevisionNumber = original.revisionNumber + 1;
  const rootQuotationId = original.rootQuotationId ?? original.id;

  const created = await prisma.$transaction(async (tx) => {
    const revision = await tx.quotation.create({
      data: {
        quotationNumber: original.quotationNumber,
        revisionNumber: newRevisionNumber,
        rootQuotationId,
        previousRevisionId: original.id,
        customerId: original.customerId,
        customerContactId: original.customerContactId,
        quotationDate: original.quotationDate,
        validUntil: original.validUntil,
        currency: original.currency,
        customerReference: original.customerReference,
        preparedById: actorId,
        salespersonId: original.salespersonId,
        status: "DRAFT",
        internalNotes: original.internalNotes,
        customerNotes: original.customerNotes,
        subtotal: original.subtotal,
        discountTotal: original.discountTotal,
        vatTotal: original.vatTotal,
        total: original.total,
        isDemo: original.isDemo,
        lines: {
          create: original.lines.map((line) => ({
            lineNumber: line.lineNumber,
            productId: line.productId,
            sapItemCodeSnapshot: line.sapItemCodeSnapshot,
            sapItemDescriptionSnapshot: line.sapItemDescriptionSnapshot,
            isUnlistedItem: line.isUnlistedItem,
            unlistedItemDescription: line.unlistedItemDescription,
            quantity: line.quantity,
            unitOfMeasure: line.unitOfMeasure,
            unitPrice: line.unitPrice,
            discountPercent: line.discountPercent,
            vatCodeSnapshot: line.vatCodeSnapshot,
            vatRatePercentSnapshot: line.vatRatePercentSnapshot,
            lineSubtotal: line.lineSubtotal,
            discountAmount: line.discountAmount,
            vatAmount: line.vatAmount,
            lineTotal: line.lineTotal,
            notes: line.notes,
            isDemo: line.isDemo,
          })),
        },
      },
      select: { id: true, quotationNumber: true, revisionNumber: true },
    });

    await tx.quotation.update({
      where: { id: original.id },
      data: { supersededAt: new Date(), supersededById: actorId },
    });

    await tx.quotationEvent.create({
      data: { quotationId: original.id, eventType: "REVISED", actorId, notes: `Superseded by revision ${newRevisionNumber}.${input.reason ? ` Reason: ${input.reason}` : ""}` },
    });
    await tx.quotationEvent.create({
      data: { quotationId: revision.id, eventType: "REVISED", actorId, notes: `Created as revision ${newRevisionNumber} of ${original.quotationNumber} (from revision ${original.revisionNumber}).` },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "QUOTATION_REVISED",
        entityType: "Quotation",
        entityId: original.id,
        beforeData: { revisionNumber: original.revisionNumber },
        afterData: { newQuotationId: revision.id, newRevisionNumber },
      },
    });

    return revision;
  }, TRANSACTION_OPTIONS);

  return { ok: true, id: created.id, quotationNumber: created.quotationNumber, revisionNumber: created.revisionNumber };
}
