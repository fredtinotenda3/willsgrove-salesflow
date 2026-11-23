import { Prisma, OrderStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

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
  // in lib/orders.ts. Rather than show nothing, estimateOrderTotal below
  // sums each line's own customerUnitPrice x requestedQuantity as a
  // clearly-labelled estimate, using exactly the same per-line price this
  // order was actually submitted with.
  lines: { select: { requestedQuantity: true, customerUnitPrice: true } },
} satisfies Prisma.CustomerOrderSelect;

// Scaled-bigint decimal-string arithmetic (never floats), matching this
// codebase's house convention for money (lib/fulfilment/decimal.ts /
// lib/picking/validation.ts). Mirrors app/orders/new/page.tsx's own
// computeLinePreviewTotal rather than importing across domains (see
// lib/customers.ts's isUniqueViolation for why duplication is this
// codebase's deliberate convention here).
const ESTIMATE_DECIMAL_PATTERN = /^\d+(\.\d{1,4})?$/;

function parseEstimateScaledDecimal(value: string): bigint | null {
  if (!ESTIMATE_DECIMAL_PATTERN.test(value)) return null;
  const [intPart, fracPartRaw = ""] = value.split(".");
  return BigInt(intPart) * BigInt(10_000) + BigInt(fracPartRaw.padEnd(4, "0"));
}

function formatEstimateScaledDecimal(scaled: bigint): string {
  const intPart = scaled / BigInt(10_000);
  const fracPart = scaled % BigInt(10_000);
  return `${intPart}.${fracPart.toString().padStart(4, "0").slice(0, 2)}`;
}

/**
 * Sums requestedQuantity x customerUnitPrice across an order's lines.
 * Returns null (never a guessed/partial figure silently presented as
 * whole) when there are no lines, or ANY line is missing a resolvable
 * price/quantity -- isPartial distinguishes "no estimate possible" from
 * "some but not all lines priced" so the UI can caveat correctly rather
 * than quietly understating the real total.
 *
 * Exported (not just used by listOrders above): "Order Total" on the
 * order detail page (app/orders/[id]/page.tsx) and the dashboard's
 * recent-orders widget (app/page.tsx) both still called plain
 * formatOrderAmount(order.total, ...) directly -- the exact same
 * "Pending pricing" staleness this function's own fallback was built to
 * fix on the Orders list, just never wired to these other two callers.
 * getOrderById below now computes and returns the same
 * estimatedTotal/estimatedTotalIsPartial pair so every place that shows
 * an order's total uses the one shared estimate, never a second
 * reimplementation.
 */
export function estimateOrderTotal(
  lines: { requestedQuantity: { toString(): string }; customerUnitPrice: { toString(): string } | null }[]
): { estimatedTotal: string | null; estimatedTotalIsPartial: boolean } {
  if (lines.length === 0) return { estimatedTotal: null, estimatedTotalIsPartial: false };

  let sum = BigInt(0);
  let pricedLineCount = 0;

  for (const line of lines) {
    if (line.customerUnitPrice === null) continue;
    const quantity = parseEstimateScaledDecimal(line.requestedQuantity.toString());
    const unitPrice = parseEstimateScaledDecimal(line.customerUnitPrice.toString());
    if (quantity === null || unitPrice === null) continue;
    sum += (quantity * unitPrice) / BigInt(10_000);
    pricedLineCount += 1;
  }

  if (pricedLineCount === 0) return { estimatedTotal: null, estimatedTotalIsPartial: false };
  return {
    estimatedTotal: formatEstimateScaledDecimal(sum),
    estimatedTotalIsPartial: pricedLineCount < lines.length,
  };
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

  return {
    orders: rows.map((order) => {
      const { estimatedTotal, estimatedTotalIsPartial } = estimateOrderTotal(order.lines);
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
          verificationStatus: true,
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
          product: { select: { sapItemCode: true, itemName: true } },
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
      dispatchRecords: { where: { status: { not: "CANCELLED" } }, select: { status: true } },
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

  return {
    id: order.id,
    reference: order.reference,
    customerPoReference: order.customerPoReference,
    status: order.status,
    dispatchStatuses: order.dispatchRecords.map((d) => d.status),
    source: order.source,
    orderDate: order.orderDate?.toISOString() ?? null,
    requestedDeliveryDate: order.requestedDeliveryDate?.toISOString() ?? null,
    deliveryAddress: order.deliveryAddress,
    currency: order.currency,
    subtotal: order.subtotal?.toString() ?? null,
    taxTotal: order.taxTotal?.toString() ?? null,
    total: order.total?.toString() ?? null,
    ...estimateOrderTotal(order.lines),
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
    lines: order.lines.map((line) => ({
      id: line.id,
      lineNumber: line.lineNumber,
      originalProductDescription: line.originalProductDescription,
      productId: line.productId,
      sapItemCodeSnapshot: line.sapItemCodeSnapshot,
      requestedQuantity: line.requestedQuantity.toString(),
      requestedUnitCode: line.requestedUnitCode,
      customerUnitPrice: line.customerUnitPrice?.toString() ?? null,
      approvedUnitPrice: line.approvedUnitPrice?.toString() ?? null,
      lineTotal: line.lineTotal?.toString() ?? null,
      verificationStatus: line.verificationStatus,
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
  const [total, pendingVerification, awaitingFulfilment, completedDeliveries] = await Promise.all([
    prisma.customerOrder.count({ where: { isDemo: false } }),
    prisma.customerOrder.count({ where: { isDemo: false, status: OrderStatus.PENDING_VERIFICATION } }),
    prisma.customerOrder.count({
      where: { isDemo: false, status: OrderStatus.APPROVED, handedToSapAt: null },
    }),
    prisma.customerOrder.count({ where: { isDemo: false, invoicedAt: { not: null } } }),
  ]);

  return { total, pendingVerification, awaitingFulfilment, completedDeliveries };
}
