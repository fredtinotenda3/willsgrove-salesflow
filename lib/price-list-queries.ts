import { prisma } from "@/lib/prisma";

/**
 * Real Business Data Onboarding round (spec PART A, Phase 4b). A plain,
 * unpaginated list of every PriceList -- there are only a handful (the 7
 * real SAP lists imported in Phase 4a, plus whatever else gets added by
 * hand), so this is the simple "list everything" shape, unlike
 * lib/customer-queries.ts's/lib/product-queries.ts's paginated search --
 * it backs the Customer Pricing page's assignment dropdown and its
 * per-list customer counts.
 */
export async function listPriceLists() {
  const lists = await prisma.priceList.findMany({
    orderBy: [{ code: "asc" }],
    select: {
      id: true,
      code: true,
      name: true,
      currencyCode: true,
      createdAt: true,
      _count: { select: { entries: true, customers: true } },
    },
  });

  return lists.map((list) => ({
    id: list.id,
    code: list.code,
    name: list.name,
    currencyCode: list.currencyCode,
    createdAt: list.createdAt.toISOString(),
    entryCount: list._count.entries,
    customerCount: list._count.customers,
  }));
}

export type PriceListDetail = {
  id: string;
  code: string;
  name: string;
  currencyCode: string;
};

export async function getPriceListById(id: string): Promise<PriceListDetail | null> {
  const list = await prisma.priceList.findUnique({
    where: { id },
    select: { id: true, code: true, name: true, currencyCode: true },
  });
  return list ?? null;
}

export type PriceListEntryRow = {
  id: string;
  sapItemCodeSnapshot: string;
  productId: string | null;
  productName: string | null;
  unitPrice: string;
  validFrom: string;
  validTo: string | null;
};

export type ListPriceListEntriesOptions = {
  search?: string | null;
  page?: number;
  pageSize?: number;
};

/**
 * Follow-up fix: "the ability to change or update prices" -- this backs
 * the new /price-lists/[id] page. Before this, a price list's entries
 * could only ever be seen/changed by re-running the whole xlsx/CSV
 * import; there was no way to look at or correct one entry at a time.
 */
export async function listPriceListEntries(
  priceListId: string,
  options: ListPriceListEntriesOptions = {}
): Promise<{ entries: PriceListEntryRow[]; totalItems: number; page: number; pageSize: number }> {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 25));
  const search = options.search?.trim();

  const where = {
    priceListId,
    ...(search
      ? {
          OR: [
            { sapItemCodeSnapshot: { contains: search, mode: "insensitive" as const } },
            { product: { itemName: { contains: search, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const [entries, totalItems] = await Promise.all([
    prisma.priceListEntry.findMany({
      where,
      orderBy: { sapItemCodeSnapshot: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        sapItemCodeSnapshot: true,
        productId: true,
        product: { select: { itemName: true } },
        unitPrice: true,
        validFrom: true,
        validTo: true,
      },
    }),
    prisma.priceListEntry.count({ where }),
  ]);

  return {
    entries: entries.map((e) => ({
      id: e.id,
      sapItemCodeSnapshot: e.sapItemCodeSnapshot,
      productId: e.productId,
      productName: e.product?.itemName ?? null,
      unitPrice: e.unitPrice.toString(),
      validFrom: e.validFrom.toISOString(),
      validTo: e.validTo ? e.validTo.toISOString() : null,
    })),
    totalItems,
    page,
    pageSize,
  };
}

export type UpdatePriceListEntryPriceResult =
  | { ok: true; unitPrice: string }
  | { ok: false; status: number; message: string };

/**
 * Updates ONE entry's price by hand, outside the bulk import flow --
 * audited the same way every other mutation in this codebase is. Only
 * unitPrice changes; sapItemCodeSnapshot/productId/validFrom/validTo are
 * left alone (a hand correction to today's price is not the same
 * business event as a new validity period starting, which the bulk
 * import path already handles on its own terms).
 */
export async function updatePriceListEntryPrice(
  entryId: string,
  newUnitPrice: string,
  actorId: string
): Promise<UpdatePriceListEntryPriceResult> {
  if (!/^\d+(\.\d{1,4})?$/.test(newUnitPrice)) {
    return { ok: false, status: 400, message: "Price must be a non-negative number with up to 4 decimal places." };
  }

  const existing = await prisma.priceListEntry.findUnique({
    where: { id: entryId },
    select: { id: true, unitPrice: true, sapItemCodeSnapshot: true, priceListId: true },
  });
  if (!existing) {
    return { ok: false, status: 404, message: "Price-list entry not found." };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.priceListEntry.update({
      where: { id: entryId },
      data: { unitPrice: newUnitPrice },
      select: { unitPrice: true },
    });

    await tx.auditEvent.create({
      data: {
        actorId,
        action: "PRICE_LIST_ENTRY_PRICE_UPDATED",
        entityType: "PriceListEntry",
        entityId: entryId,
        beforeData: { unitPrice: existing.unitPrice.toString(), sapItemCodeSnapshot: existing.sapItemCodeSnapshot, priceListId: existing.priceListId },
        afterData: { unitPrice: row.unitPrice.toString(), sapItemCodeSnapshot: existing.sapItemCodeSnapshot, priceListId: existing.priceListId },
      },
    });

    return row;
  });

  return { ok: true, unitPrice: updated.unitPrice.toString() };
}

export type CustomerPriceListPrice = {
  unitPrice: string;
  currencyCode: string;
  priceListCode: string;
  priceListName: string;
};

/**
 * Real Business Data Onboarding round, follow-up fix: customer-specific
 * prices must automatically populate when creating a quotation line
 * (e.g. selecting customer "TM" should prefill TM's own linked price
 * list's price). Before this, Customer.priceListId had exactly one
 * reader in the whole codebase -- lib/lost-sales/estimate-value.ts's
 * resolveEstimatedLostSaleValue, which is transaction-scoped, tries
 * OrderLine.approvedUnitPrice FIRST (not relevant here -- a quotation
 * line being drafted has no order line yet), and returns a computed
 * line VALUE rather than a unit price alone. This is a deliberately
 * separate, simpler function for exactly this lookup, following the
 * SAME "productId first, then the frozen sapItemCodeSnapshot" fallback
 * and the same validFrom/validTo "price in effect as of a given date"
 * filter that function already established -- not a new rule.
 *
 * Returns null (never a guessed/defaulted price) when the customer has
 * no price list assigned, or that list has no entry for this product --
 * the caller/UI must leave the price field for the operator to fill in
 * by hand in that case, exactly as it already did before this existed.
 */
export async function resolveCustomerPriceListUnitPrice(
  customerId: string,
  productId: string,
  asOf: Date = new Date()
): Promise<CustomerPriceListPrice | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { priceListId: true } });
  if (!customer?.priceListId) return null;

  const product = await prisma.product.findUnique({ where: { id: productId }, select: { sapItemCode: true } });

  const entry = await prisma.priceListEntry.findFirst({
    where: {
      priceListId: customer.priceListId,
      AND: [
        {
          OR: [
            { productId },
            ...(product?.sapItemCode ? [{ sapItemCodeSnapshot: product.sapItemCode }] : []),
          ],
        },
        { validFrom: { lte: asOf } },
        { OR: [{ validTo: null }, { validTo: { gte: asOf } }] },
      ],
    },
    orderBy: { validFrom: "desc" },
    select: { unitPrice: true, priceList: { select: { code: true, name: true, currencyCode: true } } },
  });
  if (!entry) return null;

  return {
    unitPrice: entry.unitPrice.toString(),
    currencyCode: entry.priceList.currencyCode,
    priceListCode: entry.priceList.code,
    priceListName: entry.priceList.name,
  };
}
