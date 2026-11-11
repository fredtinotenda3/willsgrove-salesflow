import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeOrderLineReconciliation, type OrderLineInvoiceStatusValue } from "@/lib/invoice-reconciliation/reconcile";

/**
 * Milestone 5 (SAP Invoice Reconciliation). Read-only helpers for the
 * reconciliation queue, invoice detail, import history and reports UI
 * (spec section 10.B/10.C/10.A/10.D) -- same role lib/lost-sales/queries.ts
 * plays for Milestone 4.
 */

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;
const MAX_PAGE = 100000;

function readInteger(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

const RECONCILIATION_STATUS_VALUES = new Set([
  "UNMATCHED",
  "PARTIALLY_MATCHED",
  "RECONCILIATION_REQUIRED",
  "MATCHED",
  "CANCELLED_REVERSED",
]);

export type ListSapInvoicesOptions = {
  page: number;
  pageSize: number;
  includeDemo?: boolean;
  reconciliationStatus?: string;
  customerId?: string;
  // Milestone 6A (Invoice Claims Management): a small, purely additive
  // extension so the claim-creation form can look up a SAP invoice by
  // its document number without a separate, duplicate query function.
  // Optional and backward-compatible -- every existing caller that omits
  // it sees unchanged behavior.
  search?: string;
};

export type ParsedSapInvoiceListQuery = { ok: true; query: ListSapInvoicesOptions } | { ok: false; message: string };

export function parseSapInvoiceListQuery(params: URLSearchParams): ParsedSapInvoiceListQuery {
  const page = readInteger(params.get("page"), 1, 1, MAX_PAGE);
  if (page === null) return { ok: false, message: "Invalid page number." };

  const pageSize = readInteger(params.get("pageSize"), DEFAULT_PAGE_SIZE, 1, MAX_PAGE_SIZE);
  if (pageSize === null) return { ok: false, message: `pageSize must be between 1 and ${MAX_PAGE_SIZE}.` };

  const rawStatus = (params.get("status") ?? "").trim().toUpperCase();
  let reconciliationStatus: string | undefined;
  if (rawStatus !== "" && rawStatus !== "ALL") {
    if (!RECONCILIATION_STATUS_VALUES.has(rawStatus)) return { ok: false, message: "Invalid status filter." };
    reconciliationStatus = rawStatus;
  }

  const customerId = params.get("customerId")?.trim() || undefined;
  const includeDemo = params.get("includeDemo") === "true";
  const search = params.get("search")?.trim() || undefined;

  return { ok: true, query: { page, pageSize, reconciliationStatus, customerId, includeDemo, search } };
}

export type SapInvoiceSummary = {
  id: string;
  sapDocNum: string;
  sapDocEntry: string | null;
  customerSapCode: string | null;
  customerName: string | null;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  invoiceDate: string | null;
  currencyCode: string | null;
  total: string | null;
  matchedOrderId: string | null;
  matchedOrderReference: string | null;
  reconciliationStatus: string;
  isCancelledOrReversed: boolean;
  lineCount: number;
  unresolvedLineCount: number;
  isDemo: boolean;
  createdAt: string;
};

const INVOICE_SUMMARY_SELECT = {
  id: true,
  sapDocNum: true,
  sapDocEntry: true,
  customerSapCode: true,
  customerName: true,
  matchedCustomerId: true,
  matchedCustomer: { select: { name: true } },
  invoiceDate: true,
  currencyCode: true,
  total: true,
  matchedOrderId: true,
  matchedOrder: { select: { reference: true } },
  reconciliationStatus: true,
  isCancelledOrReversed: true,
  isDemo: true,
  createdAt: true,
  lines: { select: { matchStatus: true } },
} as const;

type InvoiceSummaryRow = {
  id: string;
  sapDocNum: string;
  sapDocEntry: string | null;
  customerSapCode: string | null;
  customerName: string | null;
  matchedCustomerId: string | null;
  matchedCustomer: { name: string } | null;
  invoiceDate: Date | null;
  currencyCode: string | null;
  total: { toString(): string } | null;
  matchedOrderId: string | null;
  matchedOrder: { reference: string } | null;
  reconciliationStatus: string;
  isCancelledOrReversed: boolean;
  isDemo: boolean;
  createdAt: Date;
  lines: { matchStatus: string }[];
};

function toInvoiceSummary(row: InvoiceSummaryRow): SapInvoiceSummary {
  return {
    id: row.id,
    sapDocNum: row.sapDocNum,
    sapDocEntry: row.sapDocEntry,
    customerSapCode: row.customerSapCode,
    customerName: row.customerName,
    matchedCustomerId: row.matchedCustomerId,
    matchedCustomerName: row.matchedCustomer?.name ?? null,
    invoiceDate: row.invoiceDate ? row.invoiceDate.toISOString() : null,
    currencyCode: row.currencyCode,
    total: row.total ? row.total.toString() : null,
    matchedOrderId: row.matchedOrderId,
    matchedOrderReference: row.matchedOrder?.reference ?? null,
    reconciliationStatus: row.reconciliationStatus,
    isCancelledOrReversed: row.isCancelledOrReversed,
    lineCount: row.lines.length,
    unresolvedLineCount: row.lines.filter((line) => line.matchStatus === "UNMATCHED").length,
    isDemo: row.isDemo,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ListSapInvoicesResult = {
  invoices: SapInvoiceSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

/** The reconciliation queue (spec section 10.B). */
export async function listSapInvoices(options: ListSapInvoicesOptions): Promise<ListSapInvoicesResult> {
  const where: Prisma.SapInvoiceWhereInput = {};
  if (!options.includeDemo) where.isDemo = false;
  if (options.reconciliationStatus) where.reconciliationStatus = options.reconciliationStatus as Prisma.SapInvoiceWhereInput["reconciliationStatus"];
  if (options.customerId) where.matchedCustomerId = options.customerId;
  if (options.search) {
    where.OR = [
      { sapDocNum: { contains: options.search, mode: "insensitive" } },
      { customerName: { contains: options.search, mode: "insensitive" } },
      { matchedCustomer: { name: { contains: options.search, mode: "insensitive" } } },
    ];
  }

  const [totalItems, rows] = await Promise.all([
    prisma.sapInvoice.count({ where }),
    prisma.sapInvoice.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: INVOICE_SUMMARY_SELECT,
    }),
  ]);

  return {
    invoices: rows.map(toInvoiceSummary),
    pagination: { page: options.page, pageSize: options.pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)) },
  };
}

export type SapInvoiceLineDetail = {
  id: string;
  lineNumber: number;
  sapItemCode: string | null;
  sapItemDescription: string | null;
  quantityInvoiced: string;
  unitOfMeasure: string | null;
  unitPrice: string | null;
  discount: string | null;
  taxCode: string | null;
  lineTotal: string | null;
  matchStatus: string;
  matchMethod: string | null;
  matchNote: string | null;
  matchedById: string | null;
  matchedByName: string | null;
  matchedAt: string | null;
  matchedOrderId: string | null;
  matchedOrderReference: string | null;
  matchedOrderLineId: string | null;
  // Live reconciliation figures for the matched order line -- never
  // stored, always computed fresh (see lib/invoice-reconciliation/
  // reconcile.ts). Null when this line isn't matched to an order line.
  authorizedQuantity: string | null;
  invoicedQuantity: string | null;
  remainingQuantity: string | null;
  orderLineStatus: OrderLineInvoiceStatusValue | null;
};

export type SapInvoiceDetail = {
  id: string;
  sapDocNum: string;
  sapDocEntry: string | null;
  customerSapCode: string | null;
  customerName: string | null;
  matchedCustomerId: string | null;
  matchedCustomerName: string | null;
  invoiceDate: string | null;
  currencyCode: string | null;
  documentStatusRaw: string | null;
  isCancelledOrReversed: boolean;
  sapOrderReference: string | null;
  matchedOrderId: string | null;
  matchedOrderReference: string | null;
  subtotal: string | null;
  taxTotal: string | null;
  total: string | null;
  reconciliationStatus: string;
  reconciliationNotes: string | null;
  rawSourceData: unknown;
  isDemo: boolean;
  createdAt: string;
  importBatchId: string;
  importBatchFileName: string;
  lines: SapInvoiceLineDetail[];
};

/** Invoice detail (spec section 10.C): header + lines, linked order, and
 * per-matched-line authorized/invoiced/remaining/difference. */
export async function getSapInvoiceDetail(id: string): Promise<SapInvoiceDetail | null> {
  const invoice = await prisma.sapInvoice.findUnique({
    where: { id },
    select: {
      id: true,
      sapDocNum: true,
      sapDocEntry: true,
      customerSapCode: true,
      customerName: true,
      matchedCustomerId: true,
      matchedCustomer: { select: { name: true } },
      invoiceDate: true,
      currencyCode: true,
      documentStatusRaw: true,
      isCancelledOrReversed: true,
      sapOrderReference: true,
      matchedOrderId: true,
      matchedOrder: { select: { reference: true } },
      subtotal: true,
      taxTotal: true,
      total: true,
      reconciliationStatus: true,
      reconciliationNotes: true,
      rawSourceData: true,
      isDemo: true,
      createdAt: true,
      importBatchId: true,
      importBatch: { select: { originalFileName: true } },
      lines: {
        orderBy: { lineNumber: "asc" },
        select: {
          id: true,
          lineNumber: true,
          sapItemCode: true,
          sapItemDescription: true,
          quantityInvoiced: true,
          unitOfMeasure: true,
          unitPrice: true,
          discount: true,
          taxCode: true,
          lineTotal: true,
          matchStatus: true,
          matchMethod: true,
          matchNote: true,
          matchedById: true,
          matchedBy: { select: { name: true } },
          matchedAt: true,
          matchedOrderId: true,
          matchedOrder: { select: { reference: true } },
          matchedOrderLineId: true,
        },
      },
    },
  });
  if (!invoice) return null;

  // Live authorized/invoiced/remaining per matched order line -- batched,
  // never N+1: one PickingLine query and one SapInvoiceLine aggregate
  // covering every distinct matchedOrderLineId this invoice's own lines
  // touch (usually just a handful).
  const orderLineIds = Array.from(new Set(invoice.lines.map((line) => line.matchedOrderLineId).filter((id): id is string => id !== null)));

  const authorizedByOrderLineId = new Map<string, string>();
  if (orderLineIds.length > 0) {
    const pickingLines = await prisma.pickingLine.findMany({
      where: { orderLineId: { in: orderLineIds }, pickingSession: { status: "AUTHORIZED" } },
      orderBy: { pickingSession: { authorizedAt: "desc" } },
      select: { orderLineId: true, foundQuantity: true },
    });
    for (const line of pickingLines) {
      // findMany preserves no per-group ordering guarantee across
      // orderLineId, so only keep the first (most recent) seen per id.
      if (!authorizedByOrderLineId.has(line.orderLineId) && line.foundQuantity !== null) {
        authorizedByOrderLineId.set(line.orderLineId, line.foundQuantity.toString());
      }
    }
  }

  const invoicedByOrderLineId = new Map<string, string>();
  if (orderLineIds.length > 0) {
    const sums = await prisma.sapInvoiceLine.groupBy({
      by: ["matchedOrderLineId"],
      where: { matchedOrderLineId: { in: orderLineIds }, matchStatus: { in: ["AUTO_MATCHED", "MANUALLY_MATCHED"] }, sapInvoice: { isCancelledOrReversed: false } },
      _sum: { quantityInvoiced: true },
    });
    for (const row of sums) {
      invoicedByOrderLineId.set(row.matchedOrderLineId as string, (row._sum.quantityInvoiced ?? new Prisma.Decimal(0)).toString());
    }
  }

  return {
    id: invoice.id,
    sapDocNum: invoice.sapDocNum,
    sapDocEntry: invoice.sapDocEntry,
    customerSapCode: invoice.customerSapCode,
    customerName: invoice.customerName,
    matchedCustomerId: invoice.matchedCustomerId,
    matchedCustomerName: invoice.matchedCustomer?.name ?? null,
    invoiceDate: invoice.invoiceDate ? invoice.invoiceDate.toISOString() : null,
    currencyCode: invoice.currencyCode,
    documentStatusRaw: invoice.documentStatusRaw,
    isCancelledOrReversed: invoice.isCancelledOrReversed,
    sapOrderReference: invoice.sapOrderReference,
    matchedOrderId: invoice.matchedOrderId,
    matchedOrderReference: invoice.matchedOrder?.reference ?? null,
    subtotal: invoice.subtotal ? invoice.subtotal.toString() : null,
    taxTotal: invoice.taxTotal ? invoice.taxTotal.toString() : null,
    total: invoice.total ? invoice.total.toString() : null,
    reconciliationStatus: invoice.reconciliationStatus,
    reconciliationNotes: invoice.reconciliationNotes,
    rawSourceData: invoice.rawSourceData,
    isDemo: invoice.isDemo,
    createdAt: invoice.createdAt.toISOString(),
    importBatchId: invoice.importBatchId,
    importBatchFileName: invoice.importBatch.originalFileName,
    lines: invoice.lines.map((line) => {
      const authorizedQuantity = line.matchedOrderLineId ? authorizedByOrderLineId.get(line.matchedOrderLineId) ?? null : null;
      const invoicedQuantity = line.matchedOrderLineId ? invoicedByOrderLineId.get(line.matchedOrderLineId) ?? "0.0000" : null;
      const reconciliation = authorizedQuantity !== null && invoicedQuantity !== null ? computeOrderLineReconciliation(authorizedQuantity, invoicedQuantity) : null;

      return {
        id: line.id,
        lineNumber: line.lineNumber,
        sapItemCode: line.sapItemCode,
        sapItemDescription: line.sapItemDescription,
        quantityInvoiced: line.quantityInvoiced.toString(),
        unitOfMeasure: line.unitOfMeasure,
        unitPrice: line.unitPrice ? line.unitPrice.toString() : null,
        discount: line.discount ? line.discount.toString() : null,
        taxCode: line.taxCode,
        lineTotal: line.lineTotal ? line.lineTotal.toString() : null,
        matchStatus: line.matchStatus,
        matchMethod: line.matchMethod,
        matchNote: line.matchNote,
        matchedById: line.matchedById,
        matchedByName: line.matchedBy?.name ?? null,
        matchedAt: line.matchedAt ? line.matchedAt.toISOString() : null,
        matchedOrderId: line.matchedOrderId,
        matchedOrderReference: line.matchedOrder?.reference ?? null,
        matchedOrderLineId: line.matchedOrderLineId,
        authorizedQuantity,
        invoicedQuantity,
        remainingQuantity: reconciliation?.remainingQuantity ?? null,
        orderLineStatus: reconciliation?.status ?? null,
      };
    }),
  };
}

export type ImportBatchSummary = {
  id: string;
  originalFileName: string;
  uploadedById: string;
  uploadedByName: string;
  totalRows: number;
  importedInvoiceCount: number;
  importedLineCount: number;
  duplicateRowCount: number;
  invalidRowCount: number;
  isDemo: boolean;
  createdAt: string;
};

/** Import history (spec section 10.A's "View import history"). */
export async function listImportBatches(options: { page: number; pageSize: number; includeDemo?: boolean }): Promise<{
  batches: ImportBatchSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
}> {
  const where: Prisma.SapInvoiceImportBatchWhereInput = options.includeDemo ? {} : { isDemo: false };

  const [totalItems, rows] = await Promise.all([
    prisma.sapInvoiceImportBatch.count({ where }),
    prisma.sapInvoiceImportBatch.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: {
        id: true,
        originalFileName: true,
        uploadedById: true,
        uploadedBy: { select: { name: true } },
        totalRows: true,
        importedInvoiceCount: true,
        importedLineCount: true,
        duplicateRowCount: true,
        invalidRowCount: true,
        isDemo: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    batches: rows.map((row) => ({
      id: row.id,
      originalFileName: row.originalFileName,
      uploadedById: row.uploadedById,
      uploadedByName: row.uploadedBy.name,
      totalRows: row.totalRows,
      importedInvoiceCount: row.importedInvoiceCount,
      importedLineCount: row.importedLineCount,
      duplicateRowCount: row.duplicateRowCount,
      invalidRowCount: row.invalidRowCount,
      isDemo: row.isDemo,
      createdAt: row.createdAt.toISOString(),
    })),
    pagination: { page: options.page, pageSize: options.pageSize, totalItems, totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)) },
  };
}

export type CandidateOrderLineForMatching = {
  orderId: string;
  orderReference: string;
  orderLineId: string;
  sapItemCodeSnapshot: string | null;
  productDescription: string;
  authorizedQuantity: string;
  invoicedQuantity: string;
  remainingQuantity: string;
  status: OrderLineInvoiceStatusValue;
};

/**
 * Every outstanding, authorized order line for one customer, with its
 * live authorized/invoiced/remaining position -- feeds the manual-match
 * picker in the invoice detail UI (spec section 7: "inspect matching
 * orders, inspect authorized handover lines"). Includes lines that are
 * already FULLY_INVOICED or OVER_INVOICED too (not filtered out), since a
 * human reviewing an ambiguous case needs to see the full picture, not
 * just the lines with remaining capacity.
 */
export async function getCandidateOrderLinesForCustomer(customerId: string): Promise<CandidateOrderLineForMatching[]> {
  const orders = await prisma.customerOrder.findMany({
    where: { customerId, status: "READY_TO_INVOICE" },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      reference: true,
      pickingSessions: {
        where: { status: "AUTHORIZED" },
        orderBy: { authorizedAt: "desc" },
        take: 1,
        select: {
          lines: {
            select: {
              orderLineId: true,
              foundQuantity: true,
              orderLine: { select: { sapItemCodeSnapshot: true, originalProductDescription: true, product: { select: { sapItemCode: true } } } },
            },
          },
        },
      },
    },
  });

  const allOrderLineIds = orders.flatMap((order) => (order.pickingSessions[0]?.lines ?? []).map((line) => line.orderLineId));
  const invoicedByOrderLineId = new Map<string, string>();
  if (allOrderLineIds.length > 0) {
    const sums = await prisma.sapInvoiceLine.groupBy({
      by: ["matchedOrderLineId"],
      where: { matchedOrderLineId: { in: allOrderLineIds }, matchStatus: { in: ["AUTO_MATCHED", "MANUALLY_MATCHED"] }, sapInvoice: { isCancelledOrReversed: false } },
      _sum: { quantityInvoiced: true },
    });
    for (const row of sums) {
      invoicedByOrderLineId.set(row.matchedOrderLineId as string, (row._sum.quantityInvoiced ?? new Prisma.Decimal(0)).toString());
    }
  }

  const results: CandidateOrderLineForMatching[] = [];
  for (const order of orders) {
    for (const line of order.pickingSessions[0]?.lines ?? []) {
      if (line.foundQuantity === null || line.foundQuantity.isZero()) continue;

      const authorizedQuantity = line.foundQuantity.toString();
      const invoicedQuantity = invoicedByOrderLineId.get(line.orderLineId) ?? "0.0000";
      const reconciliation = computeOrderLineReconciliation(authorizedQuantity, invoicedQuantity);
      if (!reconciliation) continue;

      results.push({
        orderId: order.id,
        orderReference: order.reference,
        orderLineId: line.orderLineId,
        sapItemCodeSnapshot: line.orderLine.product?.sapItemCode ?? line.orderLine.sapItemCodeSnapshot,
        productDescription: line.orderLine.originalProductDescription,
        authorizedQuantity: reconciliation.authorizedQuantity,
        invoicedQuantity: reconciliation.invoicedQuantity,
        remainingQuantity: reconciliation.remainingQuantity,
        status: reconciliation.status,
      });
    }
  }
  return results;
}

export type ReconciliationReportOrderLine = {
  orderId: string;
  orderReference: string;
  customerId: string;
  customerName: string;
  orderLineId: string;
  sapItemCodeSnapshot: string | null;
  productDescription: string;
  authorizedQuantity: string;
  invoicedQuantity: string;
  remainingQuantity: string;
  status: OrderLineInvoiceStatusValue;
};

export type InvoiceReconciliationReports = {
  fullyInvoicedLines: ReconciliationReportOrderLine[];
  partiallyInvoicedLines: ReconciliationReportOrderLine[];
  awaitingInvoicingLines: ReconciliationReportOrderLine[];
  overInvoicedLines: ReconciliationReportOrderLine[];
  unmatchedInvoices: SapInvoiceSummary[];
  reconciliationExceptions: SapInvoiceSummary[];
};

/**
 * Spec section 10.D's four quantity reports plus the two invoice-level
 * exception lists. Built order-line by order-line (never order-level
 * only) because one order can legitimately mix fully-invoiced,
 * partially-invoiced and awaiting-invoicing lines at once -- collapsing
 * to a single order-level bucket would hide that, same reasoning as
 * section 6's "a single order may have several invoice records and
 * different line-level reconciliation outcomes."
 */
export async function getInvoiceReconciliationReports(options?: { includeDemo?: boolean }): Promise<InvoiceReconciliationReports> {
  const includeDemo = options?.includeDemo ?? false;

  const orders = await prisma.customerOrder.findMany({
    where: { status: "READY_TO_INVOICE", ...(includeDemo ? {} : { isDemo: false }) },
    select: {
      id: true,
      reference: true,
      customerId: true,
      customer: { select: { name: true } },
      pickingSessions: {
        where: { status: "AUTHORIZED" },
        orderBy: { authorizedAt: "desc" },
        take: 1,
        select: {
          lines: {
            select: {
              orderLineId: true,
              foundQuantity: true,
              orderLine: { select: { sapItemCodeSnapshot: true, originalProductDescription: true, product: { select: { sapItemCode: true } } } },
            },
          },
        },
      },
    },
  });

  const allOrderLineIds = orders.flatMap((order) => (order.pickingSessions[0]?.lines ?? []).map((line) => line.orderLineId));
  const invoicedByOrderLineId = new Map<string, string>();
  if (allOrderLineIds.length > 0) {
    const sums = await prisma.sapInvoiceLine.groupBy({
      by: ["matchedOrderLineId"],
      where: { matchedOrderLineId: { in: allOrderLineIds }, matchStatus: { in: ["AUTO_MATCHED", "MANUALLY_MATCHED"] }, sapInvoice: { isCancelledOrReversed: false } },
      _sum: { quantityInvoiced: true },
    });
    for (const row of sums) {
      invoicedByOrderLineId.set(row.matchedOrderLineId as string, (row._sum.quantityInvoiced ?? new Prisma.Decimal(0)).toString());
    }
  }

  const buckets: Record<OrderLineInvoiceStatusValue, ReconciliationReportOrderLine[]> = {
    NOT_YET_INVOICED: [],
    PARTIALLY_INVOICED: [],
    FULLY_INVOICED: [],
    OVER_INVOICED: [],
  };

  for (const order of orders) {
    const lines = order.pickingSessions[0]?.lines ?? [];
    for (const line of lines) {
      if (line.foundQuantity === null || line.foundQuantity.isZero()) continue;

      const authorizedQuantity = line.foundQuantity.toString();
      const invoicedQuantity = invoicedByOrderLineId.get(line.orderLineId) ?? "0.0000";
      const reconciliation = computeOrderLineReconciliation(authorizedQuantity, invoicedQuantity);
      if (!reconciliation) continue;

      buckets[reconciliation.status].push({
        orderId: order.id,
        orderReference: order.reference,
        customerId: order.customerId,
        customerName: order.customer.name,
        orderLineId: line.orderLineId,
        sapItemCodeSnapshot: line.orderLine.product?.sapItemCode ?? line.orderLine.sapItemCodeSnapshot,
        productDescription: line.orderLine.originalProductDescription,
        authorizedQuantity: reconciliation.authorizedQuantity,
        invoicedQuantity: reconciliation.invoicedQuantity,
        remainingQuantity: reconciliation.remainingQuantity,
        status: reconciliation.status,
      });
    }
  }

  const invoiceWhere = includeDemo ? {} : { isDemo: false };
  const [unmatchedRows, exceptionRows] = await Promise.all([
    prisma.sapInvoice.findMany({ where: { ...invoiceWhere, reconciliationStatus: "UNMATCHED" }, orderBy: { createdAt: "desc" }, select: INVOICE_SUMMARY_SELECT }),
    prisma.sapInvoice.findMany({ where: { ...invoiceWhere, reconciliationStatus: "RECONCILIATION_REQUIRED" }, orderBy: { createdAt: "desc" }, select: INVOICE_SUMMARY_SELECT }),
  ]);

  return {
    fullyInvoicedLines: buckets.FULLY_INVOICED,
    partiallyInvoicedLines: buckets.PARTIALLY_INVOICED,
    awaitingInvoicingLines: buckets.NOT_YET_INVOICED,
    overInvoicedLines: buckets.OVER_INVOICED,
    unmatchedInvoices: unmatchedRows.map(toInvoiceSummary),
    reconciliationExceptions: exceptionRows.map(toInvoiceSummary),
  };
}
