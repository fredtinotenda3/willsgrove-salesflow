/**
 * Milestone 2C. Builds the one set of rows every handover format (Excel,
 * CSV, clipboard) renders from -- the single source of truth for "what
 * goes in a handover," so the three formats can never show different
 * content for the same order. Always rebuilt fresh from the order's
 * CURRENT OrderLine/Product data at generation time (never cached,
 * never read back from an earlier OrderHandover row) -- a handover is an
 * operational document meant to be used in SAP right now, so it must
 * reflect the catalogue as it actually stands today, not a snapshot from
 * whenever the order happened to be created.
 *
 * Per the hard rule this whole project follows (SAP Business One owns
 * pricing; SalesFlow's job is product/quantity identification only), no
 * price field appears anywhere in a handover row.
 */
import "server-only";
import { prisma } from "@/lib/prisma";

export type HandoverRow = {
  lineNumber: number;
  originalDescription: string;
  sapItemCode: string | null;
  officialDescription: string | null;
  quantity: string;
  unit: string;
  /** True whenever there's at least a SAP item code to act on (a live product match, or a snapshot from a since-removed product) -- false only when there is nothing at all to look up in SAP. Never used to silently drop a row; see `note` below. */
  matched: boolean;
  /** Non-null whenever this line needs a human's attention before (or instead of) being processed as-is in SAP -- no match, a stale snapshot with no official description, or a product that's since been deactivated. Carried into every rendered format so an unresolved line is never silently invisible to the invoice team. */
  note: string | null;
};

export type HandoverOrderInfo = {
  orderId: string;
  reference: string;
  customerName: string;
  customerSapCode: string | null;
  customerPoReference: string | null;
  orderDate: string | null;
  requestedDeliveryDate: string | null;
};

export type BuildHandoverRowsResult =
  | { ok: true; order: HandoverOrderInfo; rows: HandoverRow[] }
  | { ok: false; status: number; message: string };

export async function buildHandoverRows(orderId: string): Promise<BuildHandoverRowsResult> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      reference: true,
      customerPoReference: true,
      orderDate: true,
      requestedDeliveryDate: true,
      customer: { select: { name: true, sapCustomerCode: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          lineNumber: true,
          originalProductDescription: true,
          sapItemCodeSnapshot: true,
          requestedQuantity: true,
          requestedUnitCode: true,
          product: { select: { sapItemCode: true, itemName: true, status: true } },
        },
      },
    },
  });

  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }
  if (order.lines.length === 0) {
    return { ok: false, status: 400, message: "This order has no lines to hand over." };
  }

  const rows: HandoverRow[] = order.lines.map((line) => {
    if (line.product) {
      return {
        lineNumber: line.lineNumber,
        originalDescription: line.originalProductDescription,
        sapItemCode: line.product.sapItemCode,
        officialDescription: line.product.itemName,
        quantity: line.requestedQuantity.toString(),
        unit: line.requestedUnitCode,
        matched: true,
        note:
          line.product.status === "INACTIVE"
            ? "Product is marked inactive in the catalogue -- confirm it's still valid in SAP before processing."
            : null,
      };
    }

    if (line.sapItemCodeSnapshot) {
      // The product this line resolved to at order time has since been
      // removed from the catalogue (Product.id -> OrderLine.productId is
      // onDelete: SetNull) -- the SAP code snapshot survives, but there's
      // no live official description to show.
      return {
        lineNumber: line.lineNumber,
        originalDescription: line.originalProductDescription,
        sapItemCode: line.sapItemCodeSnapshot,
        officialDescription: null,
        quantity: line.requestedQuantity.toString(),
        unit: line.requestedUnitCode,
        matched: true,
        note: "Product record no longer in the catalogue -- official description unavailable; verify this SAP code is still correct.",
      };
    }

    return {
      lineNumber: line.lineNumber,
      originalDescription: line.originalProductDescription,
      sapItemCode: null,
      officialDescription: null,
      quantity: line.requestedQuantity.toString(),
      unit: line.requestedUnitCode,
      matched: false,
      note: "No SAP product match -- resolve manually in SAP before processing this line.",
    };
  });

  return {
    ok: true,
    order: {
      orderId: order.id,
      reference: order.reference,
      customerName: order.customer.name,
      customerSapCode: order.customer.sapCustomerCode,
      customerPoReference: order.customerPoReference,
      orderDate: order.orderDate ? order.orderDate.toISOString().slice(0, 10) : null,
      requestedDeliveryDate: order.requestedDeliveryDate ? order.requestedDeliveryDate.toISOString().slice(0, 10) : null,
    },
    rows,
  };
}
