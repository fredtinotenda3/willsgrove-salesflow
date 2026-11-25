import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { legacyReturnLossNotCoveredByDelivery, listDeliveryReturnRows } from "@/lib/lost-sales/delivery-returns";

/**
 * Follow-up fix ("Returned-claim lost sales must... Show returned-claim
 * losses in the same Lost Sales Analytics page, KPIs, charts and reports
 * as shortage-based lost sales... Include product, customer, quantity,
 * unit of measure, unit price and total lost value... Add source
 * filters and drill-down to the original order, invoice, claim and
 * return records").
 *
 * The row-level counterpart to lib/returns-credits/lost-sale-analytics.ts's
 * getReturnedGoodsLostSalesValue (Source C's whole-business, currency-
 * grouped SUMMARY, left untouched -- see that file's own comment on why
 * it stays its own figure). This module lists the SAME underlying table
 * (ClaimReturnLostSale) at per-row granularity, enriched with everything
 * lib/lost-sales/consolidated-analytics.ts needs to merge it with the
 * shortage side (lib/lost-sales/queries.ts's listShortageLostSaleRows):
 * product identity, unit of measure, quantity, unit price, total value,
 * and the ids/references needed to drill down to the original order,
 * invoice, claim, and return record.
 *
 * Never re-derives whether a return is a genuine loss -- that decision
 * was already made once, exclusively, by
 * lib/returns-credits/return-lost-sale.ts's recordClaimReturnLostSaleIfLoss
 * at the moment the return was recorded (GOOD_RESALABLE never creates a
 * row here at all). This module only reads already-decided rows.
 *
 * Product/unit-of-measure resolution: ClaimReturnLostSale itself stores
 * no productId or unit -- only a display snapshot
 * (sapItemCodeSnapshot/sapItemDescriptionSnapshot), set only when
 * claimLineId is non-null (a return scoped to one disputed line, not the
 * whole claim). Where claimLineId IS set, this module resolves the real
 * productId and unitOfMeasure by reading the disputed line's own
 * SapInvoiceLine -- matchedOrderLine.productId for the product (the SAME
 * resolution path SapInvoiceLine.matchedOrderLineId already establishes
 * for Milestone 5 matching) and the invoice line's own unitOfMeasure
 * (the actual unit those goods were invoiced in -- a real, already-
 * recorded fact, never guessed from the product's own default unit).
 * Where claimLineId is null, productId/unitOfMeasure/
 * productDescriptionSnapshot all stay null -- never invented -- and the
 * consuming UI discloses this as an unresolved/claim-level return rather
 * than attributing it to a guessed product.
 */

const MAX_RETURNED_LOST_SALE_ROWS = 10_000;

export type ReturnedProductLostSaleRow = {
  /** ClaimReturnLostSale.id for a manual return, or DeliveryLine.id for a delivery rejection (see `origin`). */
  id: string;
  /** DELIVERY_REJECTION: goods refused at delivery (automatic, primary). MANUAL_RETURN: legacy ClaimReturn on a non-delivery claim. */
  origin: "DELIVERY_REJECTION" | "MANUAL_RETURN";
  /** Null for a delivery rejection (no separate ClaimReturn is involved). */
  claimReturnId: string | null;
  /** Null only for a delivery recorded before delivery-originated claims existed and not yet back-filled. */
  claimId: string | null;
  claimReference: string | null;
  claimLineId: string | null;
  customerId: string;
  customerName: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  /** Null only when this return was scoped to the whole claim rather than one disputed line -- there is no single product to snapshot in that case; never a fabricated label. */
  productDescriptionSnapshot: string | null;
  /** The disputed SapInvoiceLine's own unitOfMeasure -- null when claimLineId is null, or when that invoice line never recorded one. */
  unitOfMeasure: string | null;
  /** ClaimReturn.receivedQuantity -- the ACTUAL quantity physically received back, never the claim line's originally-disputed quantity. */
  quantity: string;
  unitPrice: string | null;
  totalValue: string | null;
  /** Null when the originating SapInvoice had no currencyCode on record -- callers display this as "UNKNOWN", the same convention getReturnedGoodsLostSalesValue's own byCurrency bucket already uses. */
  currencyCode: string | null;
  condition: string; // ReturnCondition -- always DAMAGED/EXPIRED/OTHER here; GOOD_RESALABLE never reaches this table
  returnReference: string;
  /** Via InvoiceClaim.orderId -- null when the claim was never matched to an order (InvoiceClaim.orderId's own documented case: an invoice Milestone 5 never matched). */
  orderId: string | null;
  orderReference: string | null;
  /** Null for a native claim (no SapInvoice at all) -- see InvoiceClaim.sapInvoiceId's own schema comment. */
  sapInvoiceId: string | null;
  salespersonId: string | null;
  recordedAt: Date;
  isDemo: boolean;
};

export type ListReturnedProductLostSalesResult = {
  rows: ReturnedProductLostSaleRow[];
  totalMatching: number;
  truncated: boolean;
};

export type ReturnedProductLostSaleFilters = {
  includeDemo: boolean;
  customerId?: string | null;
  productId?: string | null;
  salespersonId?: string | null;
  /** Applied against ClaimReturnLostSale.recordedAt -- the "this loss was confirmed" timestamp, the same role UnfulfilledDemand/LostSaleRecord's own date fields play on the shortage side. */
  dateRange: { gte?: Date; lt?: Date };
};

export async function listReturnedProductLostSaleRows(
  filters: ReturnedProductLostSaleFilters
): Promise<ListReturnedProductLostSalesResult> {
  const where: Prisma.ClaimReturnLostSaleWhereInput = {
    ...(filters.includeDemo ? {} : { isDemo: false }),
    // Units already counted from the delivery outcome are never counted again.
    ...legacyReturnLossNotCoveredByDelivery(),
    recordedAt: filters.dateRange,
    ...(filters.customerId ? { customerId: filters.customerId } : {}),
    // productId is not a column on this table -- filter via the
    // disputed line's own matched order line, the same join this
    // module's row-mapping below reads for display. A row whose return
    // was scoped to the whole claim (claimLineId null) has no product to
    // match and is correctly excluded by this filter, never force-
    // included.
    ...(filters.productId
      ? {
          claimLine: {
            OR: [
              { sapInvoiceLine: { matchedOrderLine: { productId: filters.productId } } },
              // Real-world fix (native Invoice Claims): a native claim
              // line's product is its own orderLine.productId directly
              // -- no matchedOrderLine indirection needed, since there's
              // no SapInvoiceLine in the picture at all.
              { orderLine: { productId: filters.productId } },
            ],
          },
        }
      : {}),
    ...(filters.salespersonId ? { claim: { order: { salespersonId: filters.salespersonId } } } : {}),
  };

  const [totalMatching, rawRows] = await Promise.all([
    prisma.claimReturnLostSale.count({ where }),
    prisma.claimReturnLostSale.findMany({
      where,
      take: MAX_RETURNED_LOST_SALE_ROWS,
      orderBy: { recordedAt: "asc" },
      select: {
        id: true,
        claimReturnId: true,
        claimId: true,
        claimLineId: true,
        customerId: true,
        customer: { select: { name: true } },
        sapItemCodeSnapshot: true,
        sapItemDescriptionSnapshot: true,
        estimatedUnitPrice: true,
        estimatedValue: true,
        currencyCode: true,
        recordedAt: true,
        isDemo: true,
        claimReturn: { select: { receivedQuantity: true, condition: true, returnReference: true } },
        claim: {
          select: {
            claimReference: true,
            sapInvoiceId: true,
            orderId: true,
            order: { select: { reference: true, salespersonId: true } },
          },
        },
        claimLine: {
          select: {
            sapInvoiceLine: {
              select: {
                unitOfMeasure: true,
                matchedOrderLine: { select: { productId: true } },
              },
            },
            // Real-world fix (native Invoice Claims): the order-line
            // equivalent, populated only for a native claim line.
            orderLine: { select: { productId: true, requestedUnitCode: true } },
          },
        },
      },
    }),
  ]);

  const manualRows: ReturnedProductLostSaleRow[] = rawRows.map((row) => ({
    id: row.id,
    origin: "MANUAL_RETURN" as const,
    claimReturnId: row.claimReturnId,
    claimId: row.claimId,
    claimReference: row.claim.claimReference,
    claimLineId: row.claimLineId,
    customerId: row.customerId,
    customerName: row.customer.name,
    productId: row.claimLine?.sapInvoiceLine?.matchedOrderLine?.productId ?? row.claimLine?.orderLine?.productId ?? null,
    sapItemCodeSnapshot: row.sapItemCodeSnapshot,
    productDescriptionSnapshot: row.sapItemDescriptionSnapshot,
    unitOfMeasure: row.claimLine?.sapInvoiceLine?.unitOfMeasure ?? row.claimLine?.orderLine?.requestedUnitCode ?? null,
    quantity: row.claimReturn.receivedQuantity.toString(),
    unitPrice: row.estimatedUnitPrice?.toString() ?? null,
    totalValue: row.estimatedValue?.toString() ?? null,
    currencyCode: row.currencyCode,
    condition: row.claimReturn.condition,
    returnReference: row.claimReturn.returnReference,
    orderId: row.claim.orderId,
    orderReference: row.claim.order?.reference ?? null,
    sapInvoiceId: row.claim.sapInvoiceId,
    salespersonId: row.claim.order?.salespersonId ?? null,
    recordedAt: row.recordedAt,
    isDemo: row.isDemo,
  }));

  const delivery = await listDeliveryReturnRows({
    includeDemo: filters.includeDemo,
    customerId: filters.customerId,
    productId: filters.productId,
    salespersonId: filters.salespersonId,
    dateRange: filters.dateRange,
  });
  const deliveryRows: ReturnedProductLostSaleRow[] = delivery.rows.map((row) => ({
    id: row.id,
    origin: "DELIVERY_REJECTION" as const,
    claimReturnId: null,
    claimId: row.claimId,
    claimReference: row.claimReference,
    claimLineId: null,
    customerId: row.customerId,
    customerName: row.customerName,
    productId: row.productId,
    sapItemCodeSnapshot: row.sapItemCode,
    productDescriptionSnapshot: row.description,
    unitOfMeasure: row.unitOfMeasure,
    quantity: row.returnedQuantity,
    unitPrice: row.unitPrice,
    totalValue: row.totalValue,
    currencyCode: row.currencyCode,
    condition: "REJECTED_AT_DELIVERY",
    returnReference: `Delivery of ${row.orderReference}`,
    orderId: row.orderId,
    orderReference: row.orderReference,
    sapInvoiceId: null,
    salespersonId: row.salespersonId,
    recordedAt: row.recordedAt,
    isDemo: row.isDemo,
  }));

  const rows = [...manualRows, ...deliveryRows].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
  const matching = totalMatching + delivery.totalMatching;
  return {
    rows,
    totalMatching: matching,
    truncated: totalMatching > MAX_RETURNED_LOST_SALE_ROWS || delivery.truncated,
  };
}
