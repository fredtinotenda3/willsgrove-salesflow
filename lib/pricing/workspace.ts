import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

/** Price-lists overview: one grouped query for entry aggregates (no per-list queries). */
export async function listPriceListOverview() {
  const [lists, aggregates] = await Promise.all([
    prisma.priceList.findMany({
      orderBy: [{ status: "asc" }, { code: "asc" }],
      select: { id: true, code: true, name: true, currencyCode: true, status: true, updatedAt: true, _count: { select: { customers: true } } },
    }),
    prisma.$queryRaw<{ priceListId: string; products: bigint; entries: bigint; earliest: Date | null; latest: Date | null; openEnded: bigint; lastEntryAt: Date | null }[]>(Prisma.sql`
      SELECT "priceListId",
             COUNT(DISTINCT "sapItemCodeSnapshot") AS products,
             COUNT(*) AS entries,
             MIN("validFrom") AS earliest,
             MAX("validTo") AS latest,
             COUNT(*) FILTER (WHERE "validTo" IS NULL) AS "openEnded",
             MAX("createdAt") AS "lastEntryAt"
      FROM "PriceListEntry"
      GROUP BY "priceListId"`),
  ]);
  const byList = new Map(aggregates.map((a) => [a.priceListId, a]));
  return lists.map((l) => {
    const a = byList.get(l.id);
    const lastUpdated = [l.updatedAt, a?.lastEntryAt].filter((d): d is Date => d instanceof Date).sort((x, y) => y.getTime() - x.getTime())[0] ?? l.updatedAt;
    return {
      id: l.id,
      code: l.code,
      name: l.name,
      currencyCode: l.currencyCode,
      status: l.status,
      customers: l._count.customers,
      products: Number(a?.products ?? 0),
      entries: Number(a?.entries ?? 0),
      effectiveFrom: a?.earliest ?? null,
      /** null with openEndedEntries > 0 means "no expiry" for those entries. */
      effectiveTo: a?.latest ?? null,
      openEndedEntries: Number(a?.openEnded ?? 0),
      lastUpdated,
    };
  });
}

export type CustomerPricingRow = { id: string; name: string; sapCustomerCode: string | null; currencyCode: string | null; priceListCode: string | null; overrides: number };

/** Customers with their override counts (grouped, not per-row). */
export async function searchCustomersForPricing(q: string, page: number, pageSize: number) {
  const where: Prisma.CustomerWhereInput = q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sapCustomerCode: { contains: q, mode: "insensitive" } }] } : {};
  const [total, customers] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({ where, orderBy: { name: "asc" }, skip: (page - 1) * pageSize, take: pageSize, select: { id: true, name: true, sapCustomerCode: true, currencyCode: true, priceList: { select: { code: true, currencyCode: true } } } }),
  ]);
  const counts = customers.length > 0 ? await prisma.customerProductPrice.groupBy({ by: ["customerId"], where: { customerId: { in: customers.map((c) => c.id) } }, _count: { _all: true } }) : [];
  const countByCustomer = new Map(counts.map((c) => [c.customerId, c._count._all]));
  const rows: CustomerPricingRow[] = customers.map((c) => ({ id: c.id, name: c.name, sapCustomerCode: c.sapCustomerCode, currencyCode: c.priceList?.currencyCode ?? c.currencyCode, priceListCode: c.priceList?.code ?? null, overrides: countByCustomer.get(c.id) ?? 0 }));
  return { total, rows };
}
