import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { validateQuotationStatusTransition } from "@/lib/quotations/validation";
import type { MutationFailure } from "@/lib/quotations/create";
import { checkAndRequireQuotationApproval } from "@/lib/approvals/quotation-gate";

/**
 * Milestone 7. Issuing a quotation (spec section 5's "Issued" state):
 * "represents a quotation formally sent or presented to the customer...
 * preserve the issued version and its financial values... record who
 * issued it and when."
 *
 * Milestone 8 integration: checkAndRequireQuotationApproval() is the
 * ONE pricing/discount approval gate (spec section 4A, "an issued
 * quotation must not bypass a required approval") -- called here,
 * immediately before this function's own transition/line checks are
 * trusted, never duplicated elsewhere. A quotation that never exceeds
 * any active ApprovalPolicy threshold pays no extra cost and issues
 * exactly as it did before Milestone 8 existed.
 *
 * "Must pass validation before issue" (spec section 5's Draft rules):
 * at least one line, and every line must have a resolvable price. Both
 * are already guaranteed by the time a line reaches the database
 * (resolveQuotationLines/the create/edit zod schemas reject a line with
 * no unitPrice or non-positive quantity), so the one thing left to check
 * here is simply "does this quotation have any lines at all" -- an empty
 * DRAFT is the one state the lib layer otherwise allows (so a
 * salesperson can start a header before knowing every product) but
 * cannot legitimately be issued.
 */

export type IssueQuotationResult = (MutationFailure & { approvalRequestId?: string }) | { ok: true };

export async function issueQuotation(quotationId: string, actorId: string): Promise<IssueQuotationResult> {
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
    select: { id: true, status: true, _count: { select: { lines: true } } },
  });
  if (!quotation) {
    return { ok: false, status: 404, message: "Quotation not found." };
  }

  const transition = validateQuotationStatusTransition(quotation.status, "ISSUED");
  if (!transition.ok) {
    return { ok: false, status: 409, message: transition.message };
  }

  if (quotation._count.lines === 0) {
    return { ok: false, status: 400, message: "Cannot issue a quotation with no lines -- add at least one product first." };
  }

  const gate = await checkAndRequireQuotationApproval(quotationId, actorId);
  if (!gate.ok) {
    return { ok: false, status: gate.status, message: gate.message, approvalRequestId: gate.requestId };
  }

  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id: quotationId }, data: { status: "ISSUED", issuedAt: new Date(), issuedById: actorId } });
    await tx.quotationEvent.create({ data: { quotationId, eventType: "ISSUED", actorId } });
    await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_ISSUED", entityType: "Quotation", entityId: quotationId, beforeData: { status: quotation.status }, afterData: { status: "ISSUED" } } });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}
