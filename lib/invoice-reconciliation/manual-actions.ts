import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recomputeInvoiceHeaderStatus, runAutoMatchForInvoice } from "@/lib/invoice-reconciliation/match-invoice";

/**
 * Milestone 5 (SAP Invoice Reconciliation). Manual reconciliation actions
 * (spec section 7's reconciliation workspace) -- resolving an ambiguous
 * line by hand, marking a line as having nothing to do with SalesFlow, or
 * reopening a wrong decision to try again. None of these functions check
 * the caller's role: that gate lives at the API route layer only
 * (app/api/invoice-reconciliation/lines/[id]/*), the same two-tier
 * pattern every prior milestone's write actions follow. Every action is
 * recorded via the existing generic AuditEvent model with a full
 * before/after snapshot -- "do not delete or overwrite original imported
 * SAP data when a reconciliation decision is changed; preserve the
 * original value, revised decision, user, timestamp and explanation"
 * (section 7) is satisfied because these functions only ever touch the
 * match* columns, never SapInvoiceLine's imported fields
 * (rawSourceData, quantityInvoiced, etc.), and every change is captured
 * in AuditEvent before it is applied.
 */

const TRANSACTION_TIMEOUT_MS = 20_000;
const TRANSACTION_MAX_WAIT_MS = 10_000;

export type ManualActionResult =
  | { ok: true }
  | { ok: false; status: number; message: string };

interface LineMatchSnapshot {
  matchStatus: string;
  matchMethod: string | null;
  matchedOrderId: string | null;
  matchedOrderLineId: string | null;
  matchNote: string | null;
}

async function snapshotLine(tx: Prisma.TransactionClient, lineId: string): Promise<LineMatchSnapshot | null> {
  const line = await tx.sapInvoiceLine.findUnique({
    where: { id: lineId },
    select: { matchStatus: true, matchMethod: true, matchedOrderId: true, matchedOrderLineId: true, matchNote: true },
  });
  return line ?? null;
}

/**
 * Links one invoice line to a specific order line by hand -- the
 * resolution path for a line the automatic matcher left UNMATCHED
 * because more than one order line qualified, or because the matcher
 * simply found none. `orderLineId` must belong to `orderId` and to a
 * customer (not independently re-validated against the invoice's own
 * matchedCustomerId here -- the UI only ever offers order lines of the
 * invoice's own resolved customer, and a mismatch is still harmless: it
 * just produces an odd-looking but fully traceable manual match).
 */
export async function manuallyMatchInvoiceLine(
  lineId: string,
  orderId: string,
  orderLineId: string,
  actorId: string,
  note: string
): Promise<ManualActionResult> {
  return prisma.$transaction(async (tx) => {
    const before = await snapshotLine(tx, lineId);
    if (!before) return { ok: false, status: 404, message: "Invoice line not found." };

    const orderLine = await tx.orderLine.findUnique({ where: { id: orderLineId }, select: { id: true, orderId: true } });
    if (!orderLine || orderLine.orderId !== orderId) {
      return { ok: false, status: 400, message: "That order line does not belong to the selected order." };
    }

    const line = await tx.sapInvoiceLine.findUniqueOrThrow({ where: { id: lineId }, select: { sapInvoiceId: true } });

    await tx.sapInvoiceLine.update({
      where: { id: lineId },
      data: {
        matchStatus: "MANUALLY_MATCHED",
        matchMethod: "MANUAL",
        matchedOrderId: orderId,
        matchedOrderLineId: orderLineId,
        matchNote: note,
        matchedById: actorId,
        matchedAt: new Date(),
      },
    });

    await recomputeInvoiceHeaderStatus(tx, line.sapInvoiceId);

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "SAP_INVOICE_LINE_MANUAL_MATCH",
        entityType: "SapInvoiceLine",
        entityId: lineId,
        beforeData: { ...before },
        afterData: { matchStatus: "MANUALLY_MATCHED", matchMethod: "MANUAL", matchedOrderId: orderId, matchedOrderLineId: orderLineId, matchNote: note },
      },
    });

    return { ok: true };
  }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
}

/**
 * Records that this invoice line has nothing to do with SalesFlow (e.g.
 * a walk-in/cash sale with no corresponding customer order) -- a
 * resolved, terminal outcome distinct from leaving it UNMATCHED, so it no
 * longer shows up as an open exception once explained. `note` is
 * required: section 7's "record explanations for discrepancies" and
 * "identify invoices that cannot be linked to SalesFlow" both depend on
 * this never being silent.
 */
export async function markInvoiceLineCannotLink(lineId: string, actorId: string, note: string): Promise<ManualActionResult> {
  if (!note.trim()) return { ok: false, status: 400, message: "An explanation is required to mark a line as unlinkable." };

  return prisma.$transaction(async (tx) => {
    const before = await snapshotLine(tx, lineId);
    if (!before) return { ok: false, status: 404, message: "Invoice line not found." };

    const line = await tx.sapInvoiceLine.findUniqueOrThrow({ where: { id: lineId }, select: { sapInvoiceId: true } });

    await tx.sapInvoiceLine.update({
      where: { id: lineId },
      data: {
        matchStatus: "CANNOT_LINK",
        matchMethod: "MANUAL",
        matchedOrderId: null,
        matchedOrderLineId: null,
        matchNote: note,
        matchedById: actorId,
        matchedAt: new Date(),
      },
    });

    await recomputeInvoiceHeaderStatus(tx, line.sapInvoiceId);

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "SAP_INVOICE_LINE_CANNOT_LINK",
        entityType: "SapInvoiceLine",
        entityId: lineId,
        beforeData: { ...before },
        afterData: { matchStatus: "CANNOT_LINK", matchMethod: "MANUAL", matchedOrderId: null, matchedOrderLineId: null, matchNote: note },
      },
    });

    return { ok: true };
  }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
}

/**
 * Reopens a line back to UNMATCHED -- the undo step for a wrong automatic
 * or manual match, before a corrected decision is recorded. `reason` is
 * required so the audit trail explains why a previously-resolved line
 * was reopened, not just what it changed to.
 */
export async function reopenInvoiceLineMatch(lineId: string, actorId: string, reason: string): Promise<ManualActionResult> {
  if (!reason.trim()) return { ok: false, status: 400, message: "A reason is required to reopen a resolved line." };

  return prisma.$transaction(async (tx) => {
    const before = await snapshotLine(tx, lineId);
    if (!before) return { ok: false, status: 404, message: "Invoice line not found." };
    if (before.matchStatus === "UNMATCHED") return { ok: false, status: 400, message: "This line is already unresolved." };

    const line = await tx.sapInvoiceLine.findUniqueOrThrow({ where: { id: lineId }, select: { sapInvoiceId: true } });

    await tx.sapInvoiceLine.update({
      where: { id: lineId },
      data: {
        matchStatus: "UNMATCHED",
        matchMethod: null,
        matchedOrderId: null,
        matchedOrderLineId: null,
        matchNote: reason,
        matchedById: actorId,
        matchedAt: new Date(),
      },
    });

    await recomputeInvoiceHeaderStatus(tx, line.sapInvoiceId);

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "SAP_INVOICE_LINE_REOPENED",
        entityType: "SapInvoiceLine",
        entityId: lineId,
        beforeData: { ...before },
        afterData: { matchStatus: "UNMATCHED", matchMethod: null, matchedOrderId: null, matchedOrderLineId: null, matchNote: reason },
      },
    });

    return { ok: true };
  }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
}

/**
 * Re-runs the conservative automatic matcher (lib/invoice-reconciliation/
 * match-invoice.ts) over this invoice's currently-UNMATCHED lines only --
 * useful after a reopen frees up capacity on an order line, or after a
 * later import resolved an order reference ambiguity. Never touches a
 * line that is already AUTO_MATCHED, MANUALLY_MATCHED or CANNOT_LINK.
 */
export async function rerunAutoMatchForInvoice(sapInvoiceId: string, actorId: string): Promise<ManualActionResult> {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.sapInvoice.findUnique({ where: { id: sapInvoiceId }, select: { id: true } });
    if (!invoice) return { ok: false, status: 404, message: "Invoice not found." };

    await runAutoMatchForInvoice(tx, sapInvoiceId, actorId);
    await recomputeInvoiceHeaderStatus(tx, sapInvoiceId);

    return { ok: true };
  }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
}

/**
 * Records (or clears) the invoice-level explanation of its exceptions as
 * a whole (section 7). The field only ever holds the current note; the
 * full history of what it used to say lives in AuditEvent's before/after
 * snapshots, same as every other "record an explanation" action in this
 * codebase.
 */
export async function setInvoiceReconciliationNote(sapInvoiceId: string, actorId: string, note: string | null): Promise<ManualActionResult> {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.sapInvoice.findUnique({ where: { id: sapInvoiceId }, select: { reconciliationNotes: true } });
    if (!invoice) return { ok: false, status: 404, message: "Invoice not found." };

    await tx.sapInvoice.update({ where: { id: sapInvoiceId }, data: { reconciliationNotes: note } });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "SAP_INVOICE_NOTE_UPDATED",
        entityType: "SapInvoice",
        entityId: sapInvoiceId,
        beforeData: { reconciliationNotes: invoice.reconciliationNotes },
        afterData: { reconciliationNotes: note },
      },
    });

    return { ok: true };
  }, { timeout: TRANSACTION_TIMEOUT_MS, maxWait: TRANSACTION_MAX_WAIT_MS });
}
