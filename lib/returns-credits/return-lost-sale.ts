import "server-only";
import { Prisma } from "@prisma/client";
import type { PrismaTransactionClient } from "@/lib/prisma";
import type { ReturnCondition } from "@/lib/returns-credits/validation";

/**
 * Real Business Data Onboarding round, Phase 6 (Returned-claim lost
 * sales).
 *
 * Mirrors Milestone 4/the lost-sales-automation round's own "no human
 * decision, mechanically derived from an already-recorded fact"
 * philosophy (see prisma/schema.prisma's LostSaleRecord comment), for a
 * different originating event: a physical return recorded against an
 * invoice claim (lib/returns-credits/returns.ts's recordClaimReturn()),
 * rather than a picking-time shortage.
 *
 * ReturnCondition is the concrete, already-recorded signal this reuses
 * (never a new parallel enum, never a second human judgement call) to
 * decide whether a return is a genuine, permanent business loss:
 *   - GOOD_RESALABLE: the goods go back into resalable stock -- no loss.
 *   - DAMAGED / EXPIRED / OTHER: the goods cannot be resold, so whatever
 *     quantity was actually received back is permanently lost revenue.
 *
 * Called from inside recordClaimReturn()'s own transaction, immediately
 * after the ClaimReturn row itself is created, so a mid-request failure
 * can never leave a genuine-loss return behind with no lost-sale record,
 * or vice versa -- same "same transaction" guarantee every other
 * multi-row write in this project follows (e.g.
 * lib/invoice-delivery/record-outcome.ts's own InvoiceDeliveryRecord +
 * InvoiceClaim pairing).
 */

export type RecordClaimReturnLostSaleParams = {
  claimReturnId: string;
  claimId: string;
  claimLineId: string | null;
  customerId: string;
  /** Already-validated decimal string -- the ACTUAL quantity received
   * back (ClaimReturn.receivedQuantity), never the claim line's
   * originally-disputed/rejectedQuantity, which may differ from what
   * physically came back. */
  receivedQuantity: string;
  condition: ReturnCondition;
  recordedById: string;
};

export type RecordClaimReturnLostSaleResult =
  | { created: false } // condition was GOOD_RESALABLE -- no loss, nothing written
  | { created: true; id: string; estimatedValue: string | null };

/**
 * Creates the ClaimReturnLostSale row for a just-recorded ClaimReturn,
 * when (and only when) its condition indicates a genuine loss. Returns
 * `{ created: false }` without writing anything for GOOD_RESALABLE --
 * the normal, expected outcome for most returns, not an error.
 *
 * Never invents a price: estimatedUnitPrice/estimatedValue are resolved
 * ONLY when claimLineId is set (so the specific disputed SAP invoice
 * line -- and therefore its product and REAL invoiced unitPrice -- is
 * known) AND that line's own SapInvoiceLine.unitPrice is non-null. A
 * return scoped to the whole claim rather than one line, or a line
 * whose invoice never carried a unit price, leaves both fields null --
 * displayed as "no estimate available," never defaulted to zero (same
 * rule LostSaleRecord already follows, spec 4.6).
 */
export async function recordClaimReturnLostSaleIfLoss(
  tx: PrismaTransactionClient,
  params: RecordClaimReturnLostSaleParams
): Promise<RecordClaimReturnLostSaleResult> {
  if (params.condition === "GOOD_RESALABLE") {
    return { created: false };
  }

  let sapItemCodeSnapshot: string | null = null;
  let sapItemDescriptionSnapshot: string | null = null;
  let estimatedUnitPrice: Prisma.Decimal | null = null;
  let estimatedValue: Prisma.Decimal | null = null;

  if (params.claimLineId) {
    const line = await tx.invoiceClaimLine.findUnique({
      where: { id: params.claimLineId },
      select: {
        sapItemCodeSnapshot: true,
        sapItemDescriptionSnapshot: true,
        sapInvoiceLine: { select: { unitPrice: true } },
        // Real-world fix (native Invoice Claims): the real price source
        // for a line claimed natively (no SapInvoiceLine at all) --
        // same approvedUnitPrice-then-customerUnitPrice fallback
        // lib/invoice-claims/financial.ts's computeClaimFinancialSummary
        // already uses, for the same reason.
        orderLine: { select: { approvedUnitPrice: true, customerUnitPrice: true } },
      },
    });
    if (line) {
      sapItemCodeSnapshot = line.sapItemCodeSnapshot;
      sapItemDescriptionSnapshot = line.sapItemDescriptionSnapshot;
      const realUnitPrice = line.sapInvoiceLine
        ? line.sapInvoiceLine.unitPrice
        : line.orderLine?.approvedUnitPrice ?? line.orderLine?.customerUnitPrice ?? null;
      if (realUnitPrice !== null) {
        estimatedUnitPrice = realUnitPrice;
        // Both operands are @db.Decimal(18,4); round to this project's
        // money scale rather than leaving full intermediate precision or
        // truncating via a float conversion -- same convention
        // computeClaimLineDisputedValue (lib/invoice-claims/financial.ts)
        // already follows for the same reason.
        estimatedValue = new Prisma.Decimal(params.receivedQuantity).times(estimatedUnitPrice).toDecimalPlaces(4);
      }
    }
  }

  const claim = await tx.invoiceClaim.findUnique({
    where: { id: params.claimId },
    select: {
      sapInvoice: { select: { currencyCode: true } },
      // Real-world fix (native Invoice Claims): currency fallback for a
      // claim with no sapInvoice.
      order: { select: { currency: true } },
    },
  });
  const currencyCode = claim?.sapInvoice?.currencyCode ?? claim?.order?.currency ?? null;

  const created = await tx.claimReturnLostSale.create({
    data: {
      claimReturnId: params.claimReturnId,
      claimId: params.claimId,
      claimLineId: params.claimLineId,
      customerId: params.customerId,
      sapItemCodeSnapshot,
      sapItemDescriptionSnapshot,
      estimatedUnitPrice,
      estimatedValue,
      currencyCode,
      decisionSource: "AUTOMATIC_SYSTEM_RECORDED",
      recordedById: params.recordedById,
    },
    select: { id: true },
  });

  await tx.auditEvent.create({
    data: {
      actorId: params.recordedById,
      action: "CLAIM_RETURN_LOST_SALE_RECORDED",
      entityType: "InvoiceClaim",
      entityId: params.claimId,
      afterData: {
        claimReturnId: params.claimReturnId,
        claimLineId: params.claimLineId,
        condition: params.condition,
        receivedQuantity: params.receivedQuantity,
        estimatedUnitPrice: estimatedUnitPrice?.toString() ?? null,
        estimatedValue: estimatedValue?.toString() ?? null,
        currencyCode,
      },
    },
  });

  return { created: true, id: created.id, estimatedValue: estimatedValue?.toString() ?? null };
}
