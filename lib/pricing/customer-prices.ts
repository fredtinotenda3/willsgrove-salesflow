import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { resolveCustomerPriceListPrices } from "@/lib/order-price-resolution";
import {
  CUSTOMER_PRICE_CSV_HEADER,
  isSupportedCurrency,
  normalizePrice,
  parseCustomerPriceCsv,
  pricesEqual,
  validateUnitPrice,
  type PriceSource,
} from "./price-core";
import { toCsv } from "@/lib/admin/csv";

/**
 * Customer-specific price management. Every mutation:
 *   - runs in ONE transaction (row + history + audit commit together or not at all)
 *   - touches only the (customerId, productId) row it names -- never another
 *     customer's override and never a PriceListEntry (the shared list)
 *   - is idempotent: setting the price a row already has writes nothing
 *   - records an append-only CustomerProductPriceHistory row and an AuditEvent
 *
 * Authorization is enforced by the caller (the admin route runs through
 * adminMutation: CSRF -> ADMINISTRATOR role re-read from the database).
 */

const TX = { maxWait: 15000, timeout: 15000 };

export type PriceChangeSource = "UI" | "BULK" | "IMPORT";
export type CustomerPriceFailure = { ok: false; status: number; message: string; fieldErrors?: Record<string, string> };
const fail = (status: number, message: string, fieldErrors?: Record<string, string>): CustomerPriceFailure => ({ ok: false, status, message, fieldErrors });

/** The currency an override must be in: the assigned list's, else the customer's own, else (first override ever) the one supplied. */
async function effectiveCurrencyFor(tx: PrismaTransactionClient, customerId: string): Promise<{ exists: boolean; currency: string | null }> {
  const customer = await tx.customer.findUnique({ where: { id: customerId }, select: { currencyCode: true, priceList: { select: { currencyCode: true } } } });
  if (!customer) return { exists: false, currency: null };
  if (customer.priceList?.currencyCode) return { exists: true, currency: customer.priceList.currencyCode };
  if (isSupportedCurrency(customer.currencyCode)) return { exists: true, currency: customer.currencyCode };
  const existing = await tx.customerProductPrice.findFirst({ where: { customerId }, orderBy: { createdAt: "asc" }, select: { currencyCode: true } });
  return { exists: true, currency: existing?.currencyCode ?? null };
}

export type SetPriceInput = {
  customerId: string;
  productId: string;
  unitPrice: string;
  /** Required when the customer has no price list and no currency of their own; otherwise must equal the effective currency. */
  currencyCode?: string | null;
  notes?: string | null;
  reason?: string | null;
};

export type SetPriceResult =
  | { ok: true; changed: boolean; changeType: "CREATED" | "UPDATED" | "UNCHANGED"; unitPrice: string; currencyCode: string }
  | CustomerPriceFailure;

async function setPriceInTx(tx: PrismaTransactionClient, input: SetPriceInput, actorId: string, source: PriceChangeSource): Promise<SetPriceResult> {
  const price = validateUnitPrice(input.unitPrice);
  if (!price.ok) return fail(400, price.message, { unitPrice: price.message });
  const newPrice = normalizePrice(price.value);

  const { exists, currency } = await effectiveCurrencyFor(tx, input.customerId);
  if (!exists) return fail(404, "Customer not found.");
  const requested = input.currencyCode ? input.currencyCode.toUpperCase() : null;
  if (requested !== null && !isSupportedCurrency(requested)) return fail(400, "Currency must be USD or ZWG.", { currencyCode: "Currency must be USD or ZWG." });
  const effective = currency ?? requested;
  if (effective === null) return fail(400, "This customer has no price list or currency. Choose USD or ZWG for the price.", { currencyCode: "Choose a currency." });
  if (requested !== null && requested !== effective) {
    return fail(409, `This customer trades in ${effective}; a ${requested} price cannot be set. Currencies are never mixed or converted.`, { currencyCode: `Customer currency is ${effective}.` });
  }

  const product = await tx.product.findUnique({ where: { id: input.productId }, select: { id: true, sapItemCode: true, status: true } });
  if (!product) return fail(404, "Product not found.");

  const existing = await tx.customerProductPrice.findUnique({ where: { customerId_productId: { customerId: input.customerId, productId: input.productId } } });
  if (existing && existing.currencyCode === effective && pricesEqual(existing.unitPrice.toString(), newPrice)) {
    const notesChanged = (input.notes ?? null) !== null && (input.notes ?? null) !== existing.notes;
    if (!notesChanged) return { ok: true, changed: false, changeType: "UNCHANGED", unitPrice: newPrice, currencyCode: effective };
  }

  const saved = await tx.customerProductPrice.upsert({
    where: { customerId_productId: { customerId: input.customerId, productId: input.productId } },
    create: { customerId: input.customerId, productId: input.productId, currencyCode: effective, unitPrice: new Prisma.Decimal(newPrice), notes: input.notes ?? null, createdById: actorId, updatedById: actorId },
    update: { currencyCode: effective, unitPrice: new Prisma.Decimal(newPrice), ...(input.notes !== undefined ? { notes: input.notes } : {}), updatedById: actorId },
  });
  const changeType = existing ? "UPDATED" : "CREATED";
  await tx.customerProductPriceHistory.create({
    data: {
      customerId: input.customerId,
      productId: input.productId,
      sapItemCodeSnapshot: product.sapItemCode,
      currencyCode: effective,
      changeType,
      oldUnitPrice: existing ? existing.unitPrice : null,
      newUnitPrice: saved.unitPrice,
      source,
      reason: input.reason ?? null,
      actorId,
    },
  });
  await tx.auditEvent.create({
    data: {
      actorId,
      action: existing ? "CUSTOMER_PRICE_UPDATE" : "CUSTOMER_PRICE_CREATE",
      entityType: "Customer",
      entityId: input.customerId,
      beforeData: existing ? { productId: input.productId, unitPrice: existing.unitPrice.toString(), currencyCode: existing.currencyCode } : Prisma.JsonNull,
      afterData: { productId: input.productId, unitPrice: newPrice, currencyCode: effective, source, reason: input.reason ?? null },
    },
  });
  return { ok: true, changed: true, changeType, unitPrice: newPrice, currencyCode: effective };
}

export async function setCustomerPrice(input: SetPriceInput, actorId: string, source: PriceChangeSource = "UI"): Promise<SetPriceResult> {
  return prisma.$transaction((tx) => setPriceInTx(tx, input, actorId, source), TX);
}

export type RemovePriceResult = { ok: true; removed: boolean } | CustomerPriceFailure;

async function removePriceInTx(tx: PrismaTransactionClient, customerId: string, productId: string, actorId: string, reason: string | null, source: PriceChangeSource): Promise<RemovePriceResult> {
  const existing = await tx.customerProductPrice.findUnique({ where: { customerId_productId: { customerId, productId } }, include: { product: { select: { sapItemCode: true } } } });
  if (!existing) return { ok: true, removed: false }; // idempotent: already gone
  await tx.customerProductPrice.delete({ where: { id: existing.id } });
  await tx.customerProductPriceHistory.create({
    data: { customerId, productId, sapItemCodeSnapshot: existing.product.sapItemCode, currencyCode: existing.currencyCode, changeType: "REMOVED", oldUnitPrice: existing.unitPrice, newUnitPrice: null, source, reason, actorId },
  });
  await tx.auditEvent.create({
    data: { actorId, action: "CUSTOMER_PRICE_REMOVE", entityType: "Customer", entityId: customerId, beforeData: { productId, unitPrice: existing.unitPrice.toString(), currencyCode: existing.currencyCode }, afterData: { productId, reason } },
  });
  return { ok: true, removed: true };
}

/** Removing an override only deletes that one row: the customer falls back to their price list; the list itself is untouched. */
export async function removeCustomerPrice(customerId: string, productId: string, actorId: string, reason: string | null = null, source: PriceChangeSource = "UI"): Promise<RemovePriceResult> {
  return prisma.$transaction((tx) => removePriceInTx(tx, customerId, productId, actorId, reason, source), TX);
}

export type BulkItemResult = { productId: string; status: "CREATED" | "UPDATED" | "UNCHANGED" | "REMOVED" | "FAILED"; message?: string };

/** All-or-nothing: any invalid item aborts the whole batch and reports every failure, so a half-applied bulk edit never exists. */
export async function bulkSetCustomerPrices(
  customerId: string,
  items: { productId: string; unitPrice: string | null; notes?: string | null }[],
  actorId: string,
  reason: string | null,
  source: PriceChangeSource = "BULK"
): Promise<{ ok: true; results: BulkItemResult[] } | { ok: false; status: number; message: string; results: BulkItemResult[] }> {
  if (items.length === 0) return { ok: false, status: 400, message: "No items supplied.", results: [] };
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.productId)) return { ok: false, status: 400, message: "A product appears more than once in the request.", results: [] };
    seen.add(item.productId);
  }
  class Abort extends Error {
    constructor(public results: BulkItemResult[]) {
      super("bulk-abort");
    }
  }
  try {
    return await prisma.$transaction(async (tx) => {
      const results: BulkItemResult[] = [];
      let failed = false;
      for (const item of items) {
        if (item.unitPrice === null || item.unitPrice === "") {
          const removed = await removePriceInTx(tx, customerId, item.productId, actorId, reason, source);
          results.push(removed.ok ? { productId: item.productId, status: removed.removed ? "REMOVED" : "UNCHANGED" } : { productId: item.productId, status: "FAILED", message: removed.message });
          failed ||= !removed.ok;
          continue;
        }
        const set = await setPriceInTx(tx, { customerId, productId: item.productId, unitPrice: item.unitPrice, notes: item.notes, reason }, actorId, source);
        results.push(set.ok ? { productId: item.productId, status: set.changeType } : { productId: item.productId, status: "FAILED", message: set.message });
        failed ||= !set.ok;
      }
      if (failed) throw new Abort(results);
      return { ok: true as const, results };
    }, TX);
  } catch (error) {
    if (error instanceof Abort) return { ok: false, status: 400, message: "Some prices are invalid; nothing was changed.", results: error.results };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Import / export
// ---------------------------------------------------------------------------

export type ImportRowOutcome = { line: number; sapItemCode: string; status: "CREATED" | "UPDATED" | "UNCHANGED" | "FAILED"; message?: string };

/**
 * CSV import for ONE customer (chosen in the UI, never taken from the file's
 * customerCode column unless it matches). `dryRun` validates and reports what
 * would change without writing. A real run is all-or-nothing.
 */
export async function importCustomerPrices(customerId: string, csvText: string, actorId: string, dryRun: boolean): Promise<
  { ok: true; dryRun: boolean; outcomes: ImportRowOutcome[]; summary: Record<string, number> } | { ok: false; status: number; message: string; outcomes: ImportRowOutcome[] }
> {
  const parsed = parseCustomerPriceCsv(csvText);
  if (parsed.errors.length > 0 && parsed.rows.length === 0) return { ok: false, status: 400, message: parsed.errors[0].message, outcomes: [] };

  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, sapCustomerCode: true } });
  if (!customer) return { ok: false, status: 404, message: "Customer not found.", outcomes: [] };

  const codes = parsed.rows.map((r) => r.sapItemCode);
  const products = await prisma.product.findMany({ where: { sapItemCode: { in: codes } }, select: { id: true, sapItemCode: true } });
  const productByCode = new Map(products.map((p) => [p.sapItemCode, p.id]));

  const outcomes: ImportRowOutcome[] = parsed.errors.map((e) => ({ line: e.line, sapItemCode: "", status: "FAILED" as const, message: e.message }));
  const valid: { line: number; sapItemCode: string; productId: string; unitPrice: string; currency: string | null; notes: string | null }[] = [];
  for (const row of parsed.rows) {
    const productId = productByCode.get(row.sapItemCode);
    if (!productId) {
      outcomes.push({ line: row.line, sapItemCode: row.sapItemCode, status: "FAILED", message: "Unknown item code." });
      continue;
    }
    if (row.customerCode && customer.sapCustomerCode && row.customerCode !== customer.sapCustomerCode) {
      outcomes.push({ line: row.line, sapItemCode: row.sapItemCode, status: "FAILED", message: `Row is for customer ${row.customerCode}, not the selected customer.` });
      continue;
    }
    valid.push({ line: row.line, sapItemCode: row.sapItemCode, productId, unitPrice: row.unitPrice, currency: row.currency, notes: row.notes });
  }

  class Abort extends Error {}
  const applied: ImportRowOutcome[] = [];
  try {
    await prisma.$transaction(async (tx) => {
      for (const row of valid) {
        const result = await setPriceInTx(tx, { customerId, productId: row.productId, unitPrice: row.unitPrice, currencyCode: row.currency, notes: row.notes, reason: "CSV import" }, actorId, "IMPORT");
        applied.push(result.ok ? { line: row.line, sapItemCode: row.sapItemCode, status: result.changeType } : { line: row.line, sapItemCode: row.sapItemCode, status: "FAILED", message: result.message });
      }
      // A dry run (or any failure) rolls back everything, including the history/audit rows it wrote.
      if (dryRun || applied.some((r) => r.status === "FAILED") || outcomes.length > 0) throw new Abort();
    }, TX);
  } catch (error) {
    if (!(error instanceof Abort)) throw error;
  }
  const all = [...outcomes, ...applied].sort((a, b) => a.line - b.line);
  const failedAny = all.some((o) => o.status === "FAILED");
  const summary: Record<string, number> = {};
  for (const o of all) summary[o.status] = (summary[o.status] ?? 0) + 1;
  if (failedAny) return { ok: false, status: 400, message: "The file has errors; nothing was imported.", outcomes: all };
  return { ok: true, dryRun, outcomes: all, summary };
}

export async function exportCustomerPricesCsv(customerId: string): Promise<{ customerName: string; csv: string } | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { name: true, sapCustomerCode: true } });
  if (!customer) return null;
  const rows = await prisma.customerProductPrice.findMany({ where: { customerId }, orderBy: { product: { sapItemCode: "asc" } }, select: { currencyCode: true, unitPrice: true, notes: true, product: { select: { sapItemCode: true, itemName: true } } } });
  const csv = toCsv([...CUSTOMER_PRICE_CSV_HEADER], rows.map((r) => [customer.sapCustomerCode ?? "", customer.name, r.product.sapItemCode, r.product.itemName, r.currencyCode, r.unitPrice.toString(), r.notes ?? ""]));
  return { customerName: customer.name, csv };
}

// ---------------------------------------------------------------------------
// Reads for the admin workspace (batched: no per-row queries)
// ---------------------------------------------------------------------------

export type CustomerPriceRow = {
  productId: string;
  sapItemCode: string;
  itemName: string;
  unitOfMeasure: string | null;
  unitPrice: string | null;
  currencyCode: string | null;
  source: PriceSource | null;
  priceListCode: string | null;
  listPrice: string | null;
  overrideNotes: string | null;
  overrideUpdatedAt: Date | null;
  currencyMismatch: boolean;
};

export type CustomerPriceView = {
  customer: { id: string; name: string; currencyCode: string | null; priceListId: string | null; priceListCode: string | null; priceListCurrency: string | null };
  effectiveCurrency: string | null;
  rows: CustomerPriceRow[];
  totalMatching: number;
  overrideCount: number;
  withoutPriceCount: number;
};

export type CustomerPriceFilter = { q?: string; show?: "all" | "overrides" | "inherited" | "missing"; page: number; pageSize: number };

/** One page of the customer's ACTIVE products with the price that would apply today and where it comes from. */
export async function getCustomerPriceView(customerId: string, filter: CustomerPriceFilter): Promise<CustomerPriceView | null> {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, name: true, currencyCode: true, priceListId: true, priceList: { select: { code: true, currencyCode: true } } } });
  if (!customer) return null;

  const search: Prisma.ProductWhereInput = filter.q ? { OR: [{ sapItemCode: { contains: filter.q, mode: "insensitive" } }, { itemName: { contains: filter.q, mode: "insensitive" } }] } : {};
  const base: Prisma.ProductWhereInput = { status: "ACTIVE", ...search };

  // Price-list-covered products today (for the inherited/missing split).
  const now = new Date();
  const listCoveredCodes = customer.priceListId
    ? (await prisma.priceListEntry.findMany({
        where: { priceListId: customer.priceListId, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
        select: { sapItemCodeSnapshot: true },
        distinct: ["sapItemCodeSnapshot"],
      })).map((e) => e.sapItemCodeSnapshot)
    : [];
  const overrideProductIds = (await prisma.customerProductPrice.findMany({ where: { customerId }, select: { productId: true } })).map((o) => o.productId);

  const where: Prisma.ProductWhereInput = { ...base };
  if (filter.show === "overrides") where.id = { in: overrideProductIds };
  else if (filter.show === "inherited") Object.assign(where, { id: { notIn: overrideProductIds }, sapItemCode: { in: listCoveredCodes } });
  else if (filter.show === "missing") Object.assign(where, { id: { notIn: overrideProductIds }, sapItemCode: { notIn: listCoveredCodes } });

  const [totalMatching, products, missingTotal] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy: { sapItemCode: "asc" }, skip: (filter.page - 1) * filter.pageSize, take: filter.pageSize, select: { id: true, sapItemCode: true, itemName: true, unitOfMeasure: true } }),
    prisma.product.count({ where: { status: "ACTIVE", id: { notIn: overrideProductIds }, sapItemCode: { notIn: listCoveredCodes } } }),
  ]);

  const productIds = products.map((p) => p.id);
  const resolved = await resolveCustomerPriceListPrices(prisma, customerId, productIds);
  const overrides = productIds.length > 0 ? await prisma.customerProductPrice.findMany({ where: { customerId, productId: { in: productIds } }, select: { productId: true, notes: true, updatedAt: true } }) : [];
  const overrideByProduct = new Map(overrides.map((o) => [o.productId, o]));
  // The list price underneath an override, so the UI can show "list price X, overridden to Y".
  const listOnly = customer.priceListId && productIds.length > 0 ? await listPricesOnly(customer.priceListId, products) : new Map<string, string>();

  const rows: CustomerPriceRow[] = products.map((p) => ({
    productId: p.id,
    sapItemCode: p.sapItemCode,
    itemName: p.itemName,
    unitOfMeasure: p.unitOfMeasure,
    unitPrice: resolved.priceByProductId.get(p.id) ?? null,
    currencyCode: resolved.priceByProductId.has(p.id) ? resolved.currencyCode : null,
    source: resolved.sourceByProductId.get(p.id) ?? null,
    priceListCode: resolved.priceListCode,
    listPrice: listOnly.get(p.id) ?? null,
    overrideNotes: overrideByProduct.get(p.id)?.notes ?? null,
    overrideUpdatedAt: overrideByProduct.get(p.id)?.updatedAt ?? null,
    currencyMismatch: resolved.currencyMismatchProductIds.has(p.id),
  }));

  return {
    customer: { id: customer.id, name: customer.name, currencyCode: customer.currencyCode, priceListId: customer.priceListId, priceListCode: customer.priceList?.code ?? null, priceListCurrency: customer.priceList?.currencyCode ?? null },
    effectiveCurrency: resolved.currencyCode,
    rows,
    totalMatching,
    overrideCount: overrideProductIds.length,
    withoutPriceCount: missingTotal,
  };
}

async function listPricesOnly(priceListId: string, products: { id: string; sapItemCode: string }[]): Promise<Map<string, string>> {
  const now = new Date();
  const entries = await prisma.priceListEntry.findMany({
    where: { priceListId, sapItemCodeSnapshot: { in: products.map((p) => p.sapItemCode) }, validFrom: { lte: now }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
    orderBy: { validFrom: "desc" },
    select: { sapItemCodeSnapshot: true, unitPrice: true },
  });
  const byCode = new Map<string, string>();
  for (const e of entries) if (!byCode.has(e.sapItemCodeSnapshot)) byCode.set(e.sapItemCodeSnapshot, e.unitPrice.toString());
  return new Map(products.filter((p) => byCode.has(p.sapItemCode)).map((p) => [p.id, byCode.get(p.sapItemCode) as string]));
}

export async function listCustomerPriceHistory(customerId: string, productId: string | null, take = 100) {
  const rows = await prisma.customerProductPriceHistory.findMany({
    where: { customerId, ...(productId ? { productId } : {}) },
    orderBy: { createdAt: "desc" },
    take,
  });
  const actorIds = [...new Set(rows.map((r) => r.actorId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : [];
  const actorName = new Map(actors.map((a) => [a.id, a.name]));
  return rows.map((r) => ({
    id: r.id,
    productId: r.productId,
    sapItemCode: r.sapItemCodeSnapshot,
    changeType: r.changeType,
    currencyCode: r.currencyCode,
    oldUnitPrice: r.oldUnitPrice?.toString() ?? null,
    newUnitPrice: r.newUnitPrice?.toString() ?? null,
    source: r.source,
    reason: r.reason,
    actorName: r.actorId ? (actorName.get(r.actorId) ?? null) : null,
    createdAt: r.createdAt,
  }));
}
