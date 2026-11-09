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
} satisfies Prisma.CustomerOrderSelect;

export async function listOrders(query: OrderListQuery) {
  const where: Prisma.CustomerOrderWhereInput = {};

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
    orders: rows.map((order) => ({
      id: order.id,
      reference: order.reference,
      customerPoReference: order.customerPoReference,
      status: order.status,
      source: order.source,
      orderDate: order.orderDate?.toISOString() ?? null,
      requestedDeliveryDate: order.requestedDeliveryDate?.toISOString() ?? null,
      total: order.total?.toString() ?? null,
      currency: order.currency,
      isDemo: order.isDemo,
      createdAt: order.createdAt.toISOString(),
      customer: order.customer,
      lineCount: order._count.lines,
    })),
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
    },
  });

  if (!order) return null;

  return {
    id: order.id,
    reference: order.reference,
    customerPoReference: order.customerPoReference,
    status: order.status,
    source: order.source,
    orderDate: order.orderDate?.toISOString() ?? null,
    requestedDeliveryDate: order.requestedDeliveryDate?.toISOString() ?? null,
    deliveryAddress: order.deliveryAddress,
    currency: order.currency,
    subtotal: order.subtotal?.toString() ?? null,
    taxTotal: order.taxTotal?.toString() ?? null,
    total: order.total?.toString() ?? null,
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
