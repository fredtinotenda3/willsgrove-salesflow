import { Prisma } from "@prisma/client";
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

export type PriceListStats = {
  totalLists: number;
  totalEntries: number;
  customersAssigned: number;
  currencyCount: number;
  lastImportedAt: string | null;
};

/**
 * Follow-up fix ("Price should also have its own page too with its stats
 * card and other necessary info") -- backs the new /price-lists landing
 * page's stat cards, same role lib/product-queries.ts's own stats
 * aggregation plays for /products.
 */
export async function getPriceListStats(): Promise<PriceListStats> {
  const [totalLists, totalEntries, customersAssigned, currencies, lastImport] = await Promise.all([
    prisma.priceList.count(),
    prisma.priceListEntry.count(),
    prisma.customer.count({ where: { priceListId: { not: null } } }),
    prisma.priceList.findMany({ distinct: ["currencyCode"], select: { currencyCode: true } }),
    prisma.auditEvent.findFirst({
      where: { action: "PRICE_LIST_IMPORT" },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  return {
    totalLists,
    totalEntries,
    customersAssigned,
    currencyCount: currencies.length,
    lastImportedAt: lastImport ? lastImport.createdAt.toISOString() : null,
  };
}

export type MutationFailure = {
  ok: false;
  status: number;
  message: string;
  fieldErrors?: Record<string, string>;
};

export type CreatePriceListResult = { ok: true; id: string } | MutationFailure;

export type CreatePriceListInput = {
  code: string;
  name: string;
  currencyCode: string;
};

// Mirrors lib/customers.ts's own local isUniqueViolation -- deliberately
// its own small copy here rather than a shared import, same "mirror the
// convention, don't force a shared abstraction across genuinely
// different call sites" choice that file's own precedent follows.
function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const duplicateCodeFailure: MutationFailure = {
  ok: false,
  status: 409,
  message: "A price list with this code already exists.",
  fieldErrors: { code: "This price-list code is already used." },
};

// PriceList.currencyCode's own schema comment: "USD" | "ZWG" -- the only
// two currencies this business actually operates in (see
// prisma/schema.prisma's PriceList model). Not an enum column (kept a
// plain string so a future currency doesn't need a migration), but a
// hand-created price list is validated against the same known set an
// imported one is always drawn from.
const VALID_CURRENCY_CODES = ["USD", "ZWG"];

/**
 * Follow-up fix ("price page should also have button to add... like
 * customer and products pages") -- creates a single PriceList by hand,
 * with no entries (entries are added via the Price Lists Import flow or
 * the per-list entry editor), mirroring lib/customers.ts's createCustomer
 * (validate, create, audit, translate a unique-code violation into a
 * clean 409 rather than a 500).
 */
export async function createPriceList(input: CreatePriceListInput, actorId: string): Promise<CreatePriceListResult> {
  const fieldErrors: Record<string, string> = {};

  const code = input.code.trim().toUpperCase();
  if (!code) fieldErrors.code = "Code is required.";
  else if (code.length > 50) fieldErrors.code = "Code must be at most 50 characters.";

  const name = input.name.trim();
  if (!name) fieldErrors.name = "Name is required.";
  else if (name.length > 200) fieldErrors.name = "Name must be at most 200 characters.";

  const currencyCode = input.currencyCode.trim().toUpperCase();
  if (!VALID_CURRENCY_CODES.includes(currencyCode)) {
    fieldErrors.currencyCode = `Currency must be one of: ${VALID_CURRENCY_CODES.join(", ")}.`;
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { ok: false, status: 400, message: "Validation failed.", fieldErrors };
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const list = await tx.priceList.create({
        data: { code, name, currencyCode },
        select: { id: true },
      });

      await tx.auditEvent.create({
        data: {
          actorId,
          action: "PRICE_LIST_CREATE",
          entityType: "PriceList",
          entityId: list.id,
          afterData: { code, name, currencyCode },
        },
      });

      return list;
    });

    return { ok: true, id: created.id };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return duplicateCodeFailure;
    }
    throw error;
  }
}
