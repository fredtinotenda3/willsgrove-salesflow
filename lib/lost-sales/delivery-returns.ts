import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { parseScaledDecimal } from "@/lib/picking/validation";
import { formatScaledDecimal } from "@/lib/fulfilment/decimal";
import { mapRejectionReasonToCategory } from "@/lib/invoice-claims/delivery-claim-core";

/**
 * SINGLE SOURCE OF TRUTH for "Confirmed Loss (Returned Goods)".
 *
 * Business rule (confirmed with the business): when a delivery is recorded
 * (Record Delivery) and a product is rejected, those goods physically come
 * back to Willsgrove and the sale of those units was lost. The product-level
 * outcome lives in exactly one place -- DeliveryLine.acceptedQuantity /
 * rejectedQuantity -- so this module reads THAT, and nothing else, to answer:
 *
 *     returned quantity  = DeliveryLine.rejectedQuantity
 *     delivered quantity = DeliveryLine.acceptedQuantity
 *     lost value         = returned quantity x the unit price snapshot on the
 *                          order line (approved ?? customer), half-up to 4dp
 *
 * Counted only for deliveries that actually happened: the dispatch must be in
 * status DELIVERED (a cancelled or merely planned/departed dispatch has no
 * delivery record, so it can never appear here). DeliveryRecord is unique per
 * dispatch and DeliveryLine unique per dispatch line, so a resubmission can
 * never count a quantity twice.
 *
 * The claim (InvoiceClaim / InvoiceClaimLine) created from the same delivery
 * is a MANAGEMENT RECORD of the same quantity; it is joined for display and
 * traceability but never added to these figures.
 *
 * Legacy manual returns (ClaimReturn -> ClaimReturnLostSale) remain valid for
 * claims NOT originating from a delivery. `legacyReturnLossNotCoveredByDelivery`
 * excludes any legacy row whose claim -- or whose claimed order line -- is
 * already counted here, so the same units are never counted twice.
 */

export type ReturnDateRange = { gte?: Date; lt?: Date };

export type DeliveryReturnFilters = {
  includeDemo: boolean;
  customerId?: string | null;
  productId?: string | null;
  salespersonId?: string | null;
  dateRange?: ReturnDateRange;
};

export const MAX_DELIVERY_RETURN_ROWS = 10_000;

const ZERO = BigInt(0);
const SCALE = BigInt(10_000);

/** quantity (4dp) x unit price (4dp), rounded half-up to 4dp. Null when the price is unknown -- never zero. */
export function returnedLineValue(quantity: string, unitPrice: string | null): string | null {
  if (unitPrice === null) return null;
  const q = parseScaledDecimal(quantity);
  const p = parseScaledDecimal(unitPrice);
  if (q === null || p === null) return null;
  return formatScaledDecimal((q * p + SCALE / BigInt(2)) / SCALE);
}

export function deliveryReturnWhere(filters: DeliveryReturnFilters): Prisma.DeliveryLineWhereInput {
  const range = filters.dateRange ?? {};
  const hasRange = range.gte !== undefined || range.lt !== undefined;
  return {
    rejectedQuantity: { gt: 0 },
    deliveryRecord: {
      ...(hasRange ? { recordedAt: range } : {}),
      dispatchRecord: {
        status: "DELIVERED",
        order: {
          ...(filters.includeDemo ? {} : { isDemo: false }),
          ...(filters.customerId ? { customerId: filters.customerId } : {}),
          ...(filters.salespersonId ? { salespersonId: filters.salespersonId } : {}),
        },
      },
    },
    ...(filters.productId ? { dispatchLine: { orderLine: { productId: filters.productId } } } : {}),
  };
}

/**
 * Legacy ClaimReturnLostSale rows still count -- unless the units are already
 * counted from the delivery outcome (claim created from a delivery, or the
 * claimed order line has a delivery rejection).
 */
export function legacyReturnLossNotCoveredByDelivery(): Prisma.ClaimReturnLostSaleWhereInput {
  const rejectedOnDelivery: Prisma.OrderLineWhereInput = {
    dispatchLines: { some: { deliveryLine: { rejectedQuantity: { gt: 0 } }, dispatchRecord: { status: "DELIVERED" } } },
  };
  return {
    NOT: {
      OR: [
        { claim: { deliveryRecordId: { not: null } } },
        { claimLine: { orderLine: rejectedOnDelivery } },
        { claimLine: { sapInvoiceLine: { matchedOrderLine: rejectedOnDelivery } } },
      ],
    },
  };
}

export type DeliveryReturnRow = {
  /** DeliveryLine.id -- the unique key of this returned-goods record. */
  id: string;
  deliveryRecordId: string;
  dispatchRecordId: string;
  orderId: string;
  orderReference: string;
  orderLineId: string;
  customerId: string;
  customerName: string;
  productId: string | null;
  sapItemCode: string | null;
  description: string;
  unitOfMeasure: string | null;
  orderedQuantity: string;
  deliveredQuantity: string;
  returnedQuantity: string;
  unitPrice: string | null;
  totalValue: string | null;
  currencyCode: string;
  reason: string | null;
  reasonCategory: string | null;
  recipientName: string | null;
  notes: string | null;
  recordedAt: Date;
  salespersonId: string | null;
  isDemo: boolean;
  claimId: string | null;
  claimReference: string | null;
  claimStatus: string | null;
};

export async function listDeliveryReturnRows(
  filters: DeliveryReturnFilters,
  options: { take?: number; skip?: number } = {}
): Promise<{ rows: DeliveryReturnRow[]; totalMatching: number; truncated: boolean }> {
  const where = deliveryReturnWhere(filters);
  const take = Math.min(options.take ?? MAX_DELIVERY_RETURN_ROWS, MAX_DELIVERY_RETURN_ROWS);

  const [totalMatching, lines] = await Promise.all([
    prisma.deliveryLine.count({ where }),
    prisma.deliveryLine.findMany({
      where,
      take,
      skip: options.skip ?? 0,
      orderBy: [{ deliveryRecord: { recordedAt: "desc" } }, { id: "asc" }],
      select: {
        id: true,
        deliveryRecordId: true,
        acceptedQuantity: true,
        rejectedQuantity: true,
        rejectionReason: true,
        claimLine: { select: { claim: { select: { id: true, claimReference: true, status: true } } } },
        deliveryRecord: { select: { recordedAt: true, recipientName: true, notes: true, isDemo: true } },
        dispatchLine: {
          select: {
            dispatchRecordId: true,
            orderLineId: true,
            orderLine: {
              select: {
                originalProductDescription: true,
                sapItemCodeSnapshot: true,
                requestedQuantity: true,
                requestedUnitCode: true,
                approvedUnitPrice: true,
                customerUnitPrice: true,
                productId: true,
                product: { select: { sapItemCode: true, itemName: true } },
                order: { select: { id: true, reference: true, currency: true, customerId: true, salespersonId: true, isDemo: true, customer: { select: { name: true } } } },
              },
            },
          },
        },
      },
    }),
  ]);

  const rows: DeliveryReturnRow[] = lines.map((line) => {
    const orderLine = line.dispatchLine.orderLine;
    const order = orderLine.order;
    const unitPrice = (orderLine.approvedUnitPrice ?? orderLine.customerUnitPrice)?.toString() ?? null;
    const returned = line.rejectedQuantity.toString();
    const claim = line.claimLine?.claim ?? null;
    return {
      id: line.id,
      deliveryRecordId: line.deliveryRecordId,
      dispatchRecordId: line.dispatchLine.dispatchRecordId,
      orderId: order.id,
      orderReference: order.reference,
      orderLineId: line.dispatchLine.orderLineId,
      customerId: order.customerId,
      customerName: order.customer.name,
      productId: orderLine.productId,
      sapItemCode: orderLine.product?.sapItemCode ?? orderLine.sapItemCodeSnapshot ?? null,
      description: orderLine.product?.itemName ?? orderLine.originalProductDescription,
      unitOfMeasure: orderLine.requestedUnitCode ?? null,
      orderedQuantity: orderLine.requestedQuantity.toString(),
      deliveredQuantity: line.acceptedQuantity.toString(),
      returnedQuantity: returned,
      unitPrice,
      totalValue: returnedLineValue(returned, unitPrice),
      currencyCode: order.currency,
      reason: line.rejectionReason,
      reasonCategory: mapRejectionReasonToCategory(line.rejectionReason),
      recipientName: line.deliveryRecord.recipientName,
      notes: line.deliveryRecord.notes,
      recordedAt: line.deliveryRecord.recordedAt,
      salespersonId: order.salespersonId,
      isDemo: order.isDemo || line.deliveryRecord.isDemo,
      claimId: claim?.id ?? null,
      claimReference: claim?.claimReference ?? null,
      claimStatus: claim?.status ?? null,
    };
  });

  return { rows, totalMatching, truncated: totalMatching > take + (options.skip ?? 0) };
}

export type DeliveryReturnCurrencyBucket = {
  currencyCode: string;
  /** Delivery lines with a rejected quantity in this currency (priced or not). */
  recordCount: number;
  /** Of those, how many had a unit price (and therefore contribute to `value`). */
  pricedRecordCount: number;
  /** Sum of the per-line half-up values, so it always equals the sum of the drill-down rows. */
  value: string;
};

export type DeliveryReturnSummary = {
  byCurrency: DeliveryReturnCurrencyBucket[];
  recordCount: number;
  pricedRecordCount: number;
  unpricedRecordCount: number;
};

/** Efficient SQL aggregate over the SAME rows deliveryReturnWhere/listDeliveryReturnRows select. */
export async function getDeliveryReturnSummary(filters: DeliveryReturnFilters): Promise<DeliveryReturnSummary> {
  const range = filters.dateRange ?? {};
  const conditions: Prisma.Sql[] = [Prisma.sql`dl."rejectedQuantity" > 0`, Prisma.sql`d."status" = 'DELIVERED'`];
  if (!filters.includeDemo) conditions.push(Prisma.sql`o."isDemo" = false`);
  if (filters.customerId) conditions.push(Prisma.sql`o."customerId" = ${filters.customerId}`);
  if (filters.salespersonId) conditions.push(Prisma.sql`o."salespersonId" = ${filters.salespersonId}`);
  if (filters.productId) conditions.push(Prisma.sql`ol."productId" = ${filters.productId}`);
  if (range.gte) conditions.push(Prisma.sql`dr."recordedAt" >= ${range.gte}`);
  if (range.lt) conditions.push(Prisma.sql`dr."recordedAt" < ${range.lt}`);

  const result = await prisma.$queryRaw<{ currencyCode: string; recordCount: number; pricedCount: number; value: string }[]>(Prisma.sql`
    SELECT o."currency" AS "currencyCode",
           COUNT(*)::int AS "recordCount",
           COUNT(COALESCE(ol."approvedUnitPrice", ol."customerUnitPrice"))::int AS "pricedCount",
           COALESCE(SUM(ROUND(dl."rejectedQuantity" * COALESCE(ol."approvedUnitPrice", ol."customerUnitPrice"), 4)), 0)::text AS "value"
    FROM "DeliveryLine" dl
    JOIN "DeliveryRecord" dr ON dr."id" = dl."deliveryRecordId"
    JOIN "DispatchLine" dsl ON dsl."id" = dl."dispatchLineId"
    JOIN "DispatchRecord" d ON d."id" = dsl."dispatchRecordId"
    JOIN "OrderLine" ol ON ol."id" = dsl."orderLineId"
    JOIN "CustomerOrder" o ON o."id" = ol."orderId"
    WHERE ${Prisma.join(conditions, " AND ")}
    GROUP BY o."currency"
    ORDER BY SUM(ROUND(dl."rejectedQuantity" * COALESCE(ol."approvedUnitPrice", ol."customerUnitPrice"), 4)) DESC NULLS LAST, o."currency" ASC
  `);

  const byCurrency = result.map((row) => ({
    currencyCode: row.currencyCode,
    recordCount: Number(row.recordCount),
    pricedRecordCount: Number(row.pricedCount),
    value: formatScaledDecimal(parseScaledDecimal(new Prisma.Decimal(row.value).toFixed(4)) ?? ZERO),
  }));
  const recordCount = byCurrency.reduce((n, b) => n + b.recordCount, 0);
  const pricedRecordCount = byCurrency.reduce((n, b) => n + b.pricedRecordCount, 0);
  return { byCurrency, recordCount, pricedRecordCount, unpricedRecordCount: recordCount - pricedRecordCount };
}
