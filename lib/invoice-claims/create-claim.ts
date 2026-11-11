import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import {
  type CreateInvoiceClaimInput,
  validateClaimLineQuantities,
  validateDisputedAmount,
  claimCategoryRequiresDetail,
} from "@/lib/invoice-claims/validation";
import { getAlreadyClaimedTotal } from "@/lib/invoice-claims/queries";

/**
 * Milestone 6A. Any authenticated user may create a claim (spec's
 * confirmed authorization split -- see docs/milestones/PROGRESS.md's
 * Milestone 6A section) -- this function is role-agnostic; the route
 * layer (app/api/invoice-claims/route.ts) only checks that the caller is
 * authenticated at all.
 */

export type CreateInvoiceClaimResult =
  | { ok: true; id: string; claimReference: string }
  | { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };

/**
 * Same `PREFIX-YYYYMMDD-8HEXRANDOM` shape as generateOrderReference()/
 * generateHandoverReference() -- not re-exported from lib/orders.ts
 * because that file's generator is order-specific by name and this
 * project's convention (confirmed by lib/handover/generate-handover.ts
 * also having its own copy) is one small generator per entity, not a
 * shared parameterized one.
 */
export function generateClaimReference(): string {
  const datePart = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const randomPart = randomBytes(4).toString("hex").toUpperCase();
  return `CLM-${datePart}-${randomPart}`;
}

export async function createInvoiceClaim(input: CreateInvoiceClaimInput, reportedById: string): Promise<CreateInvoiceClaimResult> {
  // "Other requires detail" -- category.
  if (claimCategoryRequiresDetail(input.category) && !input.categoryDetail?.trim()) {
    return { ok: false, status: 400, message: "A detail is required when category is OTHER.", fieldErrors: { categoryDetail: "Required when category is OTHER." } };
  }

  const sapInvoice = await prisma.sapInvoice.findUnique({
    where: { id: input.sapInvoiceId },
    select: { id: true, matchedCustomerId: true, isCancelledOrReversed: true },
  });
  if (!sapInvoice) {
    return { ok: false, status: 404, message: "SAP invoice not found." };
  }

  // Spec section 1's "a claim must always be linked to the relevant SAP
  // invoice" does not forbid claiming against a cancelled/reversed
  // invoice outright (a customer can legitimately dispute one), but it is
  // flagged back to the caller so the UI can warn -- never silently
  // blocked here, since that judgment call belongs to the person filing
  // the claim, not to this function.

  // "A claim can never silently contradict Milestone 5's own resolved
  // customer match; it may only supply what M5 left unresolved" (design
  // decision, PROGRESS.md Milestone 6A section).
  if (sapInvoice.matchedCustomerId && sapInvoice.matchedCustomerId !== input.customerId) {
    return {
      ok: false,
      status: 409,
      message: "This invoice is already matched to a different customer; the claim's customer must match the invoice's resolved customer.",
      fieldErrors: { customerId: "Must match this invoice's already-resolved customer." },
    };
  }

  const customer = await prisma.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
  if (!customer) {
    return { ok: false, status: 404, message: "Customer not found." };
  }

  if (input.orderId) {
    const order = await prisma.customerOrder.findUnique({ where: { id: input.orderId }, select: { id: true } });
    if (!order) {
      return { ok: false, status: 404, message: "Order not found." };
    }
  }

  if (input.assignedToId) {
    const assignee = await prisma.user.findUnique({ where: { id: input.assignedToId }, select: { id: true } });
    if (!assignee) {
      return { ok: false, status: 404, message: "Assigned user not found." };
    }
  }

  // Validate every claimed line against the SAP invoice line it targets
  // BEFORE opening the transaction, so a bad line fails fast with a
  // specific field error rather than a generic transaction rollback
  // message. Re-validated again inside the transaction (below) against a
  // transaction-consistent read, since a concurrent claim against the
  // same line could otherwise race between this check and the insert.
  const sapInvoiceLineIds = input.lines.map((line) => line.sapInvoiceLineId);
  const uniqueLineIds = new Set(sapInvoiceLineIds);
  if (uniqueLineIds.size !== sapInvoiceLineIds.length) {
    return { ok: false, status: 400, message: "Each invoice line may only be listed once per claim.", fieldErrors: { lines: "Duplicate invoice line in this claim." } };
  }

  const sapInvoiceLines = await prisma.sapInvoiceLine.findMany({
    where: { id: { in: sapInvoiceLineIds }, sapInvoiceId: input.sapInvoiceId },
    select: { id: true, quantityInvoiced: true, lineTotal: true },
  });
  if (sapInvoiceLines.length !== uniqueLineIds.size) {
    return { ok: false, status: 400, message: "One or more invoice lines do not belong to the specified invoice.", fieldErrors: { lines: "Invalid invoice line reference." } };
  }
  const lineById = new Map(sapInvoiceLines.map((line) => [line.id, line]));

  for (const [index, line] of input.lines.entries()) {
    const sapLine = lineById.get(line.sapInvoiceLineId);
    if (!sapLine) continue; // already reported above

    if (line.disputeType === "QUANTITY") {
      // `prisma` (PrismaClient) satisfies Prisma.TransactionClient
      // structurally -- TransactionClient is PrismaClient minus a few
      // top-level methods (`$transaction`, `$connect`, ...), so every
      // model delegate used here (aggregate) is present with no cast.
      const alreadyClaimed = await getAlreadyClaimedTotal(prisma, line.sapInvoiceLineId);
      const result = validateClaimLineQuantities(sapLine.quantityInvoiced.toString(), alreadyClaimed, line.acceptedQuantity, line.rejectedQuantity);
      if (!result.ok) {
        return { ok: false, status: 400, message: result.message, fieldErrors: { [`lines.${index}`]: result.message } };
      }
    } else {
      const result = validateDisputedAmount(line.disputedAmount, sapLine.lineTotal ? sapLine.lineTotal.toString() : null);
      if (!result.ok) {
        return { ok: false, status: 400, message: result.message, fieldErrors: { [`lines.${index}`]: result.message } };
      }
    }
  }

  const claimReference = generateClaimReference();
  // Non-null: input.claimDate is a required, regex-validated string (zod
  // schema), so dateOnlyStringToUtcDate only returns null for a
  // null/undefined input, which cannot happen here (same `!` convention
  // as lib/price-list-import.ts's validFrom, a required DateTime field).
  const claimDate = dateOnlyStringToUtcDate(input.claimDate)!;

  try {
    const claim = await prisma.$transaction(async (tx) => {
      // Re-check each line's live "already claimed" total inside the
      // transaction, serialized by Postgres's own row locking on the
      // SapInvoiceLine read below, to close the race window between the
      // pre-check above and this insert.
      for (const line of input.lines) {
        if (line.disputeType !== "QUANTITY") continue;
        const sapLine = lineById.get(line.sapInvoiceLineId)!;
        const alreadyClaimed = await getAlreadyClaimedTotal(tx, line.sapInvoiceLineId);
        const result = validateClaimLineQuantities(sapLine.quantityInvoiced.toString(), alreadyClaimed, line.acceptedQuantity, line.rejectedQuantity);
        if (!result.ok) {
          throw new ClaimLineConflictError(result.message);
        }
      }

      const created = await tx.invoiceClaim.create({
        data: {
          claimReference,
          sapInvoiceId: input.sapInvoiceId,
          orderId: input.orderId ?? null,
          customerId: input.customerId,
          customerComplaintReference: input.customerComplaintReference ?? null,
          category: input.category,
          description: claimCategoryRequiresDetail(input.category) ? `${input.description}\n\n[OTHER category detail]: ${input.categoryDetail}` : input.description,
          reportedById,
          assignedToId: input.assignedToId ?? null,
          priority: input.priority ?? "MEDIUM",
          claimDate,
          customerCommunicationNotes: input.customerCommunicationNotes ?? null,
          lines: {
            create: input.lines.map((line) => ({
              sapInvoiceLineId: line.sapInvoiceLineId,
              // sapItemCodeSnapshot/sapItemDescriptionSnapshot: left null
              // here and filled in by the batch update just below, once
              // every line has a real id -- simpler than denormalizing
              // the earlier fetch into this nested-create shape.
              disputeType: line.disputeType,
              acceptedQuantity: line.disputeType === "QUANTITY" ? line.acceptedQuantity : null,
              rejectedQuantity: line.disputeType === "QUANTITY" ? line.rejectedQuantity : null,
              disputedAmount: line.disputeType === "AMOUNT_ONLY" ? line.disputedAmount : null,
              disputedUnitPrice: line.disputedUnitPrice ?? null,
              reason: line.reason,
              evidenceNotes: line.evidenceNotes ?? null,
            })),
          },
        },
        select: { id: true, claimReference: true },
      });

      // Snapshot sapItemCode/sapItemDescription onto each created line for
      // display-without-a-join (schema comment on InvoiceClaimLine) --
      // done as a batch update rather than threaded through the nested
      // create above, since Prisma's nested-create API has no per-row
      // computed-from-elsewhere field.
      const createdLines = await tx.invoiceClaimLine.findMany({ where: { claimId: created.id }, select: { id: true, sapInvoiceLineId: true } });
      const sapLineDetails = await tx.sapInvoiceLine.findMany({
        where: { id: { in: createdLines.map((l) => l.sapInvoiceLineId) } },
        select: { id: true, sapItemCode: true, sapItemDescription: true },
      });
      const sapDetailById = new Map(sapLineDetails.map((d) => [d.id, d]));
      for (const createdLine of createdLines) {
        const detail = sapDetailById.get(createdLine.sapInvoiceLineId);
        if (!detail) continue;
        await tx.invoiceClaimLine.update({
          where: { id: createdLine.id },
          data: { sapItemCodeSnapshot: detail.sapItemCode, sapItemDescriptionSnapshot: detail.sapItemDescription },
        });
      }

      await tx.auditEvent.create({
        data: {
          actorId: reportedById,
          action: "INVOICE_CLAIM_CREATED",
          entityType: "InvoiceClaim",
          entityId: created.id,
          afterData: {
            claimReference: created.claimReference,
            sapInvoiceId: input.sapInvoiceId,
            customerId: input.customerId,
            category: input.category,
            priority: input.priority ?? "MEDIUM",
            lineCount: input.lines.length,
          },
        },
      });

      return created;
    }, TRANSACTION_OPTIONS);

    return { ok: true, id: claim.id, claimReference: claim.claimReference };
  } catch (error) {
    if (error instanceof ClaimLineConflictError) {
      return { ok: false, status: 409, message: error.message };
    }
    throw error;
  }
}

class ClaimLineConflictError extends Error {}
