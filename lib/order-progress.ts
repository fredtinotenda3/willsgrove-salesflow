import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderInvoiceState } from "@/lib/order-display";

/**
 * Invoice progress for a page of orders, read in ONE batched pass (never one
 * query per order) so every list, dashboard and admin page can feed
 * getEffectiveOrderStatus (lib/order-display.ts) the same facts:
 *
 *   invoiceState  NONE    nothing invoiced yet
 *                 PARTIAL some, but not all, of the picked (authorised) quantity is invoiced
 *                 FULL    everything picked has been invoiced
 *   completed     every active invoice has its delivery outcome recorded
 *                 (the "Mark as Done" step) and at least one invoice exists
 *
 * "Active" = not voided (SapInvoice.isCancelledOrReversed = false). Native
 * (recorded in SalesFlow) and SAP-imported invoices count identically, because
 * both are SapInvoice rows matched to the order's lines.
 *
 * Quantities are compared as scaled integers through Prisma.Decimal -- never
 * floats -- so 0.1 + 0.2 style drift cannot flip PARTIAL/FULL.
 */

export type OrderProgress = {
  invoiceState: OrderInvoiceState;
  completed: boolean;
  invoicedQuantity: string;
  authorizedQuantity: string;
};

const NO_PROGRESS: OrderProgress = { invoiceState: "NONE", completed: false, invoicedQuantity: "0", authorizedQuantity: "0" };

export function deriveInvoiceState(invoiced: Prisma.Decimal, authorized: Prisma.Decimal): OrderInvoiceState {
  if (invoiced.lessThanOrEqualTo(0)) return "NONE";
  return invoiced.greaterThanOrEqualTo(authorized) ? "FULL" : "PARTIAL";
}

export async function loadOrderProgress(orderIds: readonly string[]): Promise<Map<string, OrderProgress>> {
  const result = new Map<string, OrderProgress>();
  const ids = [...new Set(orderIds)];
  if (ids.length === 0) return result;

  const [invoices, authorizedRows] = await Promise.all([
    prisma.sapInvoice.findMany({
      where: { matchedOrderId: { in: ids }, isCancelledOrReversed: false },
      select: {
        matchedOrderId: true,
        deliveryRecord: { select: { id: true } },
        lines: { where: { matchedOrderLineId: { not: null } }, select: { quantityInvoiced: true } },
      },
    }),
    prisma.$queryRaw<{ orderId: string; found: Prisma.Decimal }[]>(Prisma.sql`
      SELECT ps."orderId" AS "orderId", COALESCE(SUM(pl."foundQuantity"), 0) AS found
      FROM "PickingLine" pl
      JOIN "PickingSession" ps ON ps."id" = pl."pickingSessionId"
      WHERE ps."status" = 'AUTHORIZED' AND ps."orderId" IN (${Prisma.join(ids)})
      GROUP BY ps."orderId"
    `),
  ]);

  const authorizedByOrder = new Map(authorizedRows.map((row) => [row.orderId, new Prisma.Decimal(row.found)]));
  const invoicedByOrder = new Map<string, Prisma.Decimal>();
  const counts = new Map<string, { total: number; done: number }>();

  for (const invoice of invoices) {
    const orderId = invoice.matchedOrderId;
    if (!orderId) continue;
    const quantity = invoice.lines.reduce((sum, line) => sum.plus(line.quantityInvoiced), new Prisma.Decimal(0));
    invoicedByOrder.set(orderId, (invoicedByOrder.get(orderId) ?? new Prisma.Decimal(0)).plus(quantity));
    const entry = counts.get(orderId) ?? { total: 0, done: 0 };
    entry.total += 1;
    if (invoice.deliveryRecord) entry.done += 1;
    counts.set(orderId, entry);
  }

  for (const id of ids) {
    const invoiced = invoicedByOrder.get(id) ?? new Prisma.Decimal(0);
    const authorized = authorizedByOrder.get(id) ?? new Prisma.Decimal(0);
    const entry = counts.get(id);
    result.set(id, {
      ...NO_PROGRESS,
      invoiceState: deriveInvoiceState(invoiced, authorized),
      completed: entry !== undefined && entry.total > 0 && entry.done === entry.total,
      invoicedQuantity: invoiced.toString(),
      authorizedQuantity: authorized.toString(),
    });
  }
  return result;
}

export async function loadSingleOrderProgress(orderId: string): Promise<OrderProgress> {
  return (await loadOrderProgress([orderId])).get(orderId) ?? NO_PROGRESS;
}
