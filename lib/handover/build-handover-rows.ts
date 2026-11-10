/**
 * Milestone 2C, reworked in Milestone 3C (SAP Invoice Handover
 * Specification). Builds the one set of rows every handover format
 * (Excel, CSV, clipboard) renders from -- the single source of truth for
 * "what goes in a handover," so the three formats can never show
 * different content for the same order.
 *
 * Milestone 3C changes, both per the spec:
 *
 * 1. **Hard-blocked** unless the order is OrderStatus.READY_TO_INVOICE --
 *    the spec requires generation to be refused "if an order has not
 *    completed picking verification, or the quantities have not been
 *    authorized." READY_TO_INVOICE is set by exactly one place
 *    (lib/picking/authorize-picking.ts, when a COMPLETED PickingSession
 *    is authorized) and nowhere else, so this one status check is an
 *    exact proxy for both halves of that requirement.
 * 2. **Quantity is now the authorized PICKED quantity**
 *    (PickingLine.foundQuantity), never OrderLine.requestedQuantity --
 *    sourced from the order's most recently AUTHORIZED PickingSession, not
 *    live OrderLine/Product data for the quantity itself (though the SAP
 *    item code/description resolution below is still always current, for
 *    the same "reflect the catalogue as it actually stands today" reason
 *    as before). A line whose foundQuantity is exactly zero (100%
 *    unavailable) is omitted entirely -- per your confirmed Milestone 3A
 *    decision ("omit entirely" for a fully-unavailable line) -- counted
 *    in `omittedLineCount` so it's never a *silent* omission even though
 *    it never becomes a row.
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
  /** The ORDER's own reference (e.g. "ORD-..."). Distinct from the handover's own "Handover Reference", which generate-handover.ts generates separately per handover. */
  reference: string;
  customerName: string;
  customerSapCode: string | null;
  customerPoReference: string | null;
  orderDate: string | null;
  requestedDeliveryDate: string | null;
  /** The AUTHORIZED PickingSession these rows' quantities were sourced from -- recorded on the created OrderHandover row so the traceability chain (spec section 6) is never ambiguous even after a later re-pick. */
  pickingSessionId: string;
  authorizedByName: string;
  authorizedAt: string;
};

export type BuildHandoverRowsResult =
  | { ok: true; order: HandoverOrderInfo; rows: HandoverRow[]; omittedLineCount: number }
  | { ok: false; status: number; message: string };

export async function buildHandoverRows(orderId: string): Promise<BuildHandoverRowsResult> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      reference: true,
      status: true,
      customerPoReference: true,
      orderDate: true,
      requestedDeliveryDate: true,
      customer: { select: { name: true, sapCustomerCode: true } },
    },
  });

  if (!order) {
    return { ok: false, status: 404, message: "Order not found." };
  }

  // The spec's hard gate. READY_TO_INVOICE is set in exactly one place
  // (authorize-picking.ts) and nowhere else, so this single check stands
  // in for both halves of the spec's requirement ("has not completed
  // picking verification, or the quantities have not been authorized").
  if (order.status !== "READY_TO_INVOICE") {
    return {
      ok: false,
      status: 409,
      message:
        "This order's picking has not been completed and authorized yet. An SAP Invoice Handover can only be generated once a picking session for this order has been authorized.",
    };
  }

  const session = await prisma.pickingSession.findFirst({
    where: { orderId, status: "AUTHORIZED" },
    orderBy: { authorizedAt: "desc" },
    select: {
      id: true,
      authorizedAt: true,
      authorizedBy: { select: { name: true } },
      lines: {
        select: {
          foundQuantity: true,
          orderLine: {
            select: {
              lineNumber: true,
              originalProductDescription: true,
              sapItemCodeSnapshot: true,
              requestedUnitCode: true,
              product: { select: { sapItemCode: true, itemName: true, status: true } },
            },
          },
        },
      },
    },
  });

  // Should never happen given the status check above -- READY_TO_INVOICE
  // is only ever set in the same transaction that authorizes a session
  // (see lib/picking/authorize-picking.ts) -- but defended explicitly
  // rather than trusting that invariant blindly from here.
  if (!session) {
    return {
      ok: false,
      status: 409,
      message: "No authorized picking session was found for this order.",
    };
  }

  const includedLines = session.lines.filter((line) => line.foundQuantity !== null && !line.foundQuantity.isZero());
  const omittedLineCount = session.lines.length - includedLines.length;

  if (includedLines.length === 0) {
    return {
      ok: false,
      status: 400,
      message: "Every line was fully unavailable in picking -- there is nothing to hand over for this order.",
    };
  }

  const rows: HandoverRow[] = includedLines
    .slice()
    .sort((a, b) => a.orderLine.lineNumber - b.orderLine.lineNumber)
    .map((line) => {
      const quantity = line.foundQuantity!.toString();
      const { orderLine } = line;

      if (orderLine.product) {
        return {
          lineNumber: orderLine.lineNumber,
          originalDescription: orderLine.originalProductDescription,
          sapItemCode: orderLine.product.sapItemCode,
          officialDescription: orderLine.product.itemName,
          quantity,
          unit: orderLine.requestedUnitCode,
          matched: true,
          note:
            orderLine.product.status === "INACTIVE"
              ? "Product is marked inactive in the catalogue -- confirm it's still valid in SAP before processing."
              : null,
        };
      }

      if (orderLine.sapItemCodeSnapshot) {
        // The product this line resolved to at order time has since been
        // removed from the catalogue (Product.id -> OrderLine.productId is
        // onDelete: SetNull) -- the SAP code snapshot survives, but there's
        // no live official description to show.
        return {
          lineNumber: orderLine.lineNumber,
          originalDescription: orderLine.originalProductDescription,
          sapItemCode: orderLine.sapItemCodeSnapshot,
          officialDescription: null,
          quantity,
          unit: orderLine.requestedUnitCode,
          matched: true,
          note: "Product record no longer in the catalogue -- official description unavailable; verify this SAP code is still correct.",
        };
      }

      return {
        lineNumber: orderLine.lineNumber,
        originalDescription: orderLine.originalProductDescription,
        sapItemCode: null,
        officialDescription: null,
        quantity,
        unit: orderLine.requestedUnitCode,
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
      pickingSessionId: session.id,
      authorizedByName: session.authorizedBy?.name ?? "Unknown",
      authorizedAt: session.authorizedAt ? session.authorizedAt.toISOString() : "",
    },
    rows,
    omittedLineCount,
  };
}
