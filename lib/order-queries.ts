import { Prisma, OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeOrderPricing, describePricingGaps, resolveVatRatePercent } from "@/lib/order-pricing";
import { loadTaxRatesByCode, resolveCustomerPriceListPrices } from "@/lib/order-price-resolution";
import { loadDispatchAssignmentHistory } from "@/lib/fulfilment/assignment-history-queries";

export const ORDER_DEFAULT_PAGE_SIZE = 50;
export const ORDER_MAX_PAGE_SIZE = 100;

const MAX_PAGE = 100000;
const MAX_SEARCH_LENGTH = 100;

export type OrderListQuery = {
  search: string;
  status: OrderStatus | null;
  // Demo rows are excluded by default everywhere real business figures are
  // read from, per the explicit instruction to keep seeded demo data out of
  // real reporting unless asked for.
  includeDemo: boolean;
  page: number;
  pageSize: number;
};

export type ParsedOrderListQuery =
  | { ok: true; query: OrderListQuery }
  | { ok: false; message: string };

function readInteger(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

export function parseOrderListQuery(params: URLSearchParams): ParsedOrderListQuery {
  const page = readInteger(params.get("page"), 1, 1, MAX_PAGE);
  if (page === null) return { ok: false, message: "Invalid page number." };

  const pageSize = readInteger(params.get("pageSize"), ORDER_DEFAULT_PAGE_SIZE, 1, ORDER_MAX_PAGE_SIZE);
  if (pageSize === null) {
    return { ok: false, message: `pageSize must be between 1 and ${ORDER_MAX_PAGE_SIZE}.` };
  }

  const search = (params.get("search") ?? "").trim();
  if (search.length > MAX_SEARCH_LENGTH) {
    return { ok: false, message: `Search text must be ${MAX_SEARCH_LENGTH} characters or fewer.` };
  }

  const rawStatus = (params.get("status") ?? "").trim().toUpperCase();
  let status: OrderStatus | null = null;
  if (rawStatus !== "" && rawStatus !== "ALL") {
    if (!(rawStatus in OrderStatus)) {
      return { ok: false, message: "Invalid status filter." };
    }
    status = rawStatus as OrderStatus;
  }

  const includeDemo = params.get("includeDemo") === "true";

  return { ok: true, query: { search, status, includeDemo, page, pageSize } };
}

const orderListSelect = {
  id: true,
  reference: true,
  customerPoReference: true,
  status: true,
  source: true,
  orderDate: true,
  requestedDeliveryDate: true,
  total: true,
  currency: true,
  isDemo: true,
  createdAt: true,
  customer: { select: { id: true, name: true } },
  _count: { select: { lines: true } },
  // Final completion phase, section 7: the raw `status` column alone
  // cannot tell the list page an order has actually departed/been
  // delivered (lib/order-display.ts's getEffectiveOrderStatus needs
  // these to derive that) -- CANCELLED dispatches are excluded because a
  // cancelled dispatch never counts as progress for this order.
  dispatchRecords: { where: { status: { not: "CANCELLED" } }, select: { status: true } },
  // Real-world fix ("all places with Pending pricing must populate with
  // price... ie Amount column on Workspace / Sales Management / Orders
  // page"): `total` above stays null until the (not-yet-built)
  // price-approval workflow sets it -- see createOrderCore's own comment
  // in lib/orders.ts. Rather than show nothing, summariseListOrderTotal below
  // sums each line's own customerUnitPrice x requestedQuantity as a
  // clearly-labelled estimate, using exactly the same per-line price this
  // order was actually submitted with.
  lines: { select: { requestedQuantity: true, customerUnitPrice: true, approvedUnitPrice: true, product: { select: { vatCode: true } } } },
} satisfies Prisma.CustomerOrderSelect;

// Order totals are derived from each line's stored unit-price snapshot by
// the one shared calculation in lib/order-pricing.ts (line totals, subtotal,
// configured tax, final total) -- the Orders list, the dashboard widget and
// the order detail page all go through it, so they cannot disagree. An
// order's own `total` column stays the APPROVED/SAP-confirmed amount and,
// when present, always wins over the derived figure on screen.
type PricedLineSource = {
  requestedQuantity: { toString(): string };
  customerUnitPrice: { toString(): string } | null;
  approvedUnitPrice: { toString(): string } | null;
  product: { vatCode: string | null } | null;
};

function toPricingInputs(lines: PricedLineSource[], taxRates: ReadonlyMap<string, string>) {
  return lines.map((line) => ({
    quantity: line.requestedQuantity.toString(),
    // Same `approvedUnitPrice ?? customerUnitPrice` convention used everywhere else in this codebase.
    unitPrice: (line.approvedUnitPrice ?? line.customerUnitPrice)?.toString() ?? null,
    vatRatePercent: resolveVatRatePercent(line.product?.vatCode, taxRates),
  }));
}

/**
 * Derived total for the Orders list / dashboard: the full total (subtotal +
 * configured tax) when every line is priced and taxed, and otherwise a
 * clearly-partial figure from what IS known -- never a guessed value, and
 * null (shown as "Pending pricing") only when no line has a price at all.
 */
function summariseListOrderTotal(lines: PricedLineSource[], taxRates: ReadonlyMap<string, string>) {
  const pricing = computeOrderPricing(toPricingInputs(lines, taxRates));
  return { estimatedTotal: pricing.total, estimatedTotalIsPartial: pricing.total !== null && !pricing.isComplete };
}

/**
 * Workflow/Navigation/Performance round, Part 2: once an invoice's
 * delivery outcome has been recorded (No Claim or With Claim), the
 * order behind it is DONE -- it must stop appearing in every active
 * Orders tab (including "All Orders") and live only on the dedicated
 * /delivered-orders page from here on, without being deleted or having
 * any other field touched.
 *
 * CustomerOrder.status itself never reflects this: it is pinned at
 * READY_TO_INVOICE forever once set there (prisma/schema.prisma's own
 * OrderStatus comment, and lib/order-display.ts's getEffectiveOrderStatus
 * module comment, both document why -- it's the SAP-handover gate, not a
 * tracked terminal state), so a status-only filter can never express
 * "delivered." The authoritative definition of "delivered" is, and must
 * stay, the SAME one lib/delivered-orders/queries.ts and
 * lib/invoice-delivery/queries.ts already use: an InvoiceDeliveryRecord
 * exists for an invoice matched to this order. Reusing
 * CustomerOrder.matchedSapInvoices (not the line-level
 * matchedSapInvoiceLines) is deliberate, not an oversight -- it is the
 * EXACT same header-level linkage /delivered-orders itself is built on
 * (lib/delivered-orders/queries.ts's own listDeliveredOrders), so an
 * order excluded here is always findable there; broadening this to the
 * line-level link would exclude a few more orders from this list while
 * /delivered-orders (unchanged) still couldn't show them, making an
 * order vanish from both views -- a regression strictly worse than the
 * rare multi-order-invoice edge case this leaves unexcluded.
 *
 * Applied unconditionally (every tab, not just READY_TO_INVOICE) so one
 * `where` clause is correct for every caller, including "All Orders" --
 * a REJECTED/CANCELLED/DRAFT order can never have a matched invoice at
 * all, so this is a no-op for those tabs, not a behavior change.
 *
 * NOT broadened to also exclude on a bare native DeliveryRecord (no
 * matched SapInvoice): that was tried and reverted in the Real Business
 * Data Onboarding round. A dispatch reaching DELIVERED natively means
 * the TRUCK is done, not that the ORDER is -- for a business that does
 * use SAP invoicing, a physically-delivered order still has real,
 * active work outstanding (invoicing, reconciliation, claims), and
 * dropping it off every Orders tab the moment the truck leaves would
 * hide that work, not finish it. (It also contradicted an existing,
 * intentional DB-integration-test expectation --
 * tests/delivered-orders-db.integration.test.ts's "removes an order
 * from every active Orders tab..." case builds its fixture via
 * createFullyDispatchedOrder(), which already calls
 * lib/fulfilment/delivery.ts's recordDelivery() for every dispatch
 * BEFORE the SAP invoice/outcome ever exists, and asserts the order is
 * still visible at that point.) The dispatch/delivery-level lifecycle
 * this business actually runs end-to-end without SAP is already
 * tracked correctly and separately, by lib/fulfilment/queries.ts's own
 * listDispatchQueue/listDeliveredOrders pair (FULLY_DELIVERED_CONDITION)
 * -- see app/components/sidebar.tsx's own comment for why "Delivered
 * Orders" in the nav already points at /deliveries/history, not here.
 * Whether a native delivery should ALSO retire an order from this main
 * Orders list is a real product question (raised back to the client,
 * not decided unilaterally here) -- answering it "yes" by default would
 * be indistinguishable, from this code alone, from quietly deciding this
 * business will never use SAP invoicing at all.
 */
const EXCLUDE_DELIVERED_ORDERS: Prisma.CustomerOrderWhereInput = {
  matchedSapInvoices: { none: { deliveryRecord: { isNot: null } } },
};

export async function listOrders(query: OrderListQuery) {
  const where: Prisma.CustomerOrderWhereInput = { ...EXCLUDE_DELIVERED_ORDERS };

  if (!query.includeDemo) {
    where.isDemo = false;
  }

  if (query.status) {
    where.status = query.status;
  }

  if (query.search) {
    where.OR = [
      { reference: { contains: query.search, mode: "insensitive" } },
      { customerPoReference: { contains: query.search, mode: "insensitive" } },
      { customer: { name: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  const [totalItems, rows] = await Promise.all([
    prisma.customerOrder.count({ where }),
    prisma.customerOrder.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: orderListSelect,
    }),
  ]);

  const taxRates = await loadTaxRatesByCode(rows.flatMap((order) => order.lines.map((line) => line.product?.vatCode)));

  return {
    orders: rows.map((order) => {
      const { estimatedTotal, estimatedTotalIsPartial } = summariseListOrderTotal(order.lines, taxRates);
      return {
        id: order.id,
        reference: order.reference,
        customerPoReference: order.customerPoReference,
        status: order.status,
        source: order.source,
        orderDate: order.orderDate?.toISOString() ?? null,
        requestedDeliveryDate: order.requestedDeliveryDate?.toISOString() ?? null,
        total: order.total?.toString() ?? null,
        estimatedTotal,
        estimatedTotalIsPartial,
        currency: order.currency,
        isDemo: order.isDemo,
        createdAt: order.createdAt.toISOString(),
        customer: order.customer,
        lineCount: order._count.lines,
        dispatchStatuses: order.dispatchRecords.map((d) => d.status),
      };
    }),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
    },
  };
}

export async function getOrderById(id: string) {
  const order = await prisma.customerOrder.findUnique({
    where: { id },
    select: {
      id: true,
      reference: true,
      customerPoReference: true,
      status: true,
      source: true,
      orderDate: true,
      requestedDeliveryDate: true,
      deliveryAddress: true,
      currency: true,
      subtotal: true,
      taxTotal: true,
      total: true,
      originalSourceText: true,
      internalNotes: true,
      isDemo: true,
      receivedAt: true,
      extractedAt: true,
      reviewedAt: true,
      approvedAt: true,
      handedToSapAt: true,
      invoicedAt: true,
      createdAt: true,
      updatedAt: true,
      customer: { select: { id: true, name: true, email: true, phone: true } },
      customerLocation: {
        select: { id: true, label: true, addressLine1: true, addressLine2: true, city: true, province: true },
      },
      createdBy: { select: { id: true, name: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true,
          lineNumber: true,
          originalProductDescription: true,
          productId: true,
          sapItemCodeSnapshot: true,
          requestedQuantity: true,
          requestedUnitCode: true,
          customerUnitPrice: true,
          approvedUnitPrice: true,
          lineTotal: true,
          salesNotes: true,
          // Milestone 3 completion (Warehouse Assembly Form). The
          // assembly form (app/orders/[id]/assembly-form/page.tsx) needs
          // the CURRENT live SAP item code/description, same three-way
          // preference (live product > sapItemCodeSnapshot > neither) as
          // lib/handover/build-handover-rows.ts already uses for the
          // invoice handover -- see lib/assembly-form/resolve-line.ts.
          // Added here, to the one existing order-detail query, rather
          // than a second near-duplicate query against CustomerOrder,
          // per the "reuse existing functionality" instruction: additive
          // only (new fields, nothing removed/renamed), so the two other
          // callers of getOrderById (app/orders/[id]/page.tsx,
          // app/fulfilment/[id]/page.tsx, app/api/orders/[id]/route.ts)
          // are unaffected.
          product: { select: { sapItemCode: true, itemName: true, vatCode: true } },
        },
      },
      documents: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          documentType: true,
          originalFileName: true,
          mimeType: true,
          fileSize: true,
          checksum: true,
          createdAt: true,
          uploadedBy: { select: { id: true, name: true } },
        },
      },
      statusHistory: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          fromStatus: true,
          toStatus: true,
          notes: true,
          createdAt: true,
          changedBy: { select: { id: true, name: true } },
        },
      },
      // Final completion phase, section 7 -- see orderListSelect's own
      // comment above for why this is needed and why CANCELLED is excluded.
      // Round-7 spec Section 7 follow-up: "Picking start time and picking
      // end time must be preserved and displayed in the order history...
      // Driver, assistant and vehicle assignments must be visible in the
      // order's fulfilment history" -- this was already true on the
      // Delivered Orders detail page (lib/delivered-orders/queries.ts's
      // getDeliveredOrderDetail), but an order's OWN /orders/[id] page
      // only ever showed the generic status-transition timeline below,
      // never picking/dispatch detail. Same select shape as
      // getDeliveredOrderDetail uses, reused here rather than redefined,
      // so the two pages can never disagree about what a picking session
      // or dispatch record looked like.
      pickingSessions: {
        orderBy: { startedAt: "asc" },
        select: {
          id: true,
          status: true,
          startedAt: true,
          startedBy: { select: { name: true } },
          completedAt: true,
          completedBy: { select: { name: true } },
          authorizedAt: true,
          authorizedBy: { select: { name: true } },
        },
      },
      dispatchRecords: {
        where: { status: { not: "CANCELLED" } },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          status: true,
          plannedDepartureAt: true,
          departedAt: true,
          departedBy: { select: { name: true } },
          createdBy: { select: { name: true } },
          vehicleOrCourierReference: true,
          driver: { select: { name: true } },
          assistant: { select: { name: true } },
          vehicle: { select: { registrationNumber: true } },
          // Real-world fix ("Order Fulfilment History should include all
          // products accepted and rejected, if any"): same deliveryRecord
          // select shape lib/delivered-orders/queries.ts's
          // getDeliveredOrderDetail already uses, reused here rather than
          // redefined -- per-product accepted/rejected quantity and
          // rejection reason, from the physical delivery outcome, not the
          // SAP invoice. Absent entirely (never a fabricated "0 rejected")
          // until a delivery outcome has actually been recorded.
          deliveryRecord: {
            select: {
              outcome: true,
              recordedAt: true,
              recipientName: true,
              recordedBy: { select: { name: true } },
              lines: {
                select: {
                  acceptedQuantity: true,
                  rejectedQuantity: true,
                  rejectionReason: true,
                  dispatchLine: { select: { orderLine: { select: { originalProductDescription: true, sapItemCodeSnapshot: true } } } },
                },
              },
            },
          },
        },
      },
      // Workflow/Navigation/Performance round, Part 3: real related-record
      // IDs for the order detail page's "related records" panel and
      // lifecycle indicator -- every relation here already exists on
      // CustomerOrder (see that model's own relation block), so this is
      // read-only reuse, not a new query path or a second definition of
      // any of these relationships. Header-level matchedSapInvoices is
      // used rather than the line-level matchedSapInvoiceLines, same
      // choice and same reasoning as EXCLUDE_DELIVERED_ORDERS above (an
      // order detail page showing "this order's invoice" should show
      // exactly the invoice /delivered-orders itself would show for it,
      // never a second, line-level reading that could disagree).
      matchedSapInvoices: {
        select: {
          id: true,
          sapDocNum: true,
          reconciliationStatus: true,
          deliveryRecord: { select: { id: true, outcome: true } },
        },
      },
      invoiceClaims: {
        orderBy: { claimDate: "desc" },
        select: { id: true, claimReference: true, status: true },
      },
      unfulfilledDemands: {
        orderBy: { createdAt: "desc" },
        // Real-world fix ("ID pages... should carry also the amount of
        // lost sales, not just quantity"): this card only ever showed
        // the status badge. confirmedLostQuantity/estimatedValue are
        // already resolved and stored directly on UnfulfilledDemand
        // (see that model's own schema comment) -- added here, nothing
        // new to compute.
        select: {
          id: true,
          status: true,
          confirmedLostQuantity: true,
          estimatedValue: true,
        },
      },
    },
  });

  if (!order) return null;

  // Pricing (lib/order-pricing.ts). The price used for a line is its stored
  // snapshot (approvedUnitPrice ?? customerUnitPrice) -- never re-resolved
  // when one exists, which is what keeps historical orders on the price
  // they were created with. Only a line with NO snapshot at all falls back
  // to the customer's CURRENT price-list price, and that value is flagged
  // (`priceSource: "PRICE_LIST_CURRENT"`) so the UI can say it is not a
  // stored price. The fallback is skipped when the price list's currency
  // differs from the order's: a price is never shown under a currency it
  // wasn't quoted in.
  const unsnapshottedProductIds = order.lines
    .filter((line) => (line.approvedUnitPrice ?? line.customerUnitPrice) === null && line.productId)
    .map((line) => line.productId as string);
  const currentListPrices =
    unsnapshottedProductIds.length > 0
      ? await resolveCustomerPriceListPrices(prisma, order.customer.id, unsnapshottedProductIds)
      : null;
  const currentListPricesUsable = currentListPrices?.currencyCode === order.currency;
  const taxRates = await loadTaxRatesByCode(order.lines.map((line) => line.product?.vatCode));
  const assignmentHistory = await loadDispatchAssignmentHistory(order.dispatchRecords.map((dispatch) => dispatch.id));

  const pricedLines = order.lines.map((line) => {
    const snapshot = (line.approvedUnitPrice ?? line.customerUnitPrice)?.toString() ?? null;
    const live =
      snapshot === null && currentListPricesUsable && line.productId
        ? (currentListPrices?.priceByProductId.get(line.productId) ?? null)
        : null;
    return {
      unitPrice: snapshot ?? live,
      priceSource: (snapshot !== null ? "SNAPSHOT" : live !== null ? "PRICE_LIST_CURRENT" : null) as
        | "SNAPSHOT"
        | "PRICE_LIST_CURRENT"
        | null,
    };
  });
  const pricing = computeOrderPricing(
    order.lines.map((line, index) => ({
      quantity: line.requestedQuantity.toString(),
      unitPrice: pricedLines[index].unitPrice,
      vatRatePercent: resolveVatRatePercent(line.product?.vatCode, taxRates),
    }))
  );

  return {
    id: order.id,
    reference: order.reference,
    customerPoReference: order.customerPoReference,
    status: order.status,
    dispatchStatuses: order.dispatchRecords.map((d) => d.status),
    // Section 7 follow-up (see the select above's comment): same field
    // names/shape as getDeliveredOrderDetail's pickingSessions/dispatches,
    // deliberately, so a future shared component could render either.
    pickingSessions: order.pickingSessions.map((session) => ({
      id: session.id,
      status: session.status,
      startedByName: session.startedBy.name,
      startedAt: session.startedAt.toISOString(),
      completedByName: session.completedBy?.name ?? null,
      completedAt: session.completedAt?.toISOString() ?? null,
      authorizedByName: session.authorizedBy?.name ?? null,
      authorizedAt: session.authorizedAt?.toISOString() ?? null,
    })),
    dispatches: order.dispatchRecords.map((dispatch) => ({
      id: dispatch.id,
      status: dispatch.status,
      driverName: dispatch.driver?.name ?? null,
      assistantName: dispatch.assistant?.name ?? null,
      vehicleRegistration: dispatch.vehicle?.registrationNumber ?? null,
      vehicleOrCourierReference: dispatch.vehicleOrCourierReference,
      plannedDepartureAt: dispatch.plannedDepartureAt?.toISOString() ?? null,
      departedAt: dispatch.departedAt?.toISOString() ?? null,
      departedByName: dispatch.departedBy?.name ?? null,
      createdByName: dispatch.createdBy.name,
      // Recorded initial assignment + every later change (who, when, why,
      // before/after) -- lib/fulfilment/assignment-history.ts. Empty for a
      // dispatch with no recorded events; never reconstructed.
      assignmentHistory: assignmentHistory.get(dispatch.id) ?? [],
      // Real-world fix ("Order Fulfilment History should include all
      // products accepted and rejected, if any") -- null until a
      // delivery outcome has actually been recorded for this dispatch.
      delivery: dispatch.deliveryRecord
        ? {
            outcome: dispatch.deliveryRecord.outcome,
            recordedAt: dispatch.deliveryRecord.recordedAt.toISOString(),
            recipientName: dispatch.deliveryRecord.recipientName,
            recordedByName: dispatch.deliveryRecord.recordedBy.name,
            lines: dispatch.deliveryRecord.lines.map((line) => ({
              description: line.dispatchLine.orderLine.originalProductDescription,
              sapItemCode: line.dispatchLine.orderLine.sapItemCodeSnapshot,
              acceptedQuantity: line.acceptedQuantity.toString(),
              rejectedQuantity: line.rejectedQuantity.toString(),
              rejectionReason: line.rejectionReason,
            })),
          }
        : null,
    })),
    source: order.source,
    orderDate: order.orderDate?.toISOString() ?? null,
    requestedDeliveryDate: order.requestedDeliveryDate?.toISOString() ?? null,
    deliveryAddress: order.deliveryAddress,
    currency: order.currency,
    subtotal: order.subtotal?.toString() ?? null,
    taxTotal: order.taxTotal?.toString() ?? null,
    total: order.total?.toString() ?? null,
    // Derived figures (never stored): see lib/order-pricing.ts. `total`
    // above remains the approved/SAP-confirmed amount and wins on screen
    // whenever it is present.
    estimatedTotal: pricing.total,
    estimatedTotalIsPartial: pricing.total !== null && !pricing.isComplete,
    pricing: {
      subtotal: pricing.subtotal,
      taxTotal: pricing.taxTotal,
      total: pricing.total,
      pricedLineCount: pricing.pricedLineCount,
      unpricedLineCount: pricing.unpricedLineCount,
      taxUnconfiguredLineCount: pricing.taxUnconfiguredLineCount,
      isComplete: pricing.isComplete,
      gapsExplanation: describePricingGaps(pricing),
    },
    originalSourceText: order.originalSourceText,
    internalNotes: order.internalNotes,
    isDemo: order.isDemo,
    timing: {
      receivedAt: order.receivedAt?.toISOString() ?? null,
      extractedAt: order.extractedAt?.toISOString() ?? null,
      reviewedAt: order.reviewedAt?.toISOString() ?? null,
      approvedAt: order.approvedAt?.toISOString() ?? null,
      handedToSapAt: order.handedToSapAt?.toISOString() ?? null,
      invoicedAt: order.invoicedAt?.toISOString() ?? null,
    },
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    customer: order.customer,
    customerLocation: order.customerLocation,
    createdBy: order.createdBy,
    lines: order.lines.map((line, index) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      originalProductDescription: line.originalProductDescription,
      productId: line.productId,
      sapItemCodeSnapshot: line.sapItemCodeSnapshot,
      requestedQuantity: line.requestedQuantity.toString(),
      requestedUnitCode: line.requestedUnitCode,
      customerUnitPrice: line.customerUnitPrice?.toString() ?? null,
      approvedUnitPrice: line.approvedUnitPrice?.toString() ?? null,
      // SAP-reconciled total; null until invoice reconciliation sets it.
      lineTotal: line.lineTotal?.toString() ?? null,
      // Unit price actually used for the derived figures below, and where
      // it came from ("SNAPSHOT" = stored on the line; "PRICE_LIST_CURRENT"
      // = no snapshot, taken from the customer's current price list).
      unitPrice: pricedLines[index].unitPrice,
      priceSource: pricedLines[index].priceSource,
      // Derived per-line figures (lib/order-pricing.ts). Null exactly when
      // the line has no usable price -- never a fabricated zero.
      lineSubtotal: pricing.lines[index].subtotal,
      lineTax: pricing.lines[index].tax,
      lineTaxConfigured: pricing.lines[index].taxConfigured,
      estimatedLineTotal: pricing.lines[index].total,
      salesNotes: line.salesNotes,
      // Milestone 3 completion. Null when this line's product has since
      // been removed from the catalogue (onDelete: SetNull) or never
      // matched one at all -- lib/assembly-form/resolve-line.ts falls
      // back to sapItemCodeSnapshot/originalProductDescription for
      // those cases, same as the handover already does.
      productSapItemCode: line.product?.sapItemCode ?? null,
      officialProductDescription: line.product?.itemName ?? null,
    })),
    documents: order.documents.map((doc) => ({
      id: doc.id,
      documentType: doc.documentType,
      originalFileName: doc.originalFileName,
      mimeType: doc.mimeType,
      fileSize: Number(doc.fileSize),
      checksum: doc.checksum,
      createdAt: doc.createdAt.toISOString(),
      uploadedBy: doc.uploadedBy,
      downloadUrl: `/api/files/${doc.id}`,
    })),
    statusHistory: order.statusHistory.map((entry) => ({
      id: entry.id,
      fromStatus: entry.fromStatus,
      toStatus: entry.toStatus,
      notes: entry.notes,
      createdAt: entry.createdAt.toISOString(),
      changedBy: entry.changedBy,
    })),
    // Workflow/Navigation/Performance round, Part 3.
    matchedSapInvoices: order.matchedSapInvoices.map(
      (invoice: { id: string; sapDocNum: string; reconciliationStatus: string; deliveryRecord: { id: string; outcome: string } | null }) => ({
        id: invoice.id,
        sapDocNum: invoice.sapDocNum,
        reconciliationStatus: invoice.reconciliationStatus,
        delivered: invoice.deliveryRecord !== null,
        deliveryOutcome: invoice.deliveryRecord?.outcome ?? null,
      }),
    ),
    invoiceClaims: order.invoiceClaims.map((claim: { id: string; claimReference: string; status: string }) => ({
      id: claim.id,
      claimReference: claim.claimReference,
      status: claim.status,
    })),
    unfulfilledDemands: order.unfulfilledDemands.map(
      (demand: {
        id: string;
        status: string;
        confirmedLostQuantity: { toString(): string };
        estimatedValue: { toString(): string } | null;
      }) => ({
        id: demand.id,
        status: demand.status,
        confirmedLostQuantity: demand.confirmedLostQuantity.toString(),
        estimatedValue: demand.estimatedValue?.toString() ?? null,
      })
    ),
  };
}

/**
 * Real (non-demo) order counts for the dashboard. See CHANGES.md for why
 * "Awaiting Fulfilment" / "Completed Deliveries" are derived this way --
 * the schema has no dedicated FULFILLED/DELIVERED status, so these are a
 * documented best-effort mapping onto the timing fields, flagged for
 * Stanley to confirm against how SAP B1 actually reports this.
 */
export async function getDashboardOrderCounts() {
  const [total, awaitingFulfilment, completedDeliveries] = await Promise.all([
    prisma.customerOrder.count({ where: { isDemo: false } }),
    prisma.customerOrder.count({
      where: { isDemo: false, status: OrderStatus.APPROVED, handedToSapAt: null },
    }),
    prisma.customerOrder.count({ where: { isDemo: false, invoicedAt: { not: null } } }),
  ]);

  return { total, awaitingFulfilment, completedDeliveries };
}
