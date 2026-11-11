import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { findActivePolicies } from "@/lib/approvals/policy-queries";
import { createApprovalRequest, type MutationFailure } from "@/lib/approvals/requests";
import { evaluateQuotationDiscountPolicies, snapshotsMatch, type QuotationApprovalSnapshot } from "@/lib/approvals/validation";

/**
 * Milestone 8 (Validation and Approvals). The ONE integration point
 * lib/quotations/issue.ts calls before it is allowed to set status
 * ISSUED -- see this module's own header comment in prisma/schema.prisma
 * for the overall design. A quotation that never exceeds any active
 * policy's threshold pays zero extra cost here: no row is read beyond
 * the (cheap) active-policy lookup, and nothing is written.
 */

export type QuotationGateResult = { ok: true } | (MutationFailure & { requestId?: string });

/**
 * Always queried through the caller's own transaction client (never the
 * top-level `prisma` singleton) -- both call sites run inside a
 * transaction already holding the per-quotation advisory lock, and
 * reading through a second, unrelated connection here would defeat that
 * lock's whole purpose (serializing every read-decide-write sequence
 * against this exact quotation).
 */
async function buildSnapshot(tx: Prisma.TransactionClient, quotationId: string): Promise<QuotationApprovalSnapshot> {
  const quotation = await tx.quotation.findUniqueOrThrow({
    where: { id: quotationId },
    select: {
      subtotal: true,
      discountTotal: true,
      vatTotal: true,
      total: true,
      currency: true,
      lines: { select: { discountPercent: true } },
    },
  });

  const maxDiscount = quotation.lines.reduce((max, line) => {
    const value = line.discountPercent ?? new Prisma.Decimal(0);
    return value.greaterThan(max) ? value : max;
  }, new Prisma.Decimal(0));

  return {
    maxDiscountPercent: maxDiscount.toString(),
    subtotal: quotation.subtotal.toString(),
    discountTotal: quotation.discountTotal.toString(),
    vatTotal: quotation.vatTotal.toString(),
    total: quotation.total.toString(),
    currency: quotation.currency,
    lineCount: quotation.lines.length,
  };
}

/**
 * Called immediately before lib/quotations/issue.ts writes status
 * ISSUED. Three outcomes:
 *  - no active policy fires on this quotation's current values -> {ok:true},
 *    no row created at all ("normal quotations should not require
 *    unnecessary approval," spec section 4A).
 *  - a live (PENDING, matching-values) or APPROVED-with-matching-values
 *    request already exists -> {ok:true} once it's APPROVED, or a 409
 *    naming the existing PENDING request while it isn't.
 *  - a policy fires with no live matching request (first attempt, or the
 *    prior one is stale/was for different values) -> a fresh PENDING
 *    request is created and a 403 is returned naming it.
 *
 * The whole read-decide-write sequence runs under a Postgres advisory
 * transaction lock keyed by quotationId (spec section 6: "prevent...
 * concurrent approval race conditions" / "duplicate approval
 * submissions") -- two simultaneous attempts to issue the same
 * quotation serialize here rather than both creating a request.
 */
export async function checkAndRequireQuotationApproval(quotationId: string, actorId: string): Promise<QuotationGateResult> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${quotationId}))`;

    const policies = await findActivePolicies("QUOTATIONS", "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD");
    if (policies.length === 0) {
      return { ok: true } as const;
    }

    const snapshot = await buildSnapshot(tx, quotationId);
    const firingPolicy = evaluateQuotationDiscountPolicies(policies, snapshot);
    if (!firingPolicy) {
      return { ok: true } as const;
    }

    const live = await tx.approvalRequest.findFirst({
      where: { quotationId, actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", status: { in: ["PENDING", "APPROVED"] } },
      orderBy: { submittedAt: "desc" },
      select: { id: true, status: true, submittedValues: true, rootRequestId: true },
    });

    if (live) {
      const liveSnapshot = live.submittedValues as unknown as QuotationApprovalSnapshot;
      const matches = snapshotsMatch(liveSnapshot, snapshot);

      if (live.status === "APPROVED" && matches) {
        return { ok: true } as const;
      }
      if (live.status === "PENDING" && matches) {
        return {
          ok: false,
          status: 409,
          message: "This quotation's discount exceeds the configured limit and is already awaiting manager approval.",
          requestId: live.id,
        } as const;
      }

      // Stale -- either an APPROVED request for different values, or a
      // PENDING one the quotation was edited under (lib/quotations/
      // edit.ts's invalidateStaleApprovalRequests should normally have
      // already cancelled this; this is the defensive, belt-and-braces
      // re-check at the point of actual execution, spec section 6).
      const transitionOk = live.status === "PENDING" || live.status === "APPROVED";
      if (transitionOk) {
        await tx.approvalRequest.updateMany({
          where: { id: live.id, status: live.status },
          data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Invalidated: quotation values changed after submission." },
        });
        await tx.approvalEvent.create({ data: { approvalRequestId: live.id, eventType: "INVALIDATED", notes: "Quotation values changed after submission." } });
      }

      const created = await createApprovalRequest(tx, {
        module: "QUOTATIONS",
        actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD",
        quotationId,
        policyId: firingPolicy.id,
        requiredApproverRole: firingPolicy.requiredApproverRole,
        requestedById: actorId,
        submittedValues: snapshot as unknown as Prisma.InputJsonValue,
        previousValues: liveSnapshot as unknown as Prisma.InputJsonValue,
        previousRequestId: live.id,
        rootRequestId: live.rootRequestId ?? live.id,
      });

      return {
        ok: false,
        status: 403,
        message: "This quotation's discount exceeds the configured limit and requires manager approval before it can be issued.",
        requestId: created.id,
      } as const;
    }

    const created = await createApprovalRequest(tx, {
      module: "QUOTATIONS",
      actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD",
      quotationId,
      policyId: firingPolicy.id,
      requiredApproverRole: firingPolicy.requiredApproverRole,
      requestedById: actorId,
      submittedValues: snapshot as unknown as Prisma.InputJsonValue,
    });

    return {
      ok: false,
      status: 403,
      message: "This quotation's discount exceeds the configured limit and requires manager approval before it can be issued.",
      requestId: created.id,
    } as const;
  });
}

/**
 * Called by lib/quotations/edit.ts after every line add/update/remove.
 * Eagerly cancels any live request whose snapshot no longer matches the
 * quotation's current values, so the UI never shows "Approved"/"Pending"
 * against values that have since changed (spec section 4A's
 * invalidation requirement, applied as soon as it's true rather than
 * waiting for the next issue attempt to discover it).
 */
export async function invalidateStaleApprovalRequests(tx: Prisma.TransactionClient, quotationId: string): Promise<void> {
  const live = await tx.approvalRequest.findMany({
    where: { quotationId, actionType: "QUOTATION_DISCOUNT_EXCEEDS_THRESHOLD", status: { in: ["PENDING", "APPROVED"] } },
    select: { id: true, status: true, submittedValues: true },
  });
  if (live.length === 0) return;

  const snapshot = await buildSnapshot(tx, quotationId);

  for (const request of live) {
    const matches = snapshotsMatch(request.submittedValues as unknown as QuotationApprovalSnapshot, snapshot);
    if (matches) continue;

    const { count } = await tx.approvalRequest.updateMany({
      where: { id: request.id, status: request.status },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancellationReason: "Invalidated: quotation values changed after submission." },
    });
    if (count > 0) {
      await tx.approvalEvent.create({ data: { approvalRequestId: request.id, eventType: "INVALIDATED", notes: "Quotation values changed after submission." } });
      await tx.auditEvent.create({
        data: { action: "APPROVAL_REQUEST_INVALIDATED", entityType: "ApprovalRequest", entityId: request.id, afterData: { status: "CANCELLED" } },
      });
    }
  }
}

