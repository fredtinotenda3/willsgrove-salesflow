import { Prisma, RecordStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const CUSTOMER_DEFAULT_PAGE_SIZE = 50;
export const CUSTOMER_MAX_PAGE_SIZE = 100;

const MAX_PAGE = 100000;
const MAX_SEARCH_LENGTH = 100;

export type CustomerListQuery = {
  search: string;
  category: string | null;
  status: RecordStatus | null;
  page: number;
  pageSize: number;
  // Real Business Data Onboarding round (spec PART A, Phase 4b): undefined
  // = no price-list filter, "UNASSIGNED" = customers with no price list at
  // all (priceListId null), any other value = that exact PriceList id. A
  // URL query string can't carry a literal null, so "UNASSIGNED" is a
  // reserved sentinel here, same convention category/status already use
  // ("All"/"ALL") for "no filter" vs. a real value.
  priceListId: string | null;
};

export type ParsedCustomerListQuery =
  | { ok: true; query: CustomerListQuery }
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

export function parseCustomerListQuery(
  params: URLSearchParams
): ParsedCustomerListQuery {
  const page = readInteger(params.get("page"), 1, 1, MAX_PAGE);

  if (page === null) {
    return { ok: false, message: "Invalid page number." };
  }

  const pageSize = readInteger(
    params.get("pageSize"),
    CUSTOMER_DEFAULT_PAGE_SIZE,
    1,
    CUSTOMER_MAX_PAGE_SIZE
  );

  if (pageSize === null) {
    return {
      ok: false,
      message: `pageSize must be between 1 and ${CUSTOMER_MAX_PAGE_SIZE}.`,
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

  const rawPriceListId = (params.get("priceListId") ?? "").trim();
  const priceListId = rawPriceListId === "" ? null : rawPriceListId;

  return {
    ok: true,
    query: { search, category, status, page, pageSize, priceListId },
  };
}

// Real-world fix (bulk price-list assignment): the real customer-master
// export this business has (app/price-lists/customers/page.tsx's own
// comment) carries no price-list column at all, so every assignment is a
// deliberate staff action -- never guessed or defaulted here either.
// This is the JSON-body counterpart to parseCustomerListQuery (same
// search/category/status/priceListId filter semantics, so "assign to
// everyone matching my current filter" always means exactly the
// customers already shown on screen), plus the one additional field:
// which price list to assign them to.
export type BulkAssignPriceListInput = {
  filter: Pick<CustomerListQuery, "search" | "category" | "status" | "priceListId">;
  targetPriceListId: string | null;
  confirmedUnfiltered: boolean;
};

export type ParsedBulkAssignPriceListInput =
  | { ok: true; input: BulkAssignPriceListInput }
  | { ok: false; message: string };

// Real-world fix (incident follow-up): a filter with no search, category,
// status, or priceListId narrows nothing -- it matches every customer. The
// Customer Pricing page's search box drives BOTH the table filter and the
// bulk-assign scope, so clearing it (or never setting it) between two
// bulk-assign actions silently widens the second one to "everyone,"
// overwriting whatever the first action correctly set. This happened in
// production: a scoped TM-USD assignment was immediately wiped out by an
// unfiltered BHOLA assignment. lib/customers.ts's bulkAssignPriceList
// refuses to run an effectively-empty filter unless the caller explicitly
// passes confirmedUnfiltered: true -- the one new piece of friction that
// would have caught this before it happened.
export function isFilterEffectivelyEmpty(
  filter: Pick<CustomerListQuery, "search" | "category" | "status" | "priceListId">
): boolean {
  return !filter.search && !filter.category && !filter.status && !filter.priceListId;
}

export function parseBulkAssignPriceListInput(body: Record<string, unknown>): ParsedBulkAssignPriceListInput {
  const rawSearch = body.search;
  const search = typeof rawSearch === "string" ? rawSearch.trim() : "";

  if (search.length > MAX_SEARCH_LENGTH) {
    return { ok: false, message: `Search text must be ${MAX_SEARCH_LENGTH} characters or fewer.` };
  }

  const rawCategory = body.category;
  const category = typeof rawCategory === "string" && rawCategory.trim() !== "" && rawCategory.trim().toLowerCase() !== "all"
    ? rawCategory.trim()
    : null;

  const rawStatus = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
  let status: RecordStatus | null = null;

  if (rawStatus === "ACTIVE") {
    status = RecordStatus.ACTIVE;
  } else if (rawStatus === "INACTIVE") {
    status = RecordStatus.INACTIVE;
  } else if (rawStatus !== "" && rawStatus !== "ALL") {
    return { ok: false, message: "status must be ACTIVE, INACTIVE or ALL." };
  }

  const rawFilterPriceListId = body.priceListId;
  const filterPriceListId =
    typeof rawFilterPriceListId === "string" && rawFilterPriceListId.trim() !== "" ? rawFilterPriceListId.trim() : null;

  const rawTarget = body.targetPriceListId;

  if (rawTarget !== null && typeof rawTarget !== "string") {
    return { ok: false, message: "targetPriceListId must be a price list id, or null to unassign." };
  }

  const targetPriceListId = typeof rawTarget === "string" ? rawTarget.trim() : null;

  if (typeof rawTarget === "string" && targetPriceListId === "") {
    return { ok: false, message: "targetPriceListId must be a non-empty string, or null to unassign." };
  }

  // Real-world fix (incident follow-up): confirmedUnfiltered defaults to
  // false, never true -- a caller that doesn't know about this field (an
  // older client, a script) gets the SAFE behavior (rejected, see
  // bulkAssignPriceList's own guard), not the dangerous one. An empty
  // filter matching every customer is still a legitimate action (e.g. a
  // default list for everyone still unassigned) -- it just now requires
  // the caller to say so explicitly rather than that being the default
  // outcome of an empty search box.
  const confirmedUnfiltered = body.confirmedUnfiltered === true;

  return {
    ok: true,
    input: { filter: { search, category, status, priceListId: filterPriceListId }, targetPriceListId, confirmedUnfiltered },
  };
}

const customerListSelect = {
  id: true,
  name: true,
  sapCustomerCode: true,
  email: true,
  phone: true,
  category: true,
  status: true,
  createdAt: true,
  priceListId: true,
  priceList: { select: { id: true, code: true, name: true } },
  locations: {
    where: { isActive: true },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    take: 1,
    select: { label: true, city: true },
  },
  _count: {
    select: {
      orders: true,
      locations: { where: { isActive: true } },
    },
  },
} satisfies Prisma.CustomerSelect;

// Real-world fix (bulk price-list assignment): split out of listCustomers
// so lib/customers.ts's bulkAssignPriceList can match the EXACT same set
// of customers a staff member is looking at on /price-lists/customers
// (same search box, same category/status/priceListId filters) before
// bulk-updating them -- one filter definition, never two copies that can
// drift apart and bulk-assign a different set than what was shown.
export function buildCustomerListWhere(
  query: Pick<CustomerListQuery, "search" | "category" | "status" | "priceListId">
): Prisma.CustomerWhereInput {
  const where: Prisma.CustomerWhereInput = {};

  if (query.search) {
    where.OR = [
      { name: { contains: query.search, mode: "insensitive" } },
      { sapCustomerCode: { contains: query.search, mode: "insensitive" } },
      { email: { contains: query.search, mode: "insensitive" } },
      { phone: { contains: query.search } },
    ];
  }

  if (query.category) {
    where.category = query.category;
  }

  if (query.status) {
    where.status = query.status;
  }

  if (query.priceListId === "UNASSIGNED") {
    where.priceListId = null;
  } else if (query.priceListId) {
    where.priceListId = query.priceListId;
  }

  return where;
}

export async function listCustomers(query: CustomerListQuery) {
  const where = buildCustomerListWhere(query);

  const [filteredTotal, rows, total, active, withoutLocations, groups] =
    await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({
        where,
        orderBy: [{ name: "asc" }, { id: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: customerListSelect,
      }),
      prisma.customer.count(),
      prisma.customer.count({ where: { status: RecordStatus.ACTIVE } }),
      prisma.customer.count({
        where: { locations: { none: { isActive: true } } },
      }),
      prisma.customer.groupBy({
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
    .map((group) => ({ name: group.category, count: group._count._all }));

  return {
    customers: rows.map((customer) => {
      const primary = customer.locations[0] ?? null;

      return {
        id: customer.id,
        name: customer.name,
        sapCustomerCode: customer.sapCustomerCode,
        email: customer.email,
        phone: customer.phone,
        category: customer.category,
        status: customer.status,
        createdAt: customer.createdAt.toISOString(),
        priceListId: customer.priceListId,
        priceList: customer.priceList,
        primaryLocation: primary
          ? { label: primary.label, city: primary.city }
          : null,
        activeLocationCount: customer._count.locations,
        orderCount: customer._count.orders,
      };
    }),
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
      withoutLocations,
    },
  };
}

export async function getCustomerById(id: string) {
  const customer = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      sapCustomerCode: true,
      email: true,
      phone: true,
      category: true,
      status: true,
      notes: true,
      createdAt: true,
      updatedAt: true,
      priceListId: true,
      priceList: { select: { id: true, code: true, name: true, currencyCode: true } },
      locations: {
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        select: {
          id: true,
          label: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          province: true,
          isDefault: true,
          isActive: true,
        },
      },
      _count: { select: { orders: true } },
    },
  });

  if (!customer) {
    return null;
  }

  return {
    id: customer.id,
    name: customer.name,
    sapCustomerCode: customer.sapCustomerCode,
    email: customer.email,
    phone: customer.phone,
    category: customer.category,
    status: customer.status,
    notes: customer.notes,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
    priceListId: customer.priceListId,
    priceList: customer.priceList,
    locations: customer.locations,
    orderCount: customer._count.orders,
  };
}