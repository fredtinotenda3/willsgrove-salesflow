import { Prisma, RecordStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;

const MAX_PAGE = 100000;
const MAX_SEARCH_LENGTH = 100;

export type ProductListQuery = {
  search: string;
  category: string | null;
  status: RecordStatus | null;
  page: number;
  pageSize: number;
};

export type ParsedProductListQuery =
  | { ok: true; query: ProductListQuery }
  | { ok: false; message: string };

function readInteger(
  value: string | null,
  fallback: number,
  min: number,
  max: number
): number | null {
  if (value === null || value === "") {
    return fallback;
  }

  if (!/^\d+$/.test(value)) {
    return null;
  }

  const parsed = Number(value);

  if (parsed < min || parsed > max) {
    return null;
  }

  return parsed;
}

export function parseProductListQuery(
  params: URLSearchParams
): ParsedProductListQuery {
  const page = readInteger(params.get("page"), 1, 1, MAX_PAGE);

  if (page === null) {
    return { ok: false, message: "Invalid page number." };
  }

  const pageSize = readInteger(
    params.get("pageSize"),
    DEFAULT_PAGE_SIZE,
    1,
    MAX_PAGE_SIZE
  );

  if (pageSize === null) {
    return {
      ok: false,
      message: `pageSize must be between 1 and ${MAX_PAGE_SIZE}.`,
    };
  }

  const search = (params.get("search") ?? "").trim();

  if (search.length > MAX_SEARCH_LENGTH) {
    return {
      ok: false,
      message: `Search text must be ${MAX_SEARCH_LENGTH} characters or fewer.`,
    };
  }

  const rawCategory = (params.get("category") ?? "").trim();
  const category =
    rawCategory === "" || rawCategory.toLowerCase() === "all"
      ? null
      : rawCategory;

  const rawStatus = (params.get("status") ?? "").trim().toUpperCase();
  let status: RecordStatus | null = null;

  if (rawStatus === "ACTIVE") {
    status = RecordStatus.ACTIVE;
  } else if (rawStatus === "INACTIVE") {
    status = RecordStatus.INACTIVE;
  } else if (rawStatus !== "" && rawStatus !== "ALL") {
    return {
      ok: false,
      message: "status must be ACTIVE, INACTIVE or ALL.",
    };
  }

  return {
    ok: true,
    query: { search, category, status, page, pageSize },
  };
}

// The original SAP barcode text is only returned when the barcode field was
// stored as empty even though SAP had a (non-numeric) value, so the screen can
// explain why.
function readUnusableSourceBarcode(
  barcode: string | null,
  sourceData: Prisma.JsonValue | null
): string | null {
  if (barcode !== null) {
    return null;
  }

  if (
    sourceData === null ||
    typeof sourceData !== "object" ||
    Array.isArray(sourceData)
  ) {
    return null;
  }

  const original = sourceData["BARCODE"];

  if (typeof original === "string" && original.trim() !== "") {
    return original;
  }

  return null;
}

export async function listProducts(query: ProductListQuery) {
  const where: Prisma.ProductWhereInput = {};

  if (query.search) {
    where.OR = [
      { itemName: { contains: query.search, mode: "insensitive" } },
      { sapItemCode: { contains: query.search, mode: "insensitive" } },
      { barcode: { contains: query.search } },
    ];
  }

  if (query.category) {
    where.category = query.category;
  }

  if (query.status) {
    where.status = query.status;
  }

  const [
    filteredTotal,
    rows,
    total,
    active,
    withBarcode,
    groups,
  ] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: [{ itemName: "asc" }, { sapItemCode: "asc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      select: {
        id: true,
        sapItemCode: true,
        itemName: true,
        barcode: true,
        category: true,
        status: true,
        importedAt: true,
        sourceData: true,
      },
    }),
    prisma.product.count(),
    prisma.product.count({ where: { status: RecordStatus.ACTIVE } }),
    prisma.product.count({ where: { barcode: { not: null } } }),
    prisma.product.groupBy({
      by: ["category"],
      _count: { _all: true },
      orderBy: { category: "asc" },
    }),
  ]);

  const categories = groups
    .filter(
      (group): group is typeof group & { category: string } =>
        group.category !== null
    )
    .map((group) => ({
      name: group.category,
      count: group._count._all,
    }));

  return {
    products: rows.map((product) => ({
      id: product.id,
      sapItemCode: product.sapItemCode,
      itemName: product.itemName,
      barcode: product.barcode,
      category: product.category,
      status: product.status,
      importedAt: product.importedAt
        ? product.importedAt.toISOString()
        : null,
      unusableSourceBarcode: readUnusableSourceBarcode(
        product.barcode,
        product.sourceData
      ),
    })),
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems: filteredTotal,
      totalPages: Math.max(1, Math.ceil(filteredTotal / query.pageSize)),
    },
    categories,
    stats: {
      total,
      active,
      inactive: total - active,
      itemGroups: categories.length,
      withBarcode,
    },
  };
}

/**
 * Milestone 16 (Production Readiness) fix: this function was imported by
 * lib/reporting/product-insights-queries.ts (Milestone 14's Product 360
 * composite assembly, `getProductProfile`) and referenced in a comment in
 * app/products/[id]/page.tsx, but was never actually defined anywhere in
 * the codebase -- a genuine pre-existing defect (not sandbox noise) that
 * surfaced as an ESLint parse error (a malformed `ReturnType<typeof>` at
 * the import's use site) rather than a clean "module has no exported
 * member" error, which is why it had not been caught by a prior
 * milestone's own `tsc`/`eslint` round. `Product.id` (a cuid), never the
 * SAP item code, is the lookup key -- see the Product 360 route's own
 * comment for why: a SAP item code with no master row has no profile
 * page at all (it only surfaces via the management overview's master-
 * data-quality ranking), so this function's only valid caller-supplied
 * key is the master record's own id. No `isDemo` filter is applied here,
 * mirroring `getCustomerById`'s own precedent above -- a direct id
 * lookup is never filtered by demo status; only list/aggregate queries
 * exclude demo rows by default.
 */
export async function getProductById(id: string) {
  return prisma.product.findUnique({
    where: { id },
    select: {
      id: true,
      sapItemCode: true,
      itemName: true,
      barcode: true,
      category: true,
      status: true,
      unitOfMeasure: true,
      packSize: true,
      isVariableWeight: true,
      vatCode: true,
      isDemo: true,
      importedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}