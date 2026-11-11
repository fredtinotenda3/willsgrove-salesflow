import "server-only";
import { prisma } from "@/lib/prisma";
import { isUniqueViolation } from "@/lib/orders";
import { checkOrderEligibility, type OrderEligibilityBlocker } from "@/lib/integrations/sap/order-eligibility";
import { getSapAdapter } from "@/lib/integrations/sap/get-adapter";
import { SapAdapterError, type SapSalesOrderSubmission } from "@/lib/integrations/sap/types";
import { sanitizeSapErrorMessage } from "@/lib/integrations/sap/config";
import type { Prisma } from "@prisma/client";

/**
 * Milestone 9 (SAP Business One Integration). The outbox/idempotency
 * mechanism for submitting a CustomerOrder to SAP as a sales order --
 * spec section 7's reliability requirements, and section 7.2's CRITICAL
 * "a network timeout does not prove the request was rejected" scenario.
 *
 * One IntegrationOperation row per order, ever (customerOrderId is
 * @unique at the database level -- prisma/schema.prisma). Every
 * attempt -- the first submission, a retry after a FAILED attempt, or
 * SAP itself returning the same idempotencyKey a second time -- updates
 * this SAME row; nothing in this file ever creates a second row for an
 * order that already has one.
 *
 * State machine (IntegrationOperationStatus):
 *   PENDING -> PROCESSING -> SUCCEEDED   (adapter call returned a result)
 *                          -> FAILED     (a definite, non-ambiguous rejection -- safe to fix and retry)
 *                          -> UNCERTAIN  (a TIMEOUT -- the request may have reached SAP; NEVER auto-retried)
 *   UNCERTAIN -> SUCCEEDED   (reconcileUncertainOperation found the order after all)
 *   UNCERTAIN -> FAILED      (a human used resolveUncertainOperation to confirm it was never created)
 *   FAILED -> PROCESSING -> SUCCEEDED/FAILED/UNCERTAIN   (retrySubmission, same submittedSnapshot, every time)
 */

export type SubmitOrderResult =
  | { ok: true; operationId: string; status: "SUCCEEDED"; sapDocEntry: string; sapDocNum: string }
  | { ok: true; operationId: string; status: "UNCERTAIN" }
  | { ok: false; reason: "NOT_ELIGIBLE"; blockers: OrderEligibilityBlocker[] }
  | { ok: false; reason: "SUBMISSION_FAILED"; operationId: string; errorCategory: string; errorMessage: string };

/**
 * Creates the outbox row (or finds the one a concurrent request just
 * created -- the unique constraint on customerOrderId is the actual
 * race guard, this is just surfacing it honestly rather than crashing)
 * and performs the first submission attempt.
 */
export async function submitOrderToSap(orderId: string): Promise<SubmitOrderResult> {
  const eligibility = await checkOrderEligibility(orderId);
  if (!eligibility.eligible || !eligibility.submission) {
    return { ok: false, reason: "NOT_ELIGIBLE", blockers: eligibility.blockers };
  }

  const operation = await createOrFindOutboxRow(orderId, eligibility.submission);
  return attemptSubmission(operation.id, eligibility.submission);
}

async function createOrFindOutboxRow(orderId: string, submission: SapSalesOrderSubmission) {
  try {
    return await prisma.integrationOperation.create({
      data: {
        operationType: "SALES_ORDER_SUBMISSION",
        status: "PENDING",
        idempotencyKey: submission.idempotencyKey,
        customerOrderId: orderId,
        submittedSnapshot: submission as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const existing = await prisma.integrationOperation.findUnique({ where: { customerOrderId: orderId } });
      if (existing) return existing;
    }
    throw error;
  }
}

/** Re-attempts an EXISTING outbox row -- a FAILED submission whose
 * underlying cause has since been fixed (e.g. a customer/product
 * mapping that has now been synced from SAP). Always resubmits the
 * row's own immutable `submittedSnapshot`, never a freshly recomputed
 * one -- see this module's own comment and the schema's. Refuses to
 * retry a SUCCEEDED row (nothing to do) or an UNCERTAIN row (must go
 * through reconcileUncertainOperation/resolveUncertainOperation first,
 * never a blind resubmit of a request that may have already landed). */
export async function retrySubmission(operationId: string): Promise<SubmitOrderResult> {
  const operation = await prisma.integrationOperation.findUnique({ where: { id: operationId } });
  if (!operation) throw new Error(`IntegrationOperation ${operationId} not found.`);
  if (operation.status === "SUCCEEDED") {
    return { ok: true, operationId, status: "SUCCEEDED", sapDocEntry: operation.externalDocEntry ?? "", sapDocNum: operation.externalDocNum ?? "" };
  }
  if (operation.status === "UNCERTAIN") {
    throw new Error("Cannot blindly retry an UNCERTAIN submission -- reconcile or resolve it first.");
  }

  const submission = operation.submittedSnapshot as unknown as SapSalesOrderSubmission;
  return attemptSubmission(operationId, submission);
}

async function attemptSubmission(operationId: string, submission: SapSalesOrderSubmission): Promise<SubmitOrderResult> {
  await prisma.integrationOperation.update({
    where: { id: operationId },
    data: { status: "PROCESSING", attemptCount: { increment: 1 }, lastAttemptAt: new Date() },
  });

  const adapter = await getSapAdapter();

  try {
    const result = await adapter.createSalesOrder(submission);
    await prisma.integrationOperation.update({
      where: { id: operationId },
      data: {
        status: "SUCCEEDED",
        externalDocEntry: result.sapDocEntry,
        externalDocNum: result.sapDocNum,
        resolvedAt: new Date(),
        lastErrorCategory: null,
        lastErrorMessage: null,
      },
    });
    return { ok: true, operationId, status: "SUCCEEDED", sapDocEntry: result.sapDocEntry, sapDocNum: result.sapDocNum };
  } catch (error) {
    const sapError =
      error instanceof SapAdapterError
        ? error
        : new SapAdapterError("INTERNAL_ERROR", sanitizeSapErrorMessage(error instanceof Error ? error.message : String(error)));

    // TIMEOUT is the one category spec section 7.2 says must NEVER be
    // treated as a definite failure: whether SAP received and processed
    // the request cannot be known from a lost response alone. Every
    // other category is a real, interpretable answer from SAP (or from
    // never having reached it at all, for NETWORK_UNAVAILABLE), so FAILED
    // is honest for those -- and still safe to retry once the underlying
    // cause is fixed, via retrySubmission above.
    const status = sapError.category === "TIMEOUT" ? "UNCERTAIN" : "FAILED";

    await prisma.integrationOperation.update({
      where: { id: operationId },
      data: {
        status,
        lastErrorCategory: sapError.category,
        lastErrorMessage: sapError.message,
        resolvedAt: null, // never auto-resolved on failure -- a human (retrySubmission after a fix, or resolveUncertainOperation) closes this out either way
      },
    });

    if (status === "UNCERTAIN") return { ok: true, operationId, status: "UNCERTAIN" };
    return { ok: false, reason: "SUBMISSION_FAILED", operationId, errorCategory: sapError.category, errorMessage: sapError.message };
  }
}

export type ReconciliationResult =
  | { outcome: "FOUND"; sapDocEntry: string; sapDocNum: string }
  | { outcome: "NOT_FOUND" };

/**
 * For an UNCERTAIN row: asks the adapter to look the order up by its own
 * reference (not a resubmission -- a read-only lookup, spec section
 * 5.1/7.2). A FOUND result means the order really was created by the
 * earlier, lost-response attempt, and this resolves the row to
 * SUCCEEDED automatically (that part is safe -- it is the SAME
 * information a human reconciling it by hand would use). A NOT_FOUND
 * result does NOT mean the order was never created -- only that this
 * lookup didn't find it (the mock adapter's own module comment
 * illustrates exactly this ambiguity) -- so the row is left UNCERTAIN
 * and a human must use resolveUncertainOperation below.
 */
export async function reconcileUncertainOperation(operationId: string): Promise<ReconciliationResult> {
  const operation = await prisma.integrationOperation.findUnique({ where: { id: operationId } });
  if (!operation) throw new Error(`IntegrationOperation ${operationId} not found.`);
  if (operation.status !== "UNCERTAIN") throw new Error(`IntegrationOperation ${operationId} is not UNCERTAIN (status: ${operation.status}).`);

  const submission = operation.submittedSnapshot as unknown as SapSalesOrderSubmission;
  const adapter = await getSapAdapter();
  const found = await adapter.findSalesOrderByExternalReference(submission.idempotencyKey, submission.customerOrderReference);

  if (found) {
    await prisma.integrationOperation.update({
      where: { id: operationId },
      data: { status: "SUCCEEDED", externalDocEntry: found.sapDocEntry, externalDocNum: found.sapDocNum, resolvedAt: new Date() },
    });
    return { outcome: "FOUND", sapDocEntry: found.sapDocEntry, sapDocNum: found.sapDocNum };
  }

  return { outcome: "NOT_FOUND" };
}

/**
 * A human's own decision on an UNCERTAIN row that reconciliation alone
 * could not resolve (spec section 7.2: "requires an authorised human
 * decision, never an automatic resubmission"). `confirmedCreated` with a
 * `sapDocEntry` the human found by looking directly in SAP closes the
 * row as SUCCEEDED; `confirmedCreated: false` (the human has verified,
 * directly in SAP, that no such order exists) closes it as FAILED --
 * which then makes it eligible for an ordinary retrySubmission.
 */
export async function resolveUncertainOperation(
  operationId: string,
  decidedById: string,
  decision: { confirmedCreated: true; sapDocEntry: string; sapDocNum: string } | { confirmedCreated: false; notes: string }
): Promise<void> {
  const operation = await prisma.integrationOperation.findUnique({ where: { id: operationId } });
  if (!operation) throw new Error(`IntegrationOperation ${operationId} not found.`);
  if (operation.status !== "UNCERTAIN") throw new Error(`IntegrationOperation ${operationId} is not UNCERTAIN (status: ${operation.status}).`);

  await prisma.$transaction(async (tx) => {
    if (decision.confirmedCreated) {
      await tx.integrationOperation.update({
        where: { id: operationId },
        data: { status: "SUCCEEDED", externalDocEntry: decision.sapDocEntry, externalDocNum: decision.sapDocNum, resolvedAt: new Date() },
      });
    } else {
      await tx.integrationOperation.update({
        where: { id: operationId },
        data: { status: "FAILED", lastErrorMessage: `Manually confirmed not created in SAP: ${decision.notes}`, resolvedAt: new Date() },
      });
    }

    await tx.auditEvent.create({
      data: {
        actorId: decidedById,
        action: "SAP_UNCERTAIN_SUBMISSION_RESOLVED",
        entityType: "IntegrationOperation",
        entityId: operationId,
        beforeData: { status: "UNCERTAIN" },
        afterData: decision.confirmedCreated
          ? { status: "SUCCEEDED", sapDocEntry: decision.sapDocEntry }
          : { status: "FAILED", notes: decision.notes },
      },
    });
  });
}
