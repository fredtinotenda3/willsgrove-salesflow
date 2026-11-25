import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CLAIM_LINE_REASON_CATEGORY_LABELS } from "@/lib/invoice-claims/validation";
import {
  deriveLineReturnFacet,
  resolveRejectionReasonLabel,
  sumQuantities,
  type ReturnFacet,
} from "@/lib/invoice-claims/invoice-claim-state";
import { multiplyDecimalStrings } from "@/lib/lost-sales/validation";

/**
 * Invoice Claims register: the products customers RETURNED (some or all
 * of a line) because of a standardised delivery-outcome reason -- Price
 * Claim, Poor Quality Product, Short Delivered, OverSupply, Expire, No
 * Barcode, Barcode Scanning Problems, Duplicates. One row per rejected
 * order line, whether or not a claim has been filed yet, linked back to
 * the order, its SalesFlow invoice (when one was generated) and any claim.
 *
 * Rejected quantity is claim EXPOSURE, not a confirmed loss; the value
 * shown is rejected quantity x the order line's own price snapshot
 * (approvedUnitPrice ?? customerUnitPrice), null -- never 0 -- when the
 * line is unpriced.
 */
export type ReturnedProductsFilter = { search?: string; customerId?: string; claim?: "all" | "none" | "with" };

export type ReturnedProductRow = {
  key: string;
  orderId: string;
  orderReference: string;
  customerId: string;
  customerName: string;
  invoiceId: string | null;
  invoiceReference: string | null;
  orderLineId: string;
  description: string;
  sapItemCode: string | null;
  deliveredQuantity: string;
  acceptedQuantity: string;
  rejectedQuantity: string;
  returnedQuantity: string;
  returnFacet: ReturnFacet;
  reasonLabel: string | null;
  rejectedValue: string | null;
  currencyCode: string;
  deliveredAt: string;
  claims: { id: string; claimReference: string; status: string }[];
};

export async function listReturnedProducts(filter: ReturnedProductsFilter, page: number, pageSize: number) {
  const orderLineWhere: Prisma.OrderLineWhereInput = {
    ...(filter.claim === "none" ? { claimLines: { none: {} } } : {}),
    ...(filter.claim === "with" ? { claimLines: { some: {} } } : {}),
    order: {
      isDemo: false,
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.search
        ? {
            OR: [
              { reference: { contains: filter.search, mode: "insensitive" } },
              { customer: { name: { contains: filter.search, mode: "insensitive" } } },
            ],
          }
        : {}),
    },
  };
  const where: Prisma.DeliveryLineWhereInput = {
    rejectedQuantity: { gt: 0 },
    dispatchLine: { orderLine: orderLineWhere },
  };

  const [total, lines] = await Promise.all([
    prisma.deliveryLine.count({ where }),
    prisma.deliveryLine.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        acceptedQuantity: true,
        rejectedQuantity: true,
        rejectionReason: true,
        deliveryRecord: { select: { recordedAt: true } },
        dispatchLine: {
          select: {
            id: true,
            orderLine: {
              select: {
                id: true,
                originalProductDescription: true,
                sapItemCodeSnapshot: true,
                approvedUnitPrice: true,
                customerUnitPrice: true,
                product: { select: { sapItemCode: true } },
                claimLines: {
                  select: {
                    claim: { select: { id: true, claimReference: true, status: true } },
                    returns: { select: { receivedQuantity: true } },
                  },
                },
                order: {
                  select: {
                    id: true,
                    reference: true,
                    currency: true,
                    customer: { select: { id: true, name: true } },
                    matchedSapInvoices: {
                      where: { rawSourceData: { path: ["source"], equals: "NATIVE_RECORDING" } },
                      orderBy: { createdAt: "asc" },
                      take: 1,
                      select: { id: true, sapDocNum: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const rows: ReturnedProductRow[] = lines.map((line) => {
    const orderLine = line.dispatchLine.orderLine;
    const order = orderLine.order;
    const rejected = line.rejectedQuantity.toString();
    const accepted = line.acceptedQuantity.toString();
    // A rejection recorded at delivery IS a return: the goods came back to
    // Willsgrove with the delivery vehicle. The recorded rejected quantity is
    // therefore the returned quantity (no separate manual receipt is needed).
    const returned = rejected;
    const price = (orderLine.approvedUnitPrice ?? orderLine.customerUnitPrice)?.toString() ?? null;
    const claims = new Map<string, { id: string; claimReference: string; status: string }>();
    for (const cl of orderLine.claimLines) claims.set(cl.claim.id, cl.claim);
    const invoice = order.matchedSapInvoices[0] ?? null;
    return {
      key: `${line.dispatchLine.id}`,
      orderId: order.id,
      orderReference: order.reference,
      customerId: order.customer.id,
      customerName: order.customer.name,
      invoiceId: invoice?.id ?? null,
      invoiceReference: invoice?.sapDocNum ?? null,
      orderLineId: orderLine.id,
      description: orderLine.originalProductDescription,
      sapItemCode: orderLine.product?.sapItemCode ?? orderLine.sapItemCodeSnapshot ?? null,
      deliveredQuantity: sumQuantities([accepted, rejected]),
      acceptedQuantity: accepted,
      rejectedQuantity: rejected,
      returnedQuantity: returned,
      returnFacet: deriveLineReturnFacet(returned, rejected),
      reasonLabel: resolveRejectionReasonLabel(line.rejectionReason, CLAIM_LINE_REASON_CATEGORY_LABELS),
      rejectedValue: price === null ? null : multiplyDecimalStrings(price, rejected),
      currencyCode: order.currency,
      deliveredAt: line.deliveryRecord.recordedAt.toISOString(),
      claims: [...claims.values()],
    };
  });

  return { rows, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}

export type ReturnReasonSummaryRow = { reasonLabel: string; lineCount: number; rejectedQuantity: string };

/**
 * Management summary: why products are being rejected. One row per
 * recorded delivery-outcome reason across every rejected delivery line
 * (never limited to the current page), most frequent first.
 */
export async function getReturnReasonSummary(): Promise<ReturnReasonSummaryRow[]> {
  const groups = await prisma.deliveryLine.groupBy({
    by: ["rejectionReason"],
    where: { rejectedQuantity: { gt: 0 }, dispatchLine: { orderLine: { order: { isDemo: false } } } },
    _count: { _all: true },
    _sum: { rejectedQuantity: true },
  });
  const merged = new Map<string, ReturnReasonSummaryRow>();
  for (const group of groups) {
    const label = resolveRejectionReasonLabel(group.rejectionReason, CLAIM_LINE_REASON_CATEGORY_LABELS) ?? "Reason not recorded";
    const existing = merged.get(label);
    const quantity = group._sum.rejectedQuantity?.toString() ?? "0";
    merged.set(label, {
      reasonLabel: label,
      lineCount: (existing?.lineCount ?? 0) + group._count._all,
      rejectedQuantity: sumQuantities([existing?.rejectedQuantity, quantity]),
    });
  }
  return [...merged.values()].sort((a, b) => b.lineCount - a.lineCount);
}
