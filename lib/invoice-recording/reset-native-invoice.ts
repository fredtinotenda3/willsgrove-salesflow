import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { TRANSACTION_OPTIONS } from "@/lib/orders";
import { isNativelyRecordedInvoice } from "@/lib/invoice-recording/queries";
import { describeResetBlockers, type ResetNativeInvoiceInput } from "@/lib/invoice-recording/validation";

/**
 * Reset (void) a natively-recorded invoice.
 *
 * Deliberately NO schema migration, and no deletion: the invoice is marked
 * `isCancelledOrReversed = true`, the field every consumer already honours
 * (remaining-to-invoice maths, revenue reports, the invoice register,
 * claim creation). Setting it therefore frees the picked quantity to be
 * invoiced again without any consumer needing to learn about "reset".
 * Provenance of the reset (who/when/why) is written both to the invoice's
 * own rawSourceData and to the audit history, so nothing is lost.
 *
 * Only invoices SalesFlow itself recorded can be reset -- a real SAP import
 * is SAP's record, never ours to void. The caller (route handler) enforces
 * the role check; this function re-checks the state under a row lock so a
 * double submit cannot reset twice.
 */

export type ResetNativeInvoiceResult =
  | { ok: true; sapDocNum: string }
  | { ok: false; status: number; message: string };

export async function resetNativeInvoice(
  orderId: string,
  invoiceId: string,
  actorId: string,
  input: ResetNativeInvoiceInput
): Promise<ResetNativeInvoiceResult> {
  return prisma.$transaction(async (tx): Promise<ResetNativeInvoiceResult> => {
    // Same lock recordNativeInvoice takes: a reset and a new recording on
    // the same order can never interleave.
    await tx.$queryRaw`SELECT "id" FROM "CustomerOrder" WHERE "id" = ${orderId} FOR UPDATE`;

    const invoice = await tx.sapInvoice.findFirst({
      where: { id: invoiceId, matchedOrderId: orderId },
      select: {
        id: true,
        sapDocNum: true,
        total: true,
        currencyCode: true,
        isCancelledOrReversed: true,
        rawSourceData: true,
        _count: { select: { claims: true, creditNotes: true } },
        deliveryRecord: { select: { id: true } },
      },
    });
    if (!invoice) return { ok: false, status: 404, message: "Invoice not found for this order." };
    if (!isNativelyRecordedInvoice(invoice.rawSourceData)) {
      return { ok: false, status: 409, message: "Only invoices recorded in SalesFlow can be reset. SAP-imported invoices are managed in SAP." };
    }
    if (invoice.isCancelledOrReversed) {
      return { ok: false, status: 409, message: "This invoice has already been reset." };
    }

    // Goods already dispatched against this invoice make a reset unsafe: voiding it would leave goods that
    // have left the door without an invoice. Checked per line against what the OTHER active invoices cover.
    const ownLines = await tx.sapInvoiceLine.findMany({
      where: { sapInvoiceId: invoice.id, matchedOrderLineId: { not: null } },
      select: { matchedOrderLineId: true, quantityInvoiced: true },
    });
    const ownByLine = new Map<string, Prisma.Decimal>();
    for (const l of ownLines) ownByLine.set(l.matchedOrderLineId as string, (ownByLine.get(l.matchedOrderLineId as string) ?? new Prisma.Decimal(0)).plus(l.quantityInvoiced));
    let dispatchedLines = 0;
    for (const [orderLineId, ownQuantity] of ownByLine) {
      const [dispatched, invoiced] = await Promise.all([
        tx.dispatchLine.aggregate({ where: { orderLineId, dispatchRecord: { status: { not: "CANCELLED" } } }, _sum: { dispatchedQuantity: true } }),
        tx.sapInvoiceLine.aggregate({ where: { matchedOrderLineId: orderLineId, sapInvoice: { isCancelledOrReversed: false } }, _sum: { quantityInvoiced: true } }),
      ]);
      const stillInvoiced = (invoiced._sum.quantityInvoiced ?? new Prisma.Decimal(0)).minus(ownQuantity);
      if ((dispatched._sum.dispatchedQuantity ?? new Prisma.Decimal(0)).greaterThan(stillInvoiced)) dispatchedLines += 1;
    }

    const blockers = describeResetBlockers({
      claims: invoice._count.claims,
      creditNotes: invoice._count.creditNotes,
      hasDeliveryRecord: invoice.deliveryRecord !== null,
      dispatchedLines,
    });
    if (blockers.length > 0) {
      return { ok: false, status: 409, message: `This invoice cannot be reset because ${blockers.join(" and ")}.` };
    }

    const resetAt = new Date();
    const previous = (invoice.rawSourceData ?? {}) as Record<string, unknown>;
    await tx.sapInvoice.update({
      where: { id: invoice.id },
      data: {
        isCancelledOrReversed: true,
        rawSourceData: {
          ...previous,
          source: "NATIVE_RECORDING",
          reset: { byId: actorId, at: resetAt.toISOString(), reason: input.reason },
        },
      },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "INVOICE_RESET_NATIVE",
        entityType: "SapInvoice",
        entityId: invoice.id,
        beforeData: { isCancelledOrReversed: false, sapDocNum: invoice.sapDocNum, total: invoice.total?.toString() ?? null },
        afterData: { isCancelledOrReversed: true, orderId, reason: input.reason, resetAt: resetAt.toISOString() },
      },
    });

    return { ok: true, sapDocNum: invoice.sapDocNum };
  }, TRANSACTION_OPTIONS);
}
