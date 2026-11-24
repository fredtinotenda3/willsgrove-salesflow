import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { duplicateKey } from "./policy";
import { fail, type AdminFailure } from "./types";

const TX = { maxWait: 15000, timeout: 15000 };
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export type ProductFilters = { q?: string; status?: string; category?: string; missingBarcode?: boolean };

export async function listAdminProducts(filters: ProductFilters, page: number, pageSize: number) {
  const where: Prisma.ProductWhereInput = {
    ...(filters.q ? { OR: [{ sapItemCode: { contains: filters.q, mode: "insensitive" } }, { itemName: { contains: filters.q, mode: "insensitive" } }, { barcode: { contains: filters.q } }] } : {}),
    ...(filters.status === "ACTIVE" || filters.status === "INACTIVE" ? { status: filters.status } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.missingBarcode ? { OR: [{ barcode: null }, { barcode: "" }] } : {}),
  };
  const [total, rows, categories] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy: [{ sapItemCode: "asc" }], skip: (page - 1) * pageSize, take: pageSize, select: { id: true, sapItemCode: true, itemName: true, barcode: true, category: true, unitOfMeasure: true, status: true } }),
    prisma.product.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);
  return { total, rows, categories: categories.map((c) => c.category as string) };
}

/** A barcode already on another product (duplicate detection beyond exact match). */
async function findBarcodeConflict(tx: PrismaTransactionClient | typeof prisma, barcode: string, excludeId?: string) {
  const key = duplicateKey(barcode);
  if (!key) return null;
  return tx.product.findFirst({ where: { barcode: { equals: barcode, mode: "insensitive" }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { sapItemCode: true, itemName: true } });
}

export async function createProduct(input: { sapItemCode: string; itemName: string; barcode: string | null; category: string | null; unitOfMeasure: string | null; packSize: string | null; isVariableWeight: boolean; vatCode: string | null }, actorId: string): Promise<{ ok: true; id: string } | AdminFailure> {
  try {
    return await prisma.$transaction(async (tx) => {
      const code = await tx.product.findFirst({ where: { sapItemCode: { equals: input.sapItemCode, mode: "insensitive" } }, select: { sapItemCode: true } });
      if (code) return fail(409, `Item code ${code.sapItemCode} already exists.`, { sapItemCode: "This item code is already used." });
      if (input.barcode) {
        const c = await findBarcodeConflict(tx, input.barcode);
        if (c) return fail(409, `This barcode is already on ${c.sapItemCode} (${c.itemName}).`, { barcode: "This barcode is already used by another product." });
      }
      const created = await tx.product.create({ data: { ...input, isDemo: false }, select: { id: true } });
      await tx.auditEvent.create({ data: { actorId, action: "PRODUCT_CREATE", entityType: "Product", entityId: created.id, beforeData: Prisma.JsonNull, afterData: input as Prisma.InputJsonValue } });
      return { ok: true as const, id: created.id };
    }, TX);
  } catch (e) {
    if (isUnique(e)) return fail(409, "Item code already exists.", { sapItemCode: "This item code is already used." });
    throw e;
  }
}

type ProductPatch = { itemName?: string; barcode?: string | null; category?: string | null; unitOfMeasure?: string | null; packSize?: string | null; isVariableWeight?: boolean; vatCode?: string | null; reason: string };
const PRODUCT_KEYS = ["itemName", "barcode", "category", "unitOfMeasure", "packSize", "isVariableWeight", "vatCode"] as const;

/** The SAP item code is never editable. Changes are diffed so only real changes are written and audited. */
export async function updateProduct(id: string, patch: ProductPatch, actorId: string): Promise<{ ok: true; changed: boolean } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({ where: { id } });
    if (!existing) return fail(404, "Product not found.");
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const key of PRODUCT_KEYS) {
      const next = patch[key];
      if (next === undefined || next === existing[key]) continue;
      before[key] = existing[key];
      after[key] = next;
    }
    if (Object.keys(after).length === 0) return { ok: true as const, changed: false };
    if (typeof after.barcode === "string") {
      const c = await findBarcodeConflict(tx, after.barcode, id);
      if (c) return fail(409, `This barcode is already on ${c.sapItemCode} (${c.itemName}).`, { barcode: "This barcode is already used by another product." });
    }
    await tx.product.update({ where: { id }, data: after as Prisma.ProductUpdateInput });
    await tx.auditEvent.create({ data: { actorId, action: "PRODUCT_UPDATE", entityType: "Product", entityId: id, beforeData: before as Prisma.InputJsonValue, afterData: { ...after, reason: patch.reason } as Prisma.InputJsonValue } });
    return { ok: true as const, changed: true };
  }, TX);
}

/** Products are only ever deactivated (archived), never deleted: orders, quotations, stock and prices reference them. */
export async function setProductStatus(id: string, status: "ACTIVE" | "INACTIVE", reason: string, actorId: string): Promise<{ ok: true; changed: boolean } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.product.findUnique({ where: { id }, select: { status: true } });
    if (!existing) return fail(404, "Product not found.");
    if (existing.status === status) return { ok: true as const, changed: false };
    await tx.product.update({ where: { id }, data: { status } });
    await tx.auditEvent.create({ data: { actorId, action: status === "ACTIVE" ? "PRODUCT_ACTIVATE" : "PRODUCT_DEACTIVATE", entityType: "Product", entityId: id, beforeData: { status: existing.status }, afterData: { status, reason } } });
    return { ok: true as const, changed: true };
  }, TX);
}

export async function getProductDetail(id: string) {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return null;
  const [orderLines, quotationLines, priceEntries, history] = await Promise.all([
    prisma.orderLine.count({ where: { productId: id } }),
    prisma.quotationLine.count({ where: { productId: id } }),
    prisma.priceListEntry.count({ where: { productId: id } }),
    prisma.auditEvent.findMany({ where: { entityType: "Product", entityId: id }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, beforeData: true, afterData: true, createdAt: true, actor: { select: { name: true } } } }),
  ]);
  return { product, references: { orderLines, quotationLines, priceEntries }, history };
}

/* ----------------------------- price lists ----------------------------- */

export async function listAdminPriceLists() {
  const lists = await prisma.priceList.findMany({ orderBy: [{ status: "asc" }, { code: "asc" }], select: { id: true, code: true, name: true, currencyCode: true, status: true, _count: { select: { entries: true, customers: true } } } });
  return lists.map((l) => ({ id: l.id, code: l.code, name: l.name, currencyCode: l.currencyCode, status: l.status, entries: l._count.entries, customers: l._count.customers }));
}

export async function updatePriceList(id: string, name: string, reason: string, actorId: string): Promise<{ ok: true; changed: boolean } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.priceList.findUnique({ where: { id }, select: { name: true } });
    if (!existing) return fail(404, "Price list not found.");
    if (existing.name === name) return { ok: true as const, changed: false };
    // The code and currency are identifiers of historical prices: never edited here.
    await tx.priceList.update({ where: { id }, data: { name } });
    await tx.auditEvent.create({ data: { actorId, action: "PRICE_LIST_UPDATE", entityType: "PriceList", entityId: id, beforeData: { name: existing.name }, afterData: { name, reason } } });
    return { ok: true as const, changed: true };
  }, TX);
}

/** Deactivating is refused while any customer still uses the list (no customer silently loses its prices). */
export async function setPriceListStatus(id: string, status: "ACTIVE" | "INACTIVE", reason: string, actorId: string): Promise<{ ok: true; changed: boolean } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.priceList.findUnique({ where: { id }, select: { status: true, code: true, _count: { select: { customers: true } } } });
    if (!existing) return fail(404, "Price list not found.");
    if (existing.status === status) return { ok: true as const, changed: false };
    if (status === "INACTIVE" && existing._count.customers > 0) return fail(409, `${existing._count.customers} customer(s) still use ${existing.code}. Move them to another price list first.`);
    await tx.priceList.update({ where: { id }, data: { status } });
    await tx.auditEvent.create({ data: { actorId, action: status === "ACTIVE" ? "PRICE_LIST_ACTIVATE" : "PRICE_LIST_DEACTIVATE", entityType: "PriceList", entityId: id, beforeData: { status: existing.status }, afterData: { status, reason } } });
    return { ok: true as const, changed: true };
  }, TX);
}
