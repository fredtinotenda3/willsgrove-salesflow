import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import { computeQuotationTotals } from "@/lib/quotations/calculations";
import { resolveQuotationLines, type MutationFailure } from "@/lib/quotations/create";
import {
  type UpdateQuotationHeaderInput,
  type UpdateQuotationFollowUpInput,
  type QuotationLineInput,
  isEditableStatus,
  validateValidityWindow,
} from "@/lib/quotations/validation";

/**
 * Milestone 7. Draft editing (spec section 5's "Draft: can be created and
 * edited by authorised users... can contain incomplete information").
 * Every function here hard-blocks on any status other than DRAFT -- this
 * IS the mechanism that makes "preserve the original quotation values
 * after issue" (spec section 4) structurally true: there is no code path
 * anywhere in this module that can write to lines/header once a
 * quotation has left DRAFT. The only way to change anything after issue
 * is lib/quotations/revise.ts, which creates an entirely new row.
 */

export type EditResult = { ok: true } | MutationFailure;

async function requireDraftQuotation(quotationId: string) {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true, status: true, customerId: true } });
  if (!quotation) {
    return { ok: false as const, status: 404, message: "Quotation not found." };
  }
  if (!isEditableStatus(quotation.status)) {
    return { ok: false as const, status: 409, message: `Cannot edit a quotation that is ${quotation.status} -- only a DRAFT quotation can be edited.` };
  }
  return { ok: true as const, quotation };
}

/** Recomputes and writes Quotation.subtotal/discountTotal/vatTotal/total from its current lines -- called after every line add/update/remove. */
async function recomputeAndStoreQuotationTotals(tx: Prisma.TransactionClient, quotationId: string): Promise<void> {
  const lines = await tx.quotationLine.findMany({
    where: { quotationId },
    select: { lineSubtotal: true, discountAmount: true, vatAmount: true, lineTotal: true },
  });
  const totals = computeQuotationTotals(lines);
  await tx.quotation.update({
    where: { id: quotationId },
    data: { subtotal: totals.subtotal, discountTotal: totals.discountTotal, vatTotal: totals.vatTotal, total: totals.total },
  });
}

export async function updateQuotationHeader(quotationId: string, input: UpdateQuotationHeaderInput, actorId: string): Promise<EditResult> {
  const guard = await requireDraftQuotation(quotationId);
  if (!guard.ok) return guard;

  if (input.customerId && input.customerId !== guard.quotation.customerId) {
    const customer = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
    if (!customer) return { ok: false, status: 404, message: "Customer not found." };
  }
  const effectiveCustomerId = input.customerId ?? guard.quotation.customerId;
  if (input.customerContactId) {
    const contact = await prisma.customerContact.findFirst({ where: { id: input.customerContactId, customerId: effectiveCustomerId }, select: { id: true } });
    if (!contact) return { ok: false, status: 400, message: "The selected contact does not belong to this customer.", fieldErrors: { customerContactId: "Contact does not belong to this customer." } };
  }
  if (input.salespersonId) {
    const salesperson = await prisma.user.findUnique({ where: { id: input.salespersonId }, select: { id: true } });
    if (!salesperson) return { ok: false, status: 404, message: "Assigned salesperson not found." };
  }

  if (input.quotationDate || input.validUntil) {
    const current = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { quotationDate: true, validUntil: true } });
    const effectiveQuotationDate = input.quotationDate ?? current!.quotationDate.toISOString().slice(0, 10);
    const effectiveValidUntil = input.validUntil ?? current!.validUntil.toISOString().slice(0, 10);
    const windowCheck = validateValidityWindow(effectiveQuotationDate, effectiveValidUntil);
    if (!windowCheck.ok) return { ok: false, status: 400, message: windowCheck.message, fieldErrors: { validUntil: windowCheck.message } };
  }

  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotationId },
      data: {
        customerId: input.customerId,
        customerContactId: input.customerContactId === undefined ? undefined : input.customerContactId,
        quotationDate: input.quotationDate ? dateOnlyStringToUtcDate(input.quotationDate)! : undefined,
        validUntil: input.validUntil ? dateOnlyStringToUtcDate(input.validUntil)! : undefined,
        currency: input.currency,
        customerReference: input.customerReference === undefined ? undefined : input.customerReference,
        salespersonId: input.salespersonId,
        internalNotes: input.internalNotes === undefined ? undefined : input.internalNotes,
        customerNotes: input.customerNotes === undefined ? undefined : input.customerNotes,
      },
    });
    await tx.quotationEvent.create({ data: { quotationId, eventType: "EDITED", actorId, notes: "Header updated." } });
    await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_HEADER_UPDATED", entityType: "Quotation", entityId: quotationId, afterData: input as object } });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}

/**
 * Follow-up tracking (spec section 7) -- deliberately NOT gated by
 * isEditableStatus/requireDraftQuotation: see
 * lib/quotations/validation.ts's updateQuotationFollowUpSchema comment
 * for why this must remain settable on an ISSUED quotation awaiting a
 * response, not just a DRAFT. Blocked only on CANCELLED, since there is
 * nothing left to follow up on once a quotation is dead.
 */
export async function updateQuotationFollowUp(quotationId: string, input: UpdateQuotationFollowUpInput, actorId: string): Promise<EditResult> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true, status: true } });
  if (!quotation) {
    return { ok: false, status: 404, message: "Quotation not found." };
  }
  if (quotation.status === "CANCELLED") {
    return { ok: false, status: 409, message: "Cannot schedule a follow-up on a cancelled quotation." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({
      where: { id: quotationId },
      data: {
        nextFollowUpDate: input.nextFollowUpDate === undefined ? undefined : input.nextFollowUpDate ? dateOnlyStringToUtcDate(input.nextFollowUpDate) : null,
        followUpNotes: input.followUpNotes === undefined ? undefined : input.followUpNotes,
      },
    });
    await tx.quotationEvent.create({ data: { quotationId, eventType: "EDITED", actorId, notes: "Follow-up schedule updated." } });
    await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_FOLLOWUP_UPDATED", entityType: "Quotation", entityId: quotationId, afterData: input as object } });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}

export type AddLineResult = { ok: true; lineId: string } | MutationFailure;

export async function addQuotationLine(quotationId: string, input: QuotationLineInput, actorId: string): Promise<AddLineResult> {
  const guard = await requireDraftQuotation(quotationId);
  if (!guard.ok) return guard;

  const resolved = await resolveQuotationLines([input]);
  if (!resolved.ok) return resolved;
  const line = resolved.lines[0];

  const result = await prisma.$transaction(async (tx) => {
    const lastLine = await tx.quotationLine.findFirst({ where: { quotationId }, orderBy: { lineNumber: "desc" }, select: { lineNumber: true } });
    const nextLineNumber = (lastLine?.lineNumber ?? 0) + 1;

    const created = await tx.quotationLine.create({
      data: {
        quotationId,
        lineNumber: nextLineNumber,
        productId: line.productId,
        sapItemCodeSnapshot: line.sapItemCodeSnapshot,
        sapItemDescriptionSnapshot: line.sapItemDescriptionSnapshot,
        isUnlistedItem: line.input.isUnlistedItem ?? false,
        unlistedItemDescription: line.input.isUnlistedItem ? line.input.unlistedItemDescription : null,
        quantity: new Prisma.Decimal(line.input.quantity),
        unitOfMeasure: line.unitOfMeasure,
        unitPrice: new Prisma.Decimal(line.input.unitPrice),
        discountPercent: line.input.discountPercent ? new Prisma.Decimal(line.input.discountPercent) : null,
        vatCodeSnapshot: line.vatCodeSnapshot,
        vatRatePercentSnapshot: line.vatRatePercentSnapshot ? new Prisma.Decimal(line.vatRatePercentSnapshot) : null,
        lineSubtotal: line.amounts.lineSubtotal,
        discountAmount: line.amounts.discountAmount,
        vatAmount: line.amounts.vatAmount,
        lineTotal: line.amounts.lineTotal,
        notes: line.input.notes ?? null,
      },
      select: { id: true },
    });

    await recomputeAndStoreQuotationTotals(tx, quotationId);
    await tx.quotationEvent.create({ data: { quotationId, eventType: "EDITED", actorId, notes: `Line ${nextLineNumber} added.` } });
    await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_LINE_ADDED", entityType: "Quotation", entityId: quotationId, afterData: { lineNumber: nextLineNumber } } });

    return created;
  }, TRANSACTION_OPTIONS);

  return { ok: true, lineId: result.id };
}

export async function updateQuotationLine(quotationId: string, lineId: string, input: QuotationLineInput, actorId: string): Promise<EditResult> {
  const guard = await requireDraftQuotation(quotationId);
  if (!guard.ok) return guard;

  const existingLine = await prisma.quotationLine.findFirst({ where: { id: lineId, quotationId }, select: { id: true, lineNumber: true } });
  if (!existingLine) return { ok: false, status: 404, message: "Quotation line not found." };

  const resolved = await resolveQuotationLines([input]);
  if (!resolved.ok) return resolved;
  const line = resolved.lines[0];

  await prisma.$transaction(async (tx) => {
    await tx.quotationLine.update({
      where: { id: lineId },
      data: {
        productId: line.productId,
        sapItemCodeSnapshot: line.sapItemCodeSnapshot,
        sapItemDescriptionSnapshot: line.sapItemDescriptionSnapshot,
        isUnlistedItem: line.input.isUnlistedItem ?? false,
        unlistedItemDescription: line.input.isUnlistedItem ? line.input.unlistedItemDescription : null,
        quantity: new Prisma.Decimal(line.input.quantity),
        unitOfMeasure: line.unitOfMeasure,
        unitPrice: new Prisma.Decimal(line.input.unitPrice),
        discountPercent: line.input.discountPercent ? new Prisma.Decimal(line.input.discountPercent) : null,
        vatCodeSnapshot: line.vatCodeSnapshot,
        vatRatePercentSnapshot: line.vatRatePercentSnapshot ? new Prisma.Decimal(line.vatRatePercentSnapshot) : null,
        lineSubtotal: line.amounts.lineSubtotal,
        discountAmount: line.amounts.discountAmount,
        vatAmount: line.amounts.vatAmount,
        lineTotal: line.amounts.lineTotal,
        notes: line.input.notes ?? null,
      },
    });
    await recomputeAndStoreQuotationTotals(tx, quotationId);
    await tx.quotationEvent.create({ data: { quotationId, eventType: "EDITED", actorId, notes: `Line ${existingLine.lineNumber} updated.` } });
    await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_LINE_UPDATED", entityType: "Quotation", entityId: quotationId, afterData: { lineNumber: existingLine.lineNumber } } });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}

export async function removeQuotationLine(quotationId: string, lineId: string, actorId: string): Promise<EditResult> {
  const guard = await requireDraftQuotation(quotationId);
  if (!guard.ok) return guard;

  const existingLine = await prisma.quotationLine.findFirst({ where: { id: lineId, quotationId }, select: { id: true, lineNumber: true } });
  if (!existingLine) return { ok: false, status: 404, message: "Quotation line not found." };

  await prisma.$transaction(async (tx) => {
    await tx.quotationLine.delete({ where: { id: lineId } });
    await recomputeAndStoreQuotationTotals(tx, quotationId);
    await tx.quotationEvent.create({ data: { quotationId, eventType: "EDITED", actorId, notes: `Line ${existingLine.lineNumber} removed.` } });
    await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_LINE_REMOVED", entityType: "Quotation", entityId: quotationId, afterData: { lineNumber: existingLine.lineNumber } } });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}
