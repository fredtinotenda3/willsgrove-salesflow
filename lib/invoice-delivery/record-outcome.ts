import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import type { RecordInvoiceDeliveryOutcomeInput } from "@/lib/invoice-delivery/validation";
import { createInvoiceClaimCore, type CreateInvoiceClaimResult } from "@/lib/invoice-claims/create-claim";

/**
 * Final Operational Enhancements (spec Part 5). Any authenticated user
 * may record a delivery outcome -- recording what happened on a delivery
 * is an operational record, same role-agnostic precedent this project
 * already follows for recording a dispatch's delivery (lib/fulfilment/
 * delivery.ts) and for filing an invoice claim (lib/invoice-claims/
 * create-claim.ts's own comment); only approval-weight actions (e.g.
 * approving a claim resolution) are role-restricted, at the route layer.
 */

export type RecordInvoiceDeliveryOutcomeResult =
  | { ok: true; id: string; outcome: RecordInvoiceDeliveryOutcomeInput["outcome"]; claimIds: string[] }
  | { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };

const UNIQUE_CONSTRAINT_VIOLATION = "P2002";

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === UNIQUE_CONSTRAINT_VIOLATION;
}

/**
 * Records the delivery outcome for one SAP invoice: "No Claim" (an
 * explicit record that nothing was wrong -- never just the absence of a
 * claim) or "With Claim" (one-or-more InvoiceClaim records, created in
 * the SAME transaction as the InvoiceDeliveryRecord itself, so a
 * mid-request failure can never leave one without the other). This is
 * what the /invoice-reconciliation UI's "Ready for Invoice" -> "Delivered"
 * transition is gated on (lib/invoice-delivery/queries.ts derives that
 * status by whether a record exists here) -- SAP's own
 * reconciliationStatus on SapInvoice is never written to by this
 * function; this is a wholly separate, SalesFlow-only workflow status.
 */
export async function recordInvoiceDeliveryOutcome(
  sapInvoiceId: string,
  actorId: string,
  input: RecordInvoiceDeliveryOutcomeInput
): Promise<RecordInvoiceDeliveryOutcomeResult> {
  const sapInvoice = await prisma.sapInvoice.findUnique({
    where: { id: sapInvoiceId },
    select: { id: true, matchedCustomerId: true, matchedOrderId: true },
  });
  if (!sapInvoice) {
    return { ok: false, status: 404, message: "SAP invoice not found." };
  }

  // Duplicate-return prevention, fast path -- the unique constraint on
  // InvoiceDeliveryRecord.sapInvoiceId (prisma/schema.prisma) is the real
  // guarantee against a concurrent double-submit (caught below as
  // P2002); this pre-check only turns the common, non-racing case into a
  // clean 409 rather than a generic 500.
  const existing = await prisma.invoiceDeliveryRecord.findUnique({ where: { sapInvoiceId }, select: { id: true } });
  if (existing) {
    return { ok: false, status: 409, message: "A delivery outcome has already been recorded for this invoice." };
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const deliveryRecord = await tx.invoiceDeliveryRecord.create({
        data: {
          sapInvoiceId,
          outcome: input.outcome,
          podReference: input.podReference ?? null,
          notes: input.notes ?? null,
          recordedById: actorId,
        },
        select: { id: true },
      });

      const claimIds: string[] = [];
      if (input.outcome === "WITH_CLAIM") {
        for (const [index, claimInput] of input.claims.entries()) {
          const resolvedCustomerId = claimInput.customerId || sapInvoice.matchedCustomerId;
          if (!resolvedCustomerId) {
            throw new DeliveryClaimValidationError(index, {
              ok: false,
              status: 400,
              message: "This invoice has no resolved customer -- a customerId is required for this claim.",
              fieldErrors: { customerId: "Required: this invoice has no resolved customer." },
            });
          }

          // sapInvoiceId is always this invoice's own id -- never taken
          // from the request body (see lib/invoice-delivery/
          // validation.ts's own comment on why that field was omitted
          // from the per-claim schema). orderId defaults to the
          // invoice's own matched order when the caller didn't specify
          // one explicitly, so a claim recorded here is linked to the
          // same order the invoice itself resolved to wherever possible,
          // without forcing the caller to re-supply something this
          // function already knows.
          const fullClaimInput = {
            ...claimInput,
            sapInvoiceId,
            orderId: claimInput.orderId ?? sapInvoice.matchedOrderId ?? undefined,
            customerId: resolvedCustomerId,
          };

          const claimResult: CreateInvoiceClaimResult = await createInvoiceClaimCore(tx, fullClaimInput, actorId, deliveryRecord.id);
          if (!claimResult.ok) {
            throw new DeliveryClaimValidationError(index, claimResult);
          }
          claimIds.push(claimResult.id);
        }
      }

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "INVOICE_DELIVERY_OUTCOME_RECORDED",
          entityType: "InvoiceDeliveryRecord",
          entityId: deliveryRecord.id,
          afterData: { sapInvoiceId, outcome: input.outcome, claimIds },
        },
      });

      return { id: deliveryRecord.id, claimIds };
    }, TRANSACTION_OPTIONS);

    return { ok: true, id: result.id, outcome: input.outcome, claimIds: result.claimIds };
  } catch (error) {
    if (error instanceof DeliveryClaimValidationError) {
      const inner = error.result;
      return {
        ok: false,
        status: inner.status,
        message: `Claim ${error.index + 1}: ${inner.message}`,
        fieldErrors: inner.fieldErrors,
      };
    }
    if (isUniqueViolation(error)) {
      return { ok: false, status: 409, message: "A delivery outcome has already been recorded for this invoice." };
    }
    throw error;
  }
}

class DeliveryClaimValidationError extends Error {
  constructor(public readonly index: number, public readonly result: Extract<CreateInvoiceClaimResult, { ok: false }>) {
    super(result.message);
  }
}
