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

  return {
    ok: true,
    query: { search, category, status, page, pageSize },
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

export async function listCustomers(query: CustomerListQuery) {
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
    locations: customer.locations,
    orderCount: customer._count.orders,
  };
}