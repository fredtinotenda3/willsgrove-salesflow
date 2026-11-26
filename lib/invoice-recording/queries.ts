import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { describeResetBlockers } from "@/lib/invoice-recording/validation";

/**
 * Real-world fix (native invoice recording) -- see validation.ts's own
 * comment for the full design. Read-only helpers for the order detail
 * page's "Record Invoice" action and for telling a natively-recorded
 * invoice apart from a real SAP-imported one anywhere one is displayed.
 */

export type InvoiceRecordingLineEligibility = {
  orderLineId: string;
  lineNumber: number;
  description: string;
  sapItemCode: string | null;
  unitCode: string;
  /** Sum of PickingLine.foundQuantity across AUTHORIZED picking sessions: what was picked and is therefore invoiceable. */
  pickedQuantity: string;
  /** Sum of DispatchLine.dispatchedQuantity for this line, excluding cancelled dispatches (display only: invoicing precedes dispatch). */
  dispatchedQuantity: string;
  /** Sum of SapInvoiceLine.quantityInvoiced already matched to this line, excluding cancelled/reversed invoices -- counts a native invoice exactly the same as a real SAP one, since both are the same SapInvoiceLine row. */
  alreadyInvoicedQuantity: string;
  /** pickedQuantity - alreadyInvoicedQuantity. Lines where this is <= 0 are omitted entirely -- nothing left to invoice on them. */
  remainingToInvoice: string;
  /** This order line's own approvedUnitPrice, falling back to customerUnitPrice -- never invented, and never a price-list lookup: an invoice line's price is what THIS order actually agreed, not a current catalogue price that may have since changed. Null means the operator must enter one by hand. */
  suggestedUnitPrice: string | null;
};

export type InvoiceRecordingEligibility = {
  orderId: string;
  orderReference: string;
  currency: string;
  customerName: string;
  /** Lines with remainingToInvoice > 0 only -- see that field's own comment. */
  lines: InvoiceRecordingLineEligibility[];
};

/**
 * Null when the order itself doesn't exist. An order with zero eligible
 * lines (nothing dispatched yet, or everything already invoiced) comes
 * back with an empty `lines` array, never an error -- the caller (the
 * order detail page) uses that to decide whether to show the "Record
 * Invoice" action at all.
 */
export async function getInvoiceRecordingEligibility(orderId: string): Promise<InvoiceRecordingEligibility | null> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      reference: true,
      currency: true,
      customer: { select: { name: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true,
          lineNumber: true,
          originalProductDescription: true,
          sapItemCodeSnapshot: true,
          requestedUnitCode: true,
          approvedUnitPrice: true,
          customerUnitPrice: true,
          product: { select: { sapItemCode: true } },
          pickingLines: {
            where: { pickingSession: { status: "AUTHORIZED" }, foundQuantity: { not: null } },
            select: { foundQuantity: true },
          },
          dispatchLines: {
            where: { dispatchRecord: { status: { not: "CANCELLED" } } },
            select: { dispatchedQuantity: true },
          },
          matchedSapInvoiceLines: {
            where: { sapInvoice: { isCancelledOrReversed: false } },
            select: { quantityInvoiced: true },
          },
        },
      },
    },
  });
  if (!order) return null;

  const lines: InvoiceRecordingLineEligibility[] = [];
  for (const line of order.lines) {
    const pickedQuantity = line.pickingLines.reduce(
      (sum, p) => sum.plus(p.foundQuantity ?? 0),
      new Prisma.Decimal(0)
    );
    const dispatchedQuantity = line.dispatchLines.reduce(
      (sum, d) => sum.plus(d.dispatchedQuantity),
      new Prisma.Decimal(0)
    );
    const alreadyInvoicedQuantity = line.matchedSapInvoiceLines.reduce(
      (sum, invLine) => sum.plus(invLine.quantityInvoiced),
      new Prisma.Decimal(0)
    );
    const remaining = pickedQuantity.minus(alreadyInvoicedQuantity);
    if (remaining.lessThanOrEqualTo(0)) continue;

    lines.push({
      orderLineId: line.id,
      lineNumber: line.lineNumber,
      description: line.originalProductDescription,
      sapItemCode: line.product?.sapItemCode ?? line.sapItemCodeSnapshot ?? null,
      unitCode: line.requestedUnitCode,
      pickedQuantity: pickedQuantity.toString(),
      dispatchedQuantity: dispatchedQuantity.toString(),
      alreadyInvoicedQuantity: alreadyInvoicedQuantity.toString(),
      remainingToInvoice: remaining.toString(),
      suggestedUnitPrice: (line.approvedUnitPrice ?? line.customerUnitPrice)?.toString() ?? null,
    });
  }

  return {
    orderId: order.id,
    orderReference: order.reference,
    currency: order.currency,
    customerName: order.customer.name,
    lines,
  };
}

/**
 * The single source of truth for "was this SapInvoice recorded directly
 * in SalesFlow, or did it actually come from a SAP export file" --
 * deliberately NOT inferred from sapDocEntry being null (a real SAP
 * export can legitimately omit DocEntry too) or from sapDocNum's prefix
 * (string-prefix sniffing is fragile and undocumented at the call site).
 * Every consumer that needs this distinction (Delivered Orders list/
 * detail, anywhere a SapInvoice is shown) calls this one function on the
 * same `rawSourceData` marker record-native-invoice.ts always writes,
 * rather than each growing its own guess.
 */
export function isNativelyRecordedInvoice(rawSourceData: unknown): boolean {
  return (
    typeof rawSourceData === "object" &&
    rawSourceData !== null &&
    (rawSourceData as { source?: unknown }).source === "NATIVE_RECORDING"
  );
}

export type RecordedInvoiceSummary = {
  id: string;
  sapDocNum: string;
  invoiceDate: string | null;
  total: string | null;
  currencyCode: string | null;
  lineCount: number;
  /** "RECORDED" while active; "RESET" once voided (kept visible for the audit trail, never silently removed). */
  state: "RECORDED" | "RESET";
  reset: { at: string | null; reason: string | null } | null;
  /** Human-readable reasons a reset is currently refused (empty = can be reset, subject to role). */
  resetBlockers: string[];
};

/**
 * Every invoice SalesFlow itself recorded against this order, newest first,
 * including reset ones. Drives the "recorded / completed" state on the
 * order detail page. SAP-imported invoices are intentionally excluded --
 * they are SAP's record and have no reset.
 */
export async function listRecordedInvoicesForOrder(orderId: string): Promise<RecordedInvoiceSummary[]> {
  // Active invoiced and dispatched quantity per order line, to tell whether voiding an invoice would
  // leave goods dispatched without an invoice (a reset is refused in that case).
  const [activeInvoiceLines, dispatchedLines] = await Promise.all([
    prisma.sapInvoiceLine.findMany({
      where: { matchedOrderLine: { orderId }, sapInvoice: { isCancelledOrReversed: false } },
      select: { sapInvoiceId: true, matchedOrderLineId: true, quantityInvoiced: true },
    }),
    prisma.dispatchLine.findMany({
      where: { orderLine: { orderId }, dispatchRecord: { status: { not: "CANCELLED" } } },
      select: { orderLineId: true, dispatchedQuantity: true },
    }),
  ]);
  const dispatchedByLine = new Map<string, Prisma.Decimal>();
  for (const d of dispatchedLines) dispatchedByLine.set(d.orderLineId, (dispatchedByLine.get(d.orderLineId) ?? new Prisma.Decimal(0)).plus(d.dispatchedQuantity));
  const invoicedByLine = new Map<string, Prisma.Decimal>();
  for (const l of activeInvoiceLines) if (l.matchedOrderLineId) invoicedByLine.set(l.matchedOrderLineId, (invoicedByLine.get(l.matchedOrderLineId) ?? new Prisma.Decimal(0)).plus(l.quantityInvoiced));
  const dispatchedLineCount = (invoiceId: string): number => {
    const own = new Map<string, Prisma.Decimal>();
    for (const l of activeInvoiceLines) if (l.sapInvoiceId === invoiceId && l.matchedOrderLineId) own.set(l.matchedOrderLineId, (own.get(l.matchedOrderLineId) ?? new Prisma.Decimal(0)).plus(l.quantityInvoiced));
    let count = 0;
    for (const [lineId, quantity] of own) {
      const remainingInvoiced = (invoicedByLine.get(lineId) ?? new Prisma.Decimal(0)).minus(quantity);
      if ((dispatchedByLine.get(lineId) ?? new Prisma.Decimal(0)).greaterThan(remainingInvoiced)) count += 1;
    }
    return count;
  };

  const invoices = await prisma.sapInvoice.findMany({
    where: { matchedOrderId: orderId, rawSourceData: { path: ["source"], equals: "NATIVE_RECORDING" } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      sapDocNum: true,
      invoiceDate: true,
      total: true,
      currencyCode: true,
      isCancelledOrReversed: true,
      rawSourceData: true,
      _count: { select: { lines: true, claims: true, creditNotes: true } },
      deliveryRecord: { select: { id: true } },
    },
  });

  return invoices.map((invoice) => {
    const raw = (invoice.rawSourceData ?? {}) as { reset?: { at?: unknown; reason?: unknown } };
    const state = invoice.isCancelledOrReversed ? "RESET" : "RECORDED";
    return {
      id: invoice.id,
      sapDocNum: invoice.sapDocNum,
      invoiceDate: invoice.invoiceDate ? invoice.invoiceDate.toISOString().slice(0, 10) : null,
      total: invoice.total?.toString() ?? null,
      currencyCode: invoice.currencyCode,
      lineCount: invoice._count.lines,
      state,
      reset:
        state === "RESET"
          ? {
              at: typeof raw.reset?.at === "string" ? raw.reset.at : null,
              reason: typeof raw.reset?.reason === "string" ? raw.reset.reason : null,
            }
          : null,
      resetBlockers:
        state === "RECORDED"
          ? describeResetBlockers({
              claims: invoice._count.claims,
              creditNotes: invoice._count.creditNotes,
              hasDeliveryRecord: invoice.deliveryRecord !== null,
              dispatchedLines: dispatchedLineCount(invoice.id),
            })
          : [],
    };
  });
}
