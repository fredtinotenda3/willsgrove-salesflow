import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/**
 * Milestone 4 (Lost-Sales Management). Read-only helpers shared by the
 * lost-sales API routes (GET endpoints) and the /lost-sales UI -- same
 * role lib/picking/queries.ts plays for Milestone 3.
 */
export type UnfulfilledDemandSummary = {
  id: string;
  orderId: string;
  orderReference: string;
  customerId: string;
  customerName: string;
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  requestedQuantity: string;
  foundQuantity: string;
  unavailableQuantity: string;
  outstandingQuantity: string;
  cancelledQuantity: string;
  substitutedQuantity: string;
  confirmedLostQuantity: string;
  status: string;
  expectedFollowUpDate: string | null;
  isDemo: boolean;
  createdAt: string;
};

const DEMAND_SUMMARY_SELECT = {
  id: true,
  orderId: true,
  order: { select: { reference: true } },
  customerId: true,
  customer: { select: { name: true } },
  productId: true,
  sapItemCodeSnapshot: true,
  productDescriptionSnapshot: true,
  requestedQuantity: true,
  foundQuantity: true,
  unavailableQuantity: true,
  outstandingQuantity: true,
  cancelledQuantity: true,
  substitutedQuantity: true,
  confirmedLostQuantity: true,
  status: true,
  expectedFollowUpDate: true,
  isDemo: true,
  createdAt: true,
} as const;

type DemandSummaryRow = {
  id: string;
  orderId: string;
  order: { reference: string };
  customerId: string;
  customer: { name: string };
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  requestedQuantity: { toString(): string };
  foundQuantity: { toString(): string };
  unavailableQuantity: { toString(): string };
  outstandingQuantity: { toString(): string };
  cancelledQuantity: { toString(): string };
  substitutedQuantity: { toString(): string };
  confirmedLostQuantity: { toString(): string };
  status: string;
  expectedFollowUpDate: Date | null;
  isDemo: boolean;
  createdAt: Date;
};

function toSummary(row: DemandSummaryRow): UnfulfilledDemandSummary {
  return {
    id: row.id,
    orderId: row.orderId,
    orderReference: row.order.reference,
    customerId: row.customerId,
    customerName: row.customer.name,
    productId: row.productId,
    sapItemCodeSnapshot: row.sapItemCodeSnapshot,
    productDescriptionSnapshot: row.productDescriptionSnapshot,
    requestedQuantity: row.requestedQuantity.toString(),
    foundQuantity: row.foundQuantity.toString(),
    unavailableQuantity: row.unavailableQuantity.toString(),
    outstandingQuantity: row.outstandingQuantity.toString(),
    cancelledQuantity: row.cancelledQuantity.toString(),
    substitutedQuantity: row.substitutedQuantity.toString(),
    confirmedLostQuantity: row.confirmedLostQuantity.toString(),
    status: row.status,
    expectedFollowUpDate: row.expectedFollowUpDate ? row.expectedFollowUpDate.toISOString() : null,
    isDemo: row.isDemo,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ListUnfulfilledDemandsOptions = {
  page: number;
  pageSize: number;
  includeDemo?: boolean;
  status?: string;
  customerId?: string;
};

export const LOST_SALES_DEFAULT_PAGE_SIZE = 50;
export const LOST_SALES_MAX_PAGE_SIZE = 100;
const MAX_PAGE = 100000;

function readInteger(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

export type ParsedUnfulfilledDemandListQuery =
  | { ok: true; query: ListUnfulfilledDemandsOptions }
  | { ok: false; message: string };

/** Mirrors lib/order-queries.ts's parseOrderListQuery -- same tiny,
 * unexported pagination-parsing shape duplicated rather than imported,
 * since that function is private to that module and this is a handful
 * of generic lines, not a risk-bearing shared abstraction. */
export function parseUnfulfilledDemandListQuery(params: URLSearchParams): ParsedUnfulfilledDemandListQuery {
  const page = readInteger(params.get("page"), 1, 1, MAX_PAGE);
  if (page === null) return { ok: false, message: "Invalid page number." };

  const pageSize = readInteger(params.get("pageSize"), LOST_SALES_DEFAULT_PAGE_SIZE, 1, LOST_SALES_MAX_PAGE_SIZE);
  if (pageSize === null) {
    return { ok: false, message: `pageSize must be between 1 and ${LOST_SALES_MAX_PAGE_SIZE}.` };
  }

  const rawStatus = (params.get("status") ?? "").trim().toUpperCase();
  let status: string | undefined;
  if (rawStatus !== "" && rawStatus !== "ALL") {
    if (!unfulfilledDemandStatusValueSet.has(rawStatus)) {
      return { ok: false, message: "Invalid status filter." };
    }
    status = rawStatus;
  }

  const customerId = params.get("customerId")?.trim() || undefined;
  const includeDemo = params.get("includeDemo") === "true";

  return { ok: true, query: { page, pageSize, status, customerId, includeDemo } };
}

const unfulfilledDemandStatusValueSet = new Set([
  "PENDING_DECISION",
  "AWAITING_SUPPLY",
  "PARTIALLY_CANCELLED",
  "FULLY_CANCELLED",
  "CONFIRMED_LOST",
  "RESOLVED",
]);

export type ListUnfulfilledDemandsResult = {
  demands: UnfulfilledDemandSummary[];
  pagination: { page: number; pageSize: number; totalItems: number; totalPages: number };
};

/** The /lost-sales list page's query -- spec section 6's required list of unavailable/unfulfilled demand. */
export async function listUnfulfilledDemands(options: ListUnfulfilledDemandsOptions): Promise<ListUnfulfilledDemandsResult> {
  const where: Prisma.UnfulfilledDemandWhereInput = {};
  if (!options.includeDemo) where.isDemo = false;
  if (options.status) where.status = options.status as Prisma.UnfulfilledDemandWhereInput["status"];
  if (options.customerId) where.customerId = options.customerId;

  const [totalItems, rows] = await Promise.all([
    prisma.unfulfilledDemand.count({ where }),
    prisma.unfulfilledDemand.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: (options.page - 1) * options.pageSize,
      take: options.pageSize,
      select: DEMAND_SUMMARY_SELECT,
    }),
  ]);

  return {
    demands: rows.map(toSummary),
    pagination: {
      page: options.page,
      pageSize: options.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / options.pageSize)),
    },
  };
}

export type DecisionEventDetail = {
  id: string;
  decisionType: string;
  source: string;
  quantity: string;
  substituteProductId: string | null;
  substituteSapItemCodeSnapshot: string | null;
  substituteProductDescriptionSnapshot: string | null;
  customerContactName: string | null;
  reason: string | null;
  remarks: string | null;
  attachmentReference: string | null;
  decidedAt: string;
  recordedById: string;
  recordedByName: string;
  recordedAt: string;
};

export type LostSaleRecordDetail = {
  id: string;
  quantity: string;
  reason: string;
  reasonDetail: string | null;
  decisionSource: string;
  estimatedUnitPrice: string | null;
  estimatedValue: string | null;
  estimatedValueSource: string | null;
  remarks: string | null;
  confirmedById: string;
  confirmedByName: string;
  confirmedAt: string;
};

export type UnfulfilledDemandDetail = UnfulfilledDemandSummary & {
  orderLineId: string;
  pickingSessionId: string;
  followUpRemarks: string | null;
  decisionEvents: DecisionEventDetail[];
  lostSaleRecords: LostSaleRecordDetail[];
};

/** Full history for one record -- spec section 6: "the salesperson should be able to open a record and see its full history." */
export async function getUnfulfilledDemandDetail(id: string): Promise<UnfulfilledDemandDetail | null> {
  const row = await prisma.unfulfilledDemand.findUnique({
    where: { id },
    select: {
      ...DEMAND_SUMMARY_SELECT,
      orderLineId: true,
      pickingSessionId: true,
      followUpRemarks: true,
      decisionEvents: {
        orderBy: { recordedAt: "asc" },
        select: {
          id: true,
          decisionType: true,
          source: true,
          quantity: true,
          substituteProductId: true,
          substituteSapItemCodeSnapshot: true,
          substituteProductDescriptionSnapshot: true,
          customerContactName: true,
          reason: true,
          remarks: true,
          attachmentReference: true,
          decidedAt: true,
          recordedById: true,
          recordedBy: { select: { name: true } },
          recordedAt: true,
        },
      },
      lostSaleRecords: {
        orderBy: { confirmedAt: "asc" },
        select: {
          id: true,
          quantity: true,
          reason: true,
          reasonDetail: true,
          decisionSource: true,
          estimatedUnitPrice: true,
          estimatedValue: true,
          estimatedValueSource: true,
          remarks: true,
          confirmedById: true,
          confirmedBy: { select: { name: true } },
          confirmedAt: true,
        },
      },
    },
  });
  if (!row) return null;

  return {
    ...toSummary(row),
    orderLineId: row.orderLineId,
    pickingSessionId: row.pickingSessionId,
    followUpRemarks: row.followUpRemarks,
    decisionEvents: row.decisionEvents.map((event) => ({
      id: event.id,
      decisionType: event.decisionType,
      source: event.source,
      quantity: event.quantity.toString(),
      substituteProductId: event.substituteProductId,
      substituteSapItemCodeSnapshot: event.substituteSapItemCodeSnapshot,
      substituteProductDescriptionSnapshot: event.substituteProductDescriptionSnapshot,
      customerContactName: event.customerContactName,
      reason: event.reason,
      remarks: event.remarks,
      attachmentReference: event.attachmentReference,
      decidedAt: event.decidedAt.toISOString(),
      recordedById: event.recordedById,
      recordedByName: event.recordedBy?.name ?? "Unknown",
      recordedAt: event.recordedAt.toISOString(),
    })),
    lostSaleRecords: row.lostSaleRecords.map((record) => ({
      id: record.id,
      quantity: record.quantity.toString(),
      reason: record.reason,
      reasonDetail: record.reasonDetail,
      decisionSource: record.decisionSource,
      estimatedUnitPrice: record.estimatedUnitPrice ? record.estimatedUnitPrice.toString() : null,
      estimatedValue: record.estimatedValue ? record.estimatedValue.toString() : null,
      estimatedValueSource: record.estimatedValueSource,
      remarks: record.remarks,
      confirmedById: record.confirmedById,
      confirmedByName: record.confirmedBy?.name ?? "Unknown",
      confirmedAt: record.confirmedAt.toISOString(),
    })),
  };
}

export type ProductQuantityBreakdown = {
  productId: string | null;
  sapItemCodeSnapshot: string | null;
  productDescriptionSnapshot: string;
  totalQuantity: string;
};

export type CustomerShortageBreakdown = {
  customerId: string;
  customerName: string;
  demandCount: number;
};

export type LossReasonBreakdown = {
  reason: string;
  recordCount: number;
  totalQuantity: string;
};

export type LostSalesReportSummary = {
  awaitingDecisionCount: number;
  totalUnavailableQuantity: string;
  totalOutstandingQuantity: string;
  totalConfirmedLostQuantity: string;
  topUnavailableProducts: ProductQuantityBreakdown[];
  topConfirmedLostProducts: ProductQuantityBreakdown[];
  topShortageCustomers: CustomerShortageBreakdown[];
  lossReasonBreakdown: LossReasonBreakdown[];
};

/**
 * Builds the human-readable sapItemCodeSnapshot -> description lookup a
 * groupBy result needs (groupBy only returns the grouped field plus
 * aggregates, never other columns) -- one representative (most recent)
 * row per code.
 */
async function describeBySapCode(sapCodes: (string | null)[]): Promise<Map<string, { productId: string | null; description: string }>> {
  const codes = Array.from(new Set(sapCodes.filter((code): code is string => code !== null)));
  if (codes.length === 0) return new Map();

  const rows = await prisma.unfulfilledDemand.findMany({
    where: { sapItemCodeSnapshot: { in: codes } },
    orderBy: { createdAt: "desc" },
    distinct: ["sapItemCodeSnapshot"],
    select: { sapItemCodeSnapshot: true, productId: true, productDescriptionSnapshot: true },
  });

  const map = new Map<string, { productId: string | null; description: string }>();
  for (const row of rows) {
    if (row.sapItemCodeSnapshot) {
      map.set(row.sapItemCodeSnapshot, { productId: row.productId, description: row.productDescriptionSnapshot });
    }
  }
  return map;
}

/**
 * Spec section 7. Deliberately a handful of distinct, clearly-labeled
 * figures rather than one blended "lost sales" number -- the spec's own
 * warning ("do not combine them into one misleading lost-sales figure")
 * -- and deliberately no trends-over-time chart yet: "avoid unnecessary
 * dashboard complexity... before advanced BI" (spec section 6). Time-series
 * reporting can be layered on top of these same rows in a later round
 * without any schema change.
 */
export async function getLostSalesReportSummary(options?: { includeDemo?: boolean }): Promise<LostSalesReportSummary> {
  const includeDemo = options?.includeDemo ?? false;
  const demandWhere: Prisma.UnfulfilledDemandWhereInput = includeDemo ? {} : { isDemo: false };

  const [
    awaitingDecisionCount,
    unavailableTotal,
    outstandingTotal,
    confirmedLostTotal,
    unavailableByProduct,
    lostByProduct,
    shortageByCustomer,
    lossReasons,
  ] = await Promise.all([
    prisma.unfulfilledDemand.count({ where: { ...demandWhere, status: "PENDING_DECISION" } }),
    prisma.unfulfilledDemand.aggregate({ where: demandWhere, _sum: { unavailableQuantity: true } }),
    prisma.unfulfilledDemand.aggregate({ where: demandWhere, _sum: { outstandingQuantity: true } }),
    prisma.unfulfilledDemand.aggregate({ where: demandWhere, _sum: { confirmedLostQuantity: true } }),
    prisma.unfulfilledDemand.groupBy({
      by: ["sapItemCodeSnapshot"],
      where: demandWhere,
      _sum: { unavailableQuantity: true },
      orderBy: { _sum: { unavailableQuantity: "desc" } },
      take: 10,
    }),
    prisma.unfulfilledDemand.groupBy({
      by: ["sapItemCodeSnapshot"],
      where: { ...demandWhere, confirmedLostQuantity: { gt: 0 } },
      _sum: { confirmedLostQuantity: true },
      orderBy: { _sum: { confirmedLostQuantity: "desc" } },
      take: 10,
    }),
    prisma.unfulfilledDemand.groupBy({
      by: ["customerId"],
      where: demandWhere,
      _count: { _all: true },
      orderBy: { _count: { customerId: "desc" } },
      take: 10,
    }),
    prisma.lostSaleRecord.groupBy({
      by: ["reason"],
      where: includeDemo ? {} : { unfulfilledDemand: { isDemo: false } },
      _count: { _all: true },
      _sum: { quantity: true },
      orderBy: { _count: { reason: "desc" } },
    }),
  ]);

  const descriptions = await describeBySapCode([
    ...unavailableByProduct.map((row) => row.sapItemCodeSnapshot),
    ...lostByProduct.map((row) => row.sapItemCodeSnapshot),
  ]);

  const customerIds = shortageByCustomer.map((row) => row.customerId);
  const customers = customerIds.length
    ? await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } })
    : [];
  const customerNameById = new Map(customers.map((customer) => [customer.id, customer.name]));

  return {
    awaitingDecisionCount,
    totalUnavailableQuantity: (unavailableTotal._sum.unavailableQuantity ?? new Prisma.Decimal(0)).toString(),
    totalOutstandingQuantity: (outstandingTotal._sum.outstandingQuantity ?? new Prisma.Decimal(0)).toString(),
    totalConfirmedLostQuantity: (confirmedLostTotal._sum.confirmedLostQuantity ?? new Prisma.Decimal(0)).toString(),
    topUnavailableProducts: unavailableByProduct.map((row) => {
      const info = row.sapItemCodeSnapshot ? descriptions.get(row.sapItemCodeSnapshot) : undefined;
      return {
        productId: info?.productId ?? null,
        sapItemCodeSnapshot: row.sapItemCodeSnapshot,
        productDescriptionSnapshot: info?.description ?? "(unresolved product)",
        totalQuantity: (row._sum.unavailableQuantity ?? new Prisma.Decimal(0)).toString(),
      };
    }),
    topConfirmedLostProducts: lostByProduct.map((row) => {
      const info = row.sapItemCodeSnapshot ? descriptions.get(row.sapItemCodeSnapshot) : undefined;
      return {
        productId: info?.productId ?? null,
        sapItemCodeSnapshot: row.sapItemCodeSnapshot,
        productDescriptionSnapshot: info?.description ?? "(unresolved product)",
        totalQuantity: (row._sum.confirmedLostQuantity ?? new Prisma.Decimal(0)).toString(),
      };
    }),
    topShortageCustomers: shortageByCustomer.map((row) => ({
      customerId: row.customerId,
      customerName: customerNameById.get(row.customerId) ?? "Unknown customer",
      demandCount: row._count._all,
    })),
    lossReasonBreakdown: lossReasons.map((row) => ({
      reason: row.reason,
      recordCount: row._count._all,
      totalQuantity: (row._sum.quantity ?? new Prisma.Decimal(0)).toString(),
    })),
  };
}
