import "server-only";
import { prisma } from "@/lib/prisma";
import { getLiveApprovalRequestForQuotation } from "@/lib/approvals/queries";
import type { SapSalesOrderSubmission, SapSalesOrderLineSubmission } from "@/lib/integrations/sap/types";
import { buildSapSalesOrderIdempotencyKey } from "@/lib/integrations/sap/idempotency";

/**
 * Milestone 9 (SAP Business One Integration). Decides whether, and with
 * what data, a CustomerOrder can be submitted to SAP as a sales order
 * (spec section 10).
 *
 * **The central scope decision of this milestone**, confirmed by reading
 * lib/orders.ts and lib/quotations/convert-to-order.ts directly rather
 * than assumed: `OrderLine.approvedUnitPrice` and
 * `CustomerOrder.subtotal/taxTotal/total` are structurally always null
 * across the ENTIRE existing application today -- lib/orders.ts's own
 * comment says they "represent Willsgrove's APPROVED amounts, set later
 * by the price-decision/approval workflow (a later milestone)," and that
 * workflow has never been built, in any milestone up to and including
 * this one. The ONLY place a genuine, Sales-approved commercial price
 * exists anywhere in this codebase is `OrderLine.customerUnitPrice` on an
 * order created BY CONVERTING an accepted Quotation (`CustomerOrder.
 * source === "QUOTATION"`) -- lib/quotations/convert-to-order.ts sets
 * exactly that field from the quotation's own approved line price, and
 * nothing else in the order-creation path (lib/orders.ts's
 * createOrderCore, used by every manually-keyed/extracted order) ever
 * populates a price at all.
 *
 * Per the spec's explicit instruction to identify this kind of blocker
 * rather than invent a price: **only quotation-converted orders are
 * eligible for SAP sales-order submission in this milestone.** Every
 * other order's integration status is permanently NOT_READY until the
 * legacy pricing/discount-approval workflow is actually built in a later
 * milestone -- this is a real, intentional scope boundary, documented
 * prominently here, in docs/milestones/PROGRESS.md and in
 * MILESTONE-9-DELIVERY-REPORT.md, not something to work around quietly.
 */

export interface OrderEligibilityBlocker {
  code:
    | "NOT_FROM_QUOTATION"
    | "ORDER_CANCELLED_OR_REJECTED"
    | "LIVE_APPROVAL_PENDING"
    | "CUSTOMER_NOT_MAPPED"
    | "LINE_NOT_MATCHED_TO_PRODUCT"
    | "LINE_MISSING_PRICE"
    | "LINE_INVALID_QUANTITY"
    | "ALREADY_HAS_OUTBOX_ROW";
  message: string;
}

export interface OrderEligibilityResult {
  eligible: boolean;
  blockers: OrderEligibilityBlocker[];
  /** Present only when eligible -- everything createSalesOrder needs,
   * already resolved to real SAP identifiers. The adapter itself never
   * resolves a customer/product code (lib/integrations/sap/types.ts). */
  submission?: SapSalesOrderSubmission;
}

const DECIMAL_STRING_PATTERN = /^-?\d+(\.\d+)?$/;

export async function checkOrderEligibility(orderId: string): Promise<OrderEligibilityResult> {
  const order = await prisma.customerOrder.findUnique({
    where: { id: orderId },
    include: {
      customer: { select: { id: true, sapCustomerCode: true } },
      sourceQuotation: { select: { id: true } },
      lines: {
        select: {
          id: true,
          lineNumber: true,
          productId: true,
          requestedQuantity: true,
          customerUnitPrice: true,
          product: { select: { sapItemCode: true } },
        },
        orderBy: { lineNumber: "asc" },
      },
      integrationOperation: { select: { id: true } },
    },
  });

  if (!order) {
    return { eligible: false, blockers: [{ code: "NOT_FROM_QUOTATION", message: "Order not found." }] };
  }

  const blockers: OrderEligibilityBlocker[] = [];

  if (order.integrationOperation) {
    // Not actually "not ready" -- this order already has an outbox row
    // (PENDING/PROCESSING/SUCCEEDED/FAILED/UNCERTAIN); re-submission goes
    // through lib/integrations/sap/order-outbox.ts's own retry/
    // reconciliation path, never a second checkOrderEligibility-gated
    // create. Surfaced as a blocker here so a caller that only calls this
    // function gets an honest "cannot create a new submission," rather
    // than silently re-checking eligibility criteria that no longer
    // matter once an outbox row exists.
    blockers.push({ code: "ALREADY_HAS_OUTBOX_ROW", message: "This order already has a SAP sales-order submission record." });
  }

  if (order.status === "CANCELLED" || order.status === "REJECTED") {
    blockers.push({ code: "ORDER_CANCELLED_OR_REJECTED", message: `Order status is ${order.status}.` });
  }

  if (order.source !== "QUOTATION" || !order.sourceQuotation) {
    blockers.push({
      code: "NOT_FROM_QUOTATION",
      message:
        "This order was not created from an accepted quotation, so it has no Sales-approved commercial price. " +
        "SAP submission is only available for quotation-converted orders until the pricing/discount-approval workflow is built.",
    });
  } else {
    const liveApproval = await getLiveApprovalRequestForQuotation(order.sourceQuotation.id);
    if (liveApproval) {
      blockers.push({
        code: "LIVE_APPROVAL_PENDING",
        message: `The source quotation has a pending approval request (requires ${liveApproval.requiredApproverRole}) -- must be decided before this order can be submitted to SAP.`,
      });
    }
  }

  if (!order.customer.sapCustomerCode) {
    blockers.push({ code: "CUSTOMER_NOT_MAPPED", message: "This customer has no SAP customer code -- run customer sync, or map this customer manually." });
  }

  for (const line of order.lines) {
    if (!line.productId || !line.product?.sapItemCode) {
      blockers.push({ code: "LINE_NOT_MATCHED_TO_PRODUCT", message: `Line ${line.lineNumber} is not matched to a SAP product.` });
      continue;
    }
    if (line.customerUnitPrice === null) {
      blockers.push({ code: "LINE_MISSING_PRICE", message: `Line ${line.lineNumber} has no approved unit price.` });
    }
    const quantity = line.requestedQuantity.toString();
    if (!DECIMAL_STRING_PATTERN.test(quantity) || Number(quantity) <= 0) {
      blockers.push({ code: "LINE_INVALID_QUANTITY", message: `Line ${line.lineNumber} has an invalid quantity.` });
    }
  }

  if (blockers.length > 0) {
    return { eligible: false, blockers };
  }

  const lines: SapSalesOrderLineSubmission[] = order.lines.map((line) => ({
    lineNumber: line.lineNumber,
    sapItemCode: line.product!.sapItemCode,
    quantity: line.requestedQuantity.toString(),
    unitPrice: line.customerUnitPrice!.toString(),
  }));

  const submission: SapSalesOrderSubmission = {
    idempotencyKey: buildSapSalesOrderIdempotencyKey(order.id),
    customerOrderReference: order.reference,
    sapCustomerCode: order.customer.sapCustomerCode!,
    currency: order.currency,
    documentDate: (order.orderDate ?? order.createdAt).toISOString().slice(0, 10),
    lines,
  };

  return { eligible: true, blockers: [], submission };
}
