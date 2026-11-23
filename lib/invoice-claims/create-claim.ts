import "server-only";
import { randomBytes } from "node:crypto";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import {
  type CreateInvoiceClaimInput,
  validateClaimLineQuantities,
  validateDisputedAmount,
  claimCategoryRequiresDetail,
  isNativeClaimInput,
} from "@/lib/invoice-claims/validation";
import { getAlreadyClaimedTotal, getAlreadyClaimedTotalForOrderLine } from "@/lib/invoice-claims/queries";

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

/**
 * The full validate-then-insert core, written to run against ANY
 * PrismaTransactionClient -- the top-level `prisma` client itself
 * (which satisfies PrismaTransactionClient structurally: see
 * lib/prisma.ts's own module comment -- it's our actual `prisma` export
 * minus a few top-level methods like `$transaction`/`$connect`, so every
 * model delegate used here is present with no cast), or the `tx` handed
 * to an ALREADY-OPEN transaction's callback.
 *
 * This split exists for the Final Operational Enhancements spec (Part 5):
 * recording an invoice's delivery outcome as "With Claim" must create the
 * InvoiceDeliveryRecord and one-or-more linked InvoiceClaim rows
 * atomically in a single transaction (lib/invoice-delivery/record-outcome.ts),
 * and Prisma has no nested transactions -- so that caller needs this exact
 * validation+insert logic runnable against ITS OWN already-open `tx`,
 * not a second one. createInvoiceClaim() below is the original,
 * standalone entry point, now just a one-line wrapper that opens its own
 * transaction and delegates to this function.
 *
 * Every check that used to run once "fast" before a transaction and then
 * again "for real" inside it has been collapsed into a single pass here
 * -- correct either way (nothing is written until every check has
 * passed), and now unconditionally serialized by whichever transaction
 * the caller is already inside.
 *
 * invoiceDeliveryRecordId is optional and the one genuinely new piece:
 * when provided, it is persisted on the created claim so it is traceable
 * back to the delivery-outcome recording that created it. Every other
 * field, check and error shape below is unchanged Milestone 6A logic.
 */
export async function createInvoiceClaimCore(
  tx: PrismaTransactionClient,
  input: CreateInvoiceClaimInput,
  reportedById: string,
  invoiceDeliveryRecordId?: string
): Promise<CreateInvoiceClaimResult> {
  // "Other requires detail" -- category. Shared by both linkage paths.
  if (claimCategoryRequiresDetail(input.category) && !input.categoryDetail?.trim()) {
    return { ok: false, status: 400, message: "A detail is required when category is OTHER.", fieldErrors: { categoryDetail: "Required when category is OTHER." } };
  }

  // Real-world fix (native Invoice Claims): createInvoiceClaimSchema's
  // own refine() already guarantees input.orderId is set whenever
  // input.sapInvoiceId is absent, and that every line's linkage matches
  // -- see that schema's comment. Dispatching here, rather than
  // interleaving two branches through one long function, keeps each
  // path's SAP-specific or order-specific lookups/validation together
  // and readable, the same way this project has always preferred a
  // small duplicated helper over one shared function straining to cover
  // two genuinely different shapes (lib/customers.ts's isUniqueViolation
  // precedent).
  if (isNativeClaimInput(input)) {
    return createNativeAnchoredClaimCore(tx, input, reportedById, invoiceDeliveryRecordId);
  }
  return createSapAnchoredClaimCore(tx, input, reportedById, invoiceDeliveryRecordId);
}

async function createSapAnchoredClaimCore(
  tx: PrismaTransactionClient,
  input: CreateInvoiceClaimInput,
  reportedById: string,
  invoiceDeliveryRecordId?: string
): Promise<CreateInvoiceClaimResult> {
  // Non-null: createInvoiceClaimSchema's refine() guarantees sapInvoiceId
  // is set whenever this branch (dispatched from createInvoiceClaimCore
  // via isNativeClaimInput) is reached.
  const sapInvoiceId = input.sapInvoiceId!;

  const sapInvoice = await tx.sapInvoice.findUnique({
    where: { id: sapInvoiceId },
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

  const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
  if (!customer) {
    return { ok: false, status: 404, message: "Customer not found." };
  }

  if (input.orderId) {
    const order = await tx.customerOrder.findUnique({ where: { id: input.orderId }, select: { id: true } });
    if (!order) {
      return { ok: false, status: 404, message: "Order not found." };
    }
  }

  if (input.assignedToId) {
    const assignee = await tx.user.findUnique({ where: { id: input.assignedToId }, select: { id: true } });
    if (!assignee) {
      return { ok: false, status: 404, message: "Assigned user not found." };
    }
  }

  const sapInvoiceLineIds = input.lines.map((line) => line.sapInvoiceLineId!);
  const uniqueLineIds = new Set(sapInvoiceLineIds);
  if (uniqueLineIds.size !== sapInvoiceLineIds.length) {
    return { ok: false, status: 400, message: "Each invoice line may only be listed once per claim.", fieldErrors: { lines: "Duplicate invoice line in this claim." } };
  }

  const sapInvoiceLines = await tx.sapInvoiceLine.findMany({
    where: { id: { in: sapInvoiceLineIds }, sapInvoiceId },
    select: { id: true, quantityInvoiced: true, lineTotal: true },
  });
  if (sapInvoiceLines.length !== uniqueLineIds.size) {
    return { ok: false, status: 400, message: "One or more invoice lines do not belong to the specified invoice.", fieldErrors: { lines: "Invalid invoice line reference." } };
  }
  const lineById = new Map(sapInvoiceLines.map((line) => [line.id, line]));

  // Each line's quantity/amount is validated against the SAME `tx` that
  // will perform the insert below -- the already-claimed aggregate read
  // (getAlreadyClaimedTotal) and this transaction's own insert are the
  // same unit of work, which is what actually closes the race between two
  // concurrent claims against the same invoice line (not merely "checking
  // twice").
  for (const [index, line] of input.lines.entries()) {
    const sapLine = lineById.get(line.sapInvoiceLineId!);
    if (!sapLine) continue; // already reported above via the count mismatch

    if (line.disputeType === "QUANTITY") {
      const alreadyClaimed = await getAlreadyClaimedTotal(tx, line.sapInvoiceLineId!);
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

  const created = await tx.invoiceClaim.create({
    data: {
      claimReference,
      sapInvoiceId,
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
      // Final Operational Enhancements (spec Part 5): traceability back to
      // the InvoiceDeliveryRecord this claim was created alongside, when
      // this call came from recordInvoiceDeliveryOutcome() rather than the
      // standalone /invoice-claims/new form.
      invoiceDeliveryRecordId: invoiceDeliveryRecordId ?? null,
      lines: {
        create: input.lines.map((line) => ({
          sapInvoiceLineId: line.sapInvoiceLineId!,
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
          // Final Operational Enhancements (spec Part 6): the one new
          // claim-line field -- a distinguishable category drawn from the
          // 10 named claim reasons, reusing the existing 3 categories
          // where they already matched (see lib/invoice-claims/validation.ts's
          // CLAIM_CATEGORIES comment). Independent of `reason` (free text)
          // and of the claim-level `category` enum above -- this is a
          // per-LINE classification, since a single claim/invoice can
          // legitimately mix reasons across its lines.
          reasonCategory: line.reasonCategory ?? null,
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
    where: { id: { in: createdLines.flatMap((l) => (l.sapInvoiceLineId ? [l.sapInvoiceLineId] : [])) } },
    select: { id: true, sapItemCode: true, sapItemDescription: true },
  });
  const sapDetailById = new Map(sapLineDetails.map((d) => [d.id, d]));
  for (const createdLine of createdLines) {
    if (!createdLine.sapInvoiceLineId) continue;
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
        sapInvoiceId,
        customerId: input.customerId,
        category: input.category,
        priority: input.priority ?? "MEDIUM",
        lineCount: input.lines.length,
        invoiceDeliveryRecordId: invoiceDeliveryRecordId ?? null,
      },
    },
  });

  return { ok: true, id: created.id, claimReference: created.claimReference };
}

/**
 * Real-world fix (native Invoice Claims): the order-anchored twin of
 * createSapAnchoredClaimCore above, for a claim with no SapInvoice at
 * all -- "Invoice Claims Management are invoices that have products that
 * have been return[ed]... not a file to be imported[,] nothing is coming
 * from sap." Mirrors that function's structure and every one of its
 * guarantees (role-agnostic, snapshot-for-display, same-transaction
 * already-claimed check, audit event) against this business's own
 * CustomerOrder/OrderLine data instead of SapInvoice/SapInvoiceLine.
 *
 * The one new substantive rule (not present on the SAP path, which
 * implicitly gets this for free -- a SapInvoiceLine can only exist for a
 * line SAP itself has already invoiced): a targeted OrderLine must have
 * at least one DispatchLine, i.e. it must have actually been dispatched.
 * This is what keeps lib/reporting/financial-exposure.ts's Source A
 * (claims) and Source B (UnfulfilledDemand, "never dispatched or
 * invoiced") disjoint for a native claim exactly the way the schema
 * itself already guarantees it for a SAP-anchored one -- see that file's
 * own updated module comment.
 */
async function createNativeAnchoredClaimCore(
  tx: PrismaTransactionClient,
  input: CreateInvoiceClaimInput,
  reportedById: string,
  invoiceDeliveryRecordId?: string
): Promise<CreateInvoiceClaimResult> {
  // Non-null: createInvoiceClaimSchema's refine() guarantees orderId is
  // set whenever this branch (dispatched from createInvoiceClaimCore via
  // isNativeClaimInput) is reached.
  const orderId = input.orderId!;

  const order = await tx.customerOrder.findUnique({
    where: { id: orderId },
    select: { id: true, customerId: true },
  });
  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }

  // Unlike SapInvoice.matchedCustomerId (nullable -- an invoice Milestone
  // 5 never matched), CustomerOrder.customerId is never null: this
  // business always knows who its own order belongs to, so this check is
  // unconditional, not an `if (set && differs)` guard.
  if (order.customerId !== input.customerId) {
    return {
      ok: false,
      status: 409,
      message: "This order belongs to a different customer; the claim's customer must match the order's own customer.",
      fieldErrors: { customerId: "Must match this order's own customer." },
    };
  }

  const customer = await tx.customer.findUnique({ where: { id: input.customerId }, select: { id: true } });
  if (!customer) {
    return { ok: false, status: 404, message: "Customer not found." };
  }

  if (input.assignedToId) {
    const assignee = await tx.user.findUnique({ where: { id: input.assignedToId }, select: { id: true } });
    if (!assignee) {
      return { ok: false, status: 404, message: "Assigned user not found." };
    }
  }

  const orderLineIds = input.lines.map((line) => line.orderLineId!);
  const uniqueLineIds = new Set(orderLineIds);
  if (uniqueLineIds.size !== orderLineIds.length) {
    return { ok: false, status: 400, message: "Each order line may only be listed once per claim.", fieldErrors: { lines: "Duplicate order line in this claim." } };
  }

  const orderLines = await tx.orderLine.findMany({
    where: { id: { in: orderLineIds }, orderId },
    select: {
      id: true,
      requestedQuantity: true,
      lineTotal: true,
      // A claim may only target a line that has actually gone out --
      // see this function's own module comment.
      dispatchLines: { select: { id: true }, take: 1 },
    },
  });
  if (orderLines.length !== uniqueLineIds.size) {
    return { ok: false, status: 400, message: "One or more order lines do not belong to the specified order.", fieldErrors: { lines: "Invalid order line reference." } };
  }
  const lineById = new Map(orderLines.map((line) => [line.id, line]));

  for (const [index, line] of input.lines.entries()) {
    const orderLine = lineById.get(line.orderLineId!);
    if (!orderLine) continue; // already reported above via the count mismatch

    if (orderLine.dispatchLines.length === 0) {
      return {
        ok: false,
        status: 400,
        message: "This order line has not been dispatched yet; a claim can only be raised against a line that has actually gone out.",
        fieldErrors: { [`lines.${index}`]: "This order line has not been dispatched yet." },
      };
    }

    if (line.disputeType === "QUANTITY") {
      const alreadyClaimed = await getAlreadyClaimedTotalForOrderLine(tx, line.orderLineId!);
      const result = validateClaimLineQuantities(orderLine.requestedQuantity.toString(), alreadyClaimed, line.acceptedQuantity, line.rejectedQuantity);
      if (!result.ok) {
        return { ok: false, status: 400, message: result.message, fieldErrors: { [`lines.${index}`]: result.message } };
      }
    } else {
      const result = validateDisputedAmount(line.disputedAmount, orderLine.lineTotal ? orderLine.lineTotal.toString() : null);
      if (!result.ok) {
        return { ok: false, status: 400, message: result.message, fieldErrors: { [`lines.${index}`]: result.message } };
      }
    }
  }

  const claimReference = generateClaimReference();
  const claimDate = dateOnlyStringToUtcDate(input.claimDate)!;

  const created = await tx.invoiceClaim.create({
    data: {
      claimReference,
      sapInvoiceId: null,
      orderId,
      customerId: input.customerId,
      customerComplaintReference: input.customerComplaintReference ?? null,
      category: input.category,
      description: claimCategoryRequiresDetail(input.category) ? `${input.description}\n\n[OTHER category detail]: ${input.categoryDetail}` : input.description,
      reportedById,
      assignedToId: input.assignedToId ?? null,
      priority: input.priority ?? "MEDIUM",
      claimDate,
      customerCommunicationNotes: input.customerCommunicationNotes ?? null,
      invoiceDeliveryRecordId: invoiceDeliveryRecordId ?? null,
      lines: {
        create: input.lines.map((line) => ({
          orderLineId: line.orderLineId!,
          // sapItemCodeSnapshot/sapItemDescriptionSnapshot: reused for a
          // native line too (never a second pair of columns) -- filled
          // in by the batch update just below from the order line's own
          // sapItemCodeSnapshot/originalProductDescription, same
          // "snapshot for display, re-read live for math" split as the
          // SAP path.
          disputeType: line.disputeType,
          acceptedQuantity: line.disputeType === "QUANTITY" ? line.acceptedQuantity : null,
          rejectedQuantity: line.disputeType === "QUANTITY" ? line.rejectedQuantity : null,
          disputedAmount: line.disputeType === "AMOUNT_ONLY" ? line.disputedAmount : null,
          disputedUnitPrice: line.disputedUnitPrice ?? null,
          reason: line.reason,
          reasonCategory: line.reasonCategory ?? null,
          evidenceNotes: line.evidenceNotes ?? null,
        })),
      },
    },
    select: { id: true, claimReference: true },
  });

  const createdLines = await tx.invoiceClaimLine.findMany({ where: { claimId: created.id }, select: { id: true, orderLineId: true } });
  const orderLineDetails = await tx.orderLine.findMany({
    where: { id: { in: createdLines.map((l) => l.orderLineId!) } },
    select: { id: true, sapItemCodeSnapshot: true, originalProductDescription: true },
  });
  const orderLineDetailById = new Map(orderLineDetails.map((d) => [d.id, d]));
  for (const createdLine of createdLines) {
    const detail = createdLine.orderLineId ? orderLineDetailById.get(createdLine.orderLineId) : undefined;
    if (!detail) continue;
    await tx.invoiceClaimLine.update({
      where: { id: createdLine.id },
      data: { sapItemCodeSnapshot: detail.sapItemCodeSnapshot, sapItemDescriptionSnapshot: detail.originalProductDescription },
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
        orderId,
        customerId: input.customerId,
        category: input.category,
        priority: input.priority ?? "MEDIUM",
        lineCount: input.lines.length,
        invoiceDeliveryRecordId: invoiceDeliveryRecordId ?? null,
      },
    },
  });

  return { ok: true, id: created.id, claimReference: created.claimReference };
}

export async function createInvoiceClaim(input: CreateInvoiceClaimInput, reportedById: string): Promise<CreateInvoiceClaimResult> {
  return prisma.$transaction((tx) => createInvoiceClaimCore(tx, input, reportedById), TRANSACTION_OPTIONS);
}
