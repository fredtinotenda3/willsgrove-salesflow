import "server-only";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { utcDateToDateOnlyString } from "@/lib/dates";
import { isEligibleForExpiry, validateQuotationStatusTransition } from "@/lib/quotations/validation";
import type { MutationFailure } from "@/lib/quotations/create";

/**
 * Milestone 7. Expiry (spec section 5): "a quotation becomes eligible
 * for expiry when its validity date passes. Do not rely only on a UI
 * label. Implement a reliable server-side status calculation or
 * controlled expiry mechanism... do not silently modify historical
 * records."
 *
 * This architecture has no background job runner (every other milestone
 * in this codebase is a synchronous, request-driven Next.js app -- there
 * is no existing cron/queue infrastructure to hook into), so the ACTUAL
 * DRAFT->EXPIRED write only ever happens through this file's explicit,
 * audited actions -- never a side effect of merely reading/listing a
 * quotation. Two ways to trigger it, both calling the exact same
 * function so neither can drift from the other:
 *   1. expireQuotation() for one quotation, exposed as a UI action
 *      (no dedicated role -- this is a mechanical, date-based fact, same
 *      tier as every other "no dedicated role" action in this project,
 *      never a judgment call).
 *   2. sweepExpiredQuotations(), called by scripts/expire-quotations.ts
 *      -- a standalone script following this project's existing
 *      scripts/remove-demo-data.ts convention, meant to be run on a real
 *      schedule (Windows Task Scheduler / cron) on a real deployment.
 *      See SETUP-WINDOWS.md for exact commands.
 *
 * Until one of these actually runs, list/dashboard views still show the
 * TRUE picture live: lib/quotations/queries.ts's own counts use
 * isEligibleForExpiry() directly wherever "overdue" matters, rather than
 * trusting a possibly-stale `status` column -- "do not rely only on a UI
 * label" is satisfied by computing the real-time fact everywhere it is
 * displayed, not only by (eventually) writing it to the database.
 */

export type ExpireQuotationResult = { ok: true } | MutationFailure;

export async function expireQuotation(quotationId: string, actorId: string | null): Promise<ExpireQuotationResult> {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true, status: true, validUntil: true } });
  if (!quotation) {
    return { ok: false, status: 404, message: "Quotation not found." };
  }

  const transition = validateQuotationStatusTransition(quotation.status, "EXPIRED");
  if (!transition.ok) {
    return { ok: false, status: 409, message: transition.message };
  }

  const today = utcDateToDateOnlyString(new Date())!;
  const validUntilStr = utcDateToDateOnlyString(quotation.validUntil)!;
  if (!isEligibleForExpiry(quotation.status, validUntilStr, today)) {
    return { ok: false, status: 400, message: `This quotation's validity date (${validUntilStr}) has not yet passed.` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.quotation.update({ where: { id: quotationId }, data: { status: "EXPIRED", expiredAt: new Date() } });
    await tx.quotationEvent.create({ data: { quotationId, eventType: "EXPIRED", actorId, notes: `Validity date ${validUntilStr} passed.` } });
    await tx.auditEvent.create({ data: { actorId, action: "QUOTATION_EXPIRED", entityType: "Quotation", entityId: quotationId, beforeData: { status: quotation.status }, afterData: { status: "EXPIRED" } } });
  }, TRANSACTION_OPTIONS);

  return { ok: true };
}

export type SweepExpiredQuotationsResult = { expiredCount: number; expiredQuotationNumbers: string[] };

/**
 * Finds every ISSUED quotation whose validUntil has passed and expires
 * each one, sequentially (same "sequential, not Promise.all, across one
 * pooled connection" convention as scripts/remove-demo-data.ts -- see
 * that file's own comment on Prisma's interactive-transaction timeout
 * under real network latency). actorId is null here (no human initiated
 * this -- it is either an unattended scheduled run or a system sweep),
 * consistent with AuditEvent.actorId already being nullable for exactly
 * this reason.
 */
export async function sweepExpiredQuotations(): Promise<SweepExpiredQuotationsResult> {
  const today = utcDateToDateOnlyString(new Date())!;
  const candidates = await prisma.quotation.findMany({
    where: { status: "ISSUED", validUntil: { lt: new Date(`${today}T00:00:00.000Z`) } },
    select: { id: true, quotationNumber: true },
  });

  const expiredQuotationNumbers: string[] = [];
  for (const candidate of candidates) {
    const result = await expireQuotation(candidate.id, null);
    if (result.ok) {
      expiredQuotationNumbers.push(candidate.quotationNumber);
    }
  }

  return { expiredCount: expiredQuotationNumbers.length, expiredQuotationNumbers };
}
