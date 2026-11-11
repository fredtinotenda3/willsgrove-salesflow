import "server-only";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { dateOnlyStringToUtcDate } from "@/lib/dates";
import { parseScaledDecimal } from "@/lib/picking/validation";
import { recomputeClaimStatusAfterActuals } from "@/lib/returns-credits/apply-status-recompute";
import type {
  RecordCreditNoteManualInput,
  ManuallyMatchCreditNoteInput,
} from "@/lib/returns-credits/validation";

/**
 * Milestone 6B (Returns & Credit Notes). Recording that SAP has actually
 * issued a credit note, and resolving an imported credit note's match to
 * a claim. Confirmed design decision: SALES_MANAGER/ADMINISTRATOR only --
 * this asserts a completed financial fact, the same approval-weight tier
 * as approving a ClaimResolution. These functions do NOT check the
 * caller's role themselves (same two-tier convention as every prior
 * milestone's write actions); the gate lives at the route layer only
 * (app/api/invoice-claims/[id]/credit-notes/route.ts and app/api/
 * returns-credits/credit-notes/[id]/*).
 *
 * SalesFlow never creates a credit note in SAP -- every function here
 * only ever RECORDS that one was already issued there (carried forward
 * from 6A's own "a recommendation is never the same as an executed
 * action" principle, extended here to "recording a fact about SAP is
 * never the same as performing the action in SAP").
 */

const TRANSACTION_TIMEOUT_MS = 20_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

export type RecordCreditNoteManualResult =
  | { ok: true; id: string }
  | { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };

/**
 * Manual single-record entry path into the CreditNote model -- the other
 * path is the CSV import pipeline (lib/returns-credits/execute-import.ts),
 * which creates rows UNMATCHED (claimId: null) for auto-matching or later
 * manual reconciliation. A manual entry has no such ambiguity: the caller
 * (a sales manager) picked the claim directly, so it is created already
 * MANUALLY_MATCHED with claimId set, never passing through UNMATCHED.
 */
export async function recordCreditNoteManually(
  input: RecordCreditNoteManualInput,
  recordedById: string
): Promise<RecordCreditNoteManualResult> {
  const claim = await prisma.invoiceClaim.findUnique({
    where: { id: input.claimId },
    select: { id: true, status: true, sapInvoiceId: true },
  });
  if (!claim) {
    return { ok: false, status: 404, message: "Claim not found.", fieldErrors: { claimId: "Claim not found." } };
  }
  // A credit note only settles a claim once a resolution has actually
  // been approved -- same gate as recordClaimReturn(), and for the same
  // reason: there is nothing yet for it to settle on an OPEN/UNDER_
  // INVESTIGATION/etc. claim.
  if (claim.status !== "APPROVED" && claim.status !== "PARTIALLY_RESOLVED") {
    return {
      ok: false,
      status: 400,
      message: `Cannot record a credit note while the claim is ${claim.status}; a resolution must be approved first.`,
    };
  }

  const amountScaled = parseScaledDecimal(input.amount);
  if (amountScaled === null || amountScaled <= BigInt(0)) {
    return { ok: false, status: 400, message: "Amount must be greater than zero.", fieldErrors: { amount: "Must be greater than zero." } };
  }

  if (input.sapCreditNoteDocEntry) {
    const existing = await prisma.creditNote.findUnique({
      where: { sapCreditNoteDocEntry: input.sapCreditNoteDocEntry },
      select: { id: true },
    });
    if (existing) {
      return {
        ok: false,
        status: 409,
        message: `A credit note with DocEntry ${input.sapCreditNoteDocEntry} has already been recorded.`,
        fieldErrors: { sapCreditNoteDocEntry: "Already recorded." },
      };
    }
  }

  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.creditNote.create({
      data: {
        sapCreditNoteDocEntry: input.sapCreditNoteDocEntry ?? null,
        sapCreditNoteDocNum: input.sapCreditNoteDocNum,
        sapInvoiceId: claim.sapInvoiceId,
        claimId: claim.id,
        matchStatus: "MANUALLY_MATCHED",
        matchMethod: "MANUAL",
        matchNote: "Recorded directly against this claim.",
        matchedById: recordedById,
        matchedAt: new Date(),
        creditNoteDate: input.creditNoteDate ? dateOnlyStringToUtcDate(input.creditNoteDate) : null,
        currencyCode: input.currencyCode ?? null,
        amount: input.amount,
        notes: input.notes ?? null,
        recordedById,
      },
      select: { id: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId: recordedById,
        action: "CREDIT_NOTE_RECORDED_MANUALLY",
        entityType: "InvoiceClaim",
        entityId: claim.id,
        afterData: { creditNoteId: record.id, amount: input.amount, sapCreditNoteDocNum: input.sapCreditNoteDocNum },
      },
    });

    await recomputeClaimStatusAfterActuals(tx, claim.id, recordedById);

    return record;
  }, TRANSACTION_OPTIONS);

  return { ok: true, id: created.id };
}

export type CreditNoteMatchActionResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

interface CreditNoteMatchSnapshot {
  matchStatus: string;
  matchMethod: string | null;
  claimId: string | null;
  matchNote: string | null;
}

async function snapshotCreditNote(tx: Prisma.TransactionClient, creditNoteId: string): Promise<CreditNoteMatchSnapshot | null> {
  const note = await tx.creditNote.findUnique({
    where: { id: creditNoteId },
    select: { matchStatus: true, matchMethod: true, claimId: true, matchNote: true },
  });
  return note ?? null;
}

/**
 * Links an imported (UNMATCHED or previously CANNOT_LINK) credit note to
 * a specific claim by hand -- the resolution path for a credit note the
 * automatic matcher (lib/returns-credits/matching.ts) left UNMATCHED
 * because zero or multiple claims qualified. Mirrors
 * lib/invoice-reconciliation/manual-actions.ts's manuallyMatchInvoiceLine
 * exactly, extended to also recompute the newly-linked claim's status
 * since this credit note's amount now counts toward it.
 */
export async function manuallyMatchCreditNote(
  creditNoteId: string,
  input: ManuallyMatchCreditNoteInput,
  actorId: string
): Promise<CreditNoteMatchActionResult> {
  return prisma.$transaction(async (tx) => {
    const before = await snapshotCreditNote(tx, creditNoteId);
    if (!before) return { ok: false, status: 404, message: "Credit note not found." };

    const claim = await tx.invoiceClaim.findUnique({ where: { id: input.claimId }, select: { id: true } });
    if (!claim) return { ok: false, status: 400, message: "That claim does not exist." };

    await tx.creditNote.update({
      where: { id: creditNoteId },
      data: {
        matchStatus: "MANUALLY_MATCHED",
        matchMethod: "MANUAL",
        claimId: input.claimId,
        matchNote: input.note,
        matchedById: actorId,
        matchedAt: new Date(),
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "CREDIT_NOTE_MANUALLY_MATCHED",
        entityType: "CreditNote",
        entityId: creditNoteId,
        beforeData: { ...before },
        afterData: { matchStatus: "MANUALLY_MATCHED", matchMethod: "MANUAL", claimId: input.claimId, matchNote: input.note },
      },
    });

    await recomputeClaimStatusAfterActuals(tx, input.claimId, actorId);

    return { ok: true };
  }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
}

/**
 * Records that this credit note cannot be linked to any claim in
 * SalesFlow (e.g. a credit note issued for a reason unrelated to any
 * recorded invoice claim). A resolved, terminal outcome distinct from
 * leaving it UNMATCHED. `note` is required, same rule as
 * markInvoiceLineCannotLink.
 *
 * Deliberately does NOT reverse any status auto-advance that already
 * happened on a PREVIOUSLY linked claim when this credit note is now
 * unlinked (reaching this function from MANUALLY_MATCHED/AUTO_MATCHED is
 * possible, same as M5's own cannot-link action) -- recomputeClaim
 * StatusAfterActuals is a forward-only ratchet by design (see
 * lib/returns-credits/status-recompute.ts), and reversing a claim's
 * status automatically, as a side effect of correcting an unrelated
 * credit note's match, is out of scope for 6B. A manager who needs the
 * claim's status corrected after unlinking a wrongly-matched credit note
 * uses the ordinary manual status-change action (6A's PATCH .../status).
 */
export async function markCreditNoteCannotLink(creditNoteId: string, note: string, actorId: string): Promise<CreditNoteMatchActionResult> {
  if (!note.trim()) return { ok: false, status: 400, message: "An explanation is required to mark a credit note as unlinkable." };

  return prisma.$transaction(async (tx) => {
    const before = await snapshotCreditNote(tx, creditNoteId);
    if (!before) return { ok: false, status: 404, message: "Credit note not found." };

    await tx.creditNote.update({
      where: { id: creditNoteId },
      data: {
        matchStatus: "CANNOT_LINK",
        matchMethod: "MANUAL",
        claimId: null,
        matchNote: note,
        matchedById: actorId,
        matchedAt: new Date(),
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "CREDIT_NOTE_CANNOT_LINK",
        entityType: "CreditNote",
        entityId: creditNoteId,
        beforeData: { ...before },
        afterData: { matchStatus: "CANNOT_LINK", matchMethod: "MANUAL", claimId: null, matchNote: note },
      },
    });

    return { ok: true };
  }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
}

/**
 * Reopens a credit note back to UNMATCHED -- the undo step for a wrong
 * automatic or manual match, before a corrected decision is recorded.
 * `reason` is required, same rule as reopenInvoiceLineMatch. Same
 * forward-only-ratchet limitation as markCreditNoteCannotLink above: does
 * not itself reverse any claim status auto-advance already applied while
 * this credit note was linked.
 */
export async function reopenCreditNoteMatch(creditNoteId: string, reason: string, actorId: string): Promise<CreditNoteMatchActionResult> {
  if (!reason.trim()) return { ok: false, status: 400, message: "A reason is required to reopen a resolved credit note." };

  return prisma.$transaction(async (tx) => {
    const before = await snapshotCreditNote(tx, creditNoteId);
    if (!before) return { ok: false, status: 404, message: "Credit note not found." };
    if (before.matchStatus === "UNMATCHED") return { ok: false, status: 400, message: "This credit note is already unresolved." };

    await tx.creditNote.update({
      where: { id: creditNoteId },
      data: {
        matchStatus: "UNMATCHED",
        matchMethod: null,
        claimId: null,
        matchNote: reason,
        matchedById: actorId,
        matchedAt: new Date(),
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "CREDIT_NOTE_REOPENED",
        entityType: "CreditNote",
        entityId: creditNoteId,
        beforeData: { ...before },
        afterData: { matchStatus: "UNMATCHED", matchMethod: null, claimId: null, matchNote: reason },
      },
    });

    return { ok: true };
  }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
}
