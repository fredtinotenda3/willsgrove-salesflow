import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { QUOTATION_STATUSES, type QuotationStatus } from "@/lib/quotations/validation";

export const QUOTATION_DEFAULT_PAGE_SIZE = 25;
export const QUOTATION_MAX_PAGE_SIZE = 100;

const MAX_PAGE = 100000;
const MAX_SEARCH_LENGTH = 100;

export type QuotationListQuery = {
  search: string; // matches quotationNumber or customer name (spec: "search by quotation number," "search by customer")
  status: QuotationStatus | null;
  salespersonId: string | null;
  currency: string | null;
  dateFrom: string | null; // quotationDate >=, YYYY-MM-DD
  dateTo: string | null; // quotationDate <=, YYYY-MM-DD
  includeSuperseded: boolean; // false by default -- spec section 6: "do not allow an old version to be mistaken for the currently issued quotation"
  includeDemo: boolean;
  page: number;
  pageSize: number;
};

export type ParsedQuotationListQuery = { ok: true; query: QuotationListQuery } | { ok: false; message: string };

function readInteger(value: string | null, fallback: number, min: number, max: number): number | null {
  if (value === null || value === "") return fallback;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  if (parsed < min || parsed > max) return null;
  return parsed;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseQuotationListQuery(params: URLSearchParams): ParsedQuotationListQuery {
  const page = readInteger(params.get("page"), 1, 1, MAX_PAGE);
  if (page === null) return { ok: false, message: "Invalid page number." };

  const pageSize = readInteger(params.get("pageSize"), QUOTATION_DEFAULT_PAGE_SIZE, 1, QUOTATION_MAX_PAGE_SIZE);
  if (pageSize === null) return { ok: false, message: `pageSize must be between 1 and ${QUOTATION_MAX_PAGE_SIZE}.` };

  const search = (params.get("search") ?? "").trim();
  if (search.length > MAX_SEARCH_LENGTH) return { ok: false, message: `Search text must be ${MAX_SEARCH_LENGTH} characters or fewer.` };

  const rawStatus = (params.get("status") ?? "").trim().toUpperCase();
  let status: QuotationStatus | null = null;
  if (rawStatus !== "" && rawStatus !== "ALL") {
    if (!QUOTATION_STATUSES.includes(rawStatus as QuotationStatus)) {
      return { ok: false, message: "Invalid status filter." };
    }
    status = rawStatus as QuotationStatus;
  }

  const salespersonId = (params.get("salespersonId") ?? "").trim() || null;
  const currency = (params.get("currency") ?? "").trim().toUpperCase() || null;

  const dateFromRaw = (params.get("dateFrom") ?? "").trim();
  if (dateFromRaw && !DATE_ONLY_PATTERN.test(dateFromRaw)) return { ok: false, message: "dateFrom must be YYYY-MM-DD." };
  const dateTo_Raw = (params.get("dateTo") ?? "").trim();
  if (dateTo_Raw && !DATE_ONLY_PATTERN.test(dateTo_Raw)) return { ok: false, message: "dateTo must be YYYY-MM-DD." };

  const includeSuperseded = params.get("includeSuperseded") === "true";
  const includeDemo = params.get("includeDemo") === "true";

  return {
    ok: true,
    query: {
      search,
      status,
      salespersonId,
      currency,
      dateFrom: dateFromRaw || null,
      dateTo: dateTo_Raw || null,
      includeSuperseded,
      includeDemo,
      page,
      pageSize,
    },
  };
}

const quotationListSelect = {
  id: true,
  quotationNumber: true,
  revisionNumber: true,
  status: true,
  quotationDate: true,
  validUntil: true,
  currency: true,
  total: true,
  supersededAt: true,
  respondedAt: true,
  nextFollowUpDate: true,
  isDemo: true,
  createdAt: true,
  customer: { select: { id: true, name: true } },
  salesperson: { select: { id: true, name: true } },
  _count: { select: { lines: true } },
} satisfies Prisma.QuotationSelect;

export async function listQuotations(query: QuotationListQuery) {
  const where: Prisma.QuotationWhereInput = {};

  if (!query.includeDemo) where.isDemo = false;
  if (!query.includeSuperseded) where.supersededAt = null;
  if (query.status) where.status = query.status;
  if (query.salespersonId) where.salespersonId = query.salespersonId;
  if (query.currency) where.currency = query.currency;

  if (query.dateFrom || query.dateTo) {
    where.quotationDate = {
      ...(query.dateFrom ? { gte: new Date(`${query.dateFrom}T00:00:00.000Z`) } : {}),
      ...(query.dateTo ? { lte: new Date(`${query.dateTo}T23:59:59.999Z`) } : {}),
    };
  }

  if (query.search) {
    where.OR = [
      { quotationNumber: { contains: query.search, mode: "insensitive" } },
      { customer: { name: { contains: query.search, mode: "insensitive" } } },
      { salesperson: { name: { contains: query.search, mode: "insensitive" } } },
    ];
  }

  const [totalItems, rows] = await Promise.all([
    prisma.quotation.count({ where }),
    prisma.quotation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: quotationListSelect,
    }),
  ]);

  return {
    quotations: rows.map((q) => ({
      id: q.id,
      quotationNumber: q.quotationNumber,
      revisionNumber: q.revisionNumber,
      status: q.status,
      quotationDate: q.quotationDate.toISOString(),
      validUntil: q.validUntil.toISOString(),
      currency: q.currency,
      total: q.total.toString(),
      isSuperseded: q.supersededAt !== null,
      awaitingResponse: q.status === "ISSUED" && q.respondedAt === null,
      nextFollowUpDate: q.nextFollowUpDate?.toISOString() ?? null,
      isDemo: q.isDemo,
      createdAt: q.createdAt.toISOString(),
      customer: q.customer,
      salesperson: q.salesperson,
      lineCount: q._count.lines,
    })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.max(1, Math.ceil(totalItems / query.pageSize)),
    },
  };
}

export async function getQuotationById(id: string) {
  return prisma.quotation.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true, email: true, phone: true } },
      customerContact: { select: { id: true, name: true, email: true, phone: true, role: true } },
      preparedBy: { select: { id: true, name: true } },
      salesperson: { select: { id: true, name: true } },
      issuedBy: { select: { id: true, name: true } },
      respondedBy: { select: { id: true, name: true } },
      cancelledBy: { select: { id: true, name: true } },
      supersededBy: { select: { id: true, name: true } },
      convertedBy: { select: { id: true, name: true } },
      previousRevision: { select: { id: true, quotationNumber: true, revisionNumber: true, status: true } },
      nextRevision: { select: { id: true, quotationNumber: true, revisionNumber: true, status: true } },
      convertedOrder: { select: { id: true, reference: true, status: true } },
      lines: { orderBy: { lineNumber: "asc" } },
      events: { orderBy: { createdAt: "desc" }, include: { actor: { select: { id: true, name: true } } } },
    },
  });
}

/**
 * Every revision of one lineage, oldest first -- spec section 6: "make
 * it possible to identify the current valid version" (the last entry,
 * with supersededAt === null, is the current one).
 */
export async function listQuotationRevisions(rootQuotationId: string) {
  return prisma.quotation.findMany({
    where: { OR: [{ id: rootQuotationId }, { rootQuotationId }] },
    orderBy: { revisionNumber: "asc" },
    select: { id: true, quotationNumber: true, revisionNumber: true, status: true, supersededAt: true, createdAt: true, preparedBy: { select: { id: true, name: true } } },
  });
}

/**
 * Resolves the FULL revision history for whichever quotation id is
 * given, root or not -- the one lookup app/api/quotations/[id]/revisions
 * actually needs. rootQuotationId is null on a root row itself (see
 * Quotation.rootQuotationId's own comment in prisma/schema.prisma), so
 * "this row's root" is rootQuotationId ?? its own id.
 */
export async function getQuotationRevisionHistory(quotationId: string) {
  const quotation = await prisma.quotation.findUnique({ where: { id: quotationId }, select: { id: true, rootQuotationId: true } });
  if (!quotation) return null;
  const rootId = quotation.rootQuotationId ?? quotation.id;
  return listQuotationRevisions(rootId);
}

// Note: the SAP item-code product picker in the quotation UI reuses the
// existing /api/products?search= route directly (same debounced pattern
// as app/orders/new/page.tsx) -- no new product-search endpoint is
// needed for this milestone.

export type QuotationDashboardCounts = {
  total: number;
  draft: number;
  issuedAwaitingResponse: number;
  accepted: number;
  rejected: number;
  expired: number;
  cancelled: number;
  valueByStatus: { status: QuotationStatus; currency: string; total: string }[];
  dueForFollowUp: number; // nextFollowUpDate <= today, status ISSUED, not yet responded
};

/**
 * Spec section 10's dashboard figures. "Quotation values by status" is
 * grouped by currency too (never summed across currencies -- same rule
 * lib/invoice-claims/financial.ts already follows for claim exposure).
 * Values here are proposed sales values, never labelled as revenue
 * (spec section 10's explicit warning) -- see the UI layer for the
 * actual wording.
 */
export async function getQuotationDashboardCounts(): Promise<QuotationDashboardCounts> {
  const baseWhere: Prisma.QuotationWhereInput = { isDemo: false, supersededAt: null };
  const today = new Date().toISOString().slice(0, 10);

  const [total, draft, issuedAwaitingResponse, accepted, rejected, expired, cancelled, valueByStatusRaw, dueForFollowUp] = await Promise.all([
    prisma.quotation.count({ where: baseWhere }),
    prisma.quotation.count({ where: { ...baseWhere, status: "DRAFT" } }),
    prisma.quotation.count({ where: { ...baseWhere, status: "ISSUED", respondedAt: null } }),
    prisma.quotation.count({ where: { ...baseWhere, status: "ACCEPTED" } }),
    prisma.quotation.count({ where: { ...baseWhere, status: "REJECTED" } }),
    prisma.quotation.count({ where: { ...baseWhere, status: "EXPIRED" } }),
    prisma.quotation.count({ where: { ...baseWhere, status: "CANCELLED" } }),
    prisma.quotation.groupBy({ by: ["status", "currency"], where: baseWhere, _sum: { total: true } }),
    prisma.quotation.count({
      where: { ...baseWhere, status: "ISSUED", respondedAt: null, nextFollowUpDate: { lte: new Date(`${today}T23:59:59.999Z`) } },
    }),
  ]);

  return {
    total,
    draft,
    issuedAwaitingResponse,
    accepted,
    rejected,
    expired,
    cancelled,
    valueByStatus: valueByStatusRaw.map((row) => ({
      status: row.status,
      currency: row.currency,
      total: (row._sum.total ?? new Prisma.Decimal(0)).toString(),
    })),
    dueForFollowUp,
  };
}
