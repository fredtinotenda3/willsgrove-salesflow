import "server-only";
import { loadTaxRatesByCode } from "@/lib/order-price-resolution";
import { pricingFromLines, summariseOrderTotal } from "@/lib/order-totals";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "./audit";
import { getCustomerDeletionImpact } from "./record-deletion";
import { orderByFor, type SortDir, type SortState } from "./list-query";
import { fail, type AdminFailure } from "./types";

/**
 * Customer administration. The customer record itself is created and edited
 * through the existing operational service (/api/customers -- the same code
 * salespeople use), so there is exactly one customer table and one set of
 * validation and uniqueness rules. This file adds the read models and the
 * contact / alias management the operational screens do not offer.
 */
const TX = { maxWait: 15000, timeout: 15000 };

export type CustomerFilters = { q?: string; status?: string; managerId?: string; unassigned?: boolean; priceListId?: string; noPriceList?: boolean; category?: string; creditHold?: boolean };

export const CUSTOMER_SORTS: Record<string, (d: SortDir) => Record<string, unknown>> = {
  name: (d) => ({ name: d }), code: (d) => ({ sapCustomerCode: d }), status: (d) => ({ status: d }), manager: (d) => ({ accountManager: { name: d } }), created: (d) => ({ createdAt: d }),
};

export function customerWhere(f: CustomerFilters): Prisma.CustomerWhereInput {
  return {
    ...(f.status === "ACTIVE" || f.status === "INACTIVE" ? { status: f.status } : {}),
    ...(f.unassigned ? { accountManagerId: null } : f.managerId ? { accountManagerId: f.managerId } : {}),
    ...(f.noPriceList ? { priceListId: null } : f.priceListId ? { priceListId: f.priceListId } : {}),
    ...(f.category ? { category: f.category } : {}),
    ...(f.creditHold ? { creditHold: true } : {}),
    ...(f.q ? { OR: [{ name: { contains: f.q, mode: "insensitive" } }, { sapCustomerCode: { contains: f.q, mode: "insensitive" } }, { email: { contains: f.q, mode: "insensitive" } }, { tin: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
}

export async function listAdminCustomers(f: CustomerFilters, page: number, pageSize: number, sort: SortState = { key: "name", dir: "asc" }) {
  const where = customerWhere(f);
  const [total, rows] = await Promise.all([
    prisma.customer.count({ where }),
    prisma.customer.findMany({
      where, orderBy: orderByFor(sort, CUSTOMER_SORTS, "name") as Prisma.CustomerOrderByWithRelationInput[], skip: (page - 1) * pageSize, take: pageSize,
      select: { id: true, name: true, sapCustomerCode: true, email: true, phone: true, category: true, status: true, creditHold: true, currencyCode: true, accountManager: { select: { id: true, name: true } }, priceList: { select: { id: true, code: true } }, _count: { select: { orders: true, quotations: true, sapInvoices: true, invoiceClaims: true } } },
    }),
  ]);
  return { total, rows };
}

export async function customerFilterOptions() {
  const [categories, priceLists] = await Promise.all([
    prisma.customer.findMany({ where: { category: { not: null } }, distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    prisma.priceList.findMany({ orderBy: { code: "asc" }, select: { id: true, code: true, name: true, status: true } }),
  ]);
  return { categories: categories.map((c) => c.category as string), priceLists };
}

export async function getAdminCustomerDetail(id: string) {
  const c = await prisma.customer.findUnique({
    where: { id },
    select: {
      id: true, name: true, sapCustomerCode: true, email: true, phone: true, category: true, status: true, notes: true, tin: true, vatNumber: true, currencyCode: true, paymentTermsCode: true, branchCode: true, storeCode: true, creditLimit: true, creditHold: true, isDemo: true, createdAt: true, updatedAt: true,
      accountManager: { select: { id: true, name: true, status: true } }, priceList: { select: { id: true, code: true, name: true, currencyCode: true } },
      contacts: { orderBy: { name: "asc" }, select: { id: true, name: true, role: true, email: true, phone: true } },
      locations: { orderBy: [{ isDefault: "desc" }, { label: "asc" }], select: { id: true, label: true, addressLine1: true, addressLine2: true, city: true, province: true, isDefault: true, isActive: true } },
      customerAliases: { orderBy: { lastConfirmedAt: "desc" }, take: 50, select: { id: true, rawText: true, timesConfirmed: true, lastConfirmedAt: true } },
      _count: { select: { orders: true, quotations: true, sapInvoices: true, invoiceClaims: true, messageIntakes: true } },
    },
  });
  if (!c) return null;
  const [orders, quotations, invoices, claims, invoiceTotals, openOrders, history, deletion] = await Promise.all([
    prisma.customerOrder.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, reference: true, status: true, currency: true, total: true, createdAt: true, lines: { select: { requestedQuantity: true, customerUnitPrice: true, approvedUnitPrice: true, product: { select: { vatCode: true } } } } } }),
    prisma.quotation.findMany({ where: { customerId: id, supersededAt: null }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, quotationNumber: true, status: true, currency: true, total: true, createdAt: true } }),
    prisma.sapInvoice.findMany({ where: { matchedCustomerId: id }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, sapDocNum: true, invoiceDate: true, currencyCode: true, total: true, reconciliationStatus: true } }),
    prisma.invoiceClaim.findMany({ where: { customerId: id }, orderBy: { createdAt: "desc" }, take: 15, select: { id: true, claimReference: true, status: true, category: true, claimDate: true } }),
    prisma.sapInvoice.groupBy({ by: ["currencyCode"], where: { matchedCustomerId: id, isCancelledOrReversed: false }, _sum: { total: true }, _count: { _all: true } }),
    prisma.customerOrder.count({ where: { customerId: id, status: { in: ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] } } }),
    prisma.auditEvent.findMany({ where: { entityType: "Customer", entityId: id }, orderBy: { createdAt: "desc" }, take: 50, select: { id: true, action: true, beforeData: true, afterData: true, createdAt: true, actor: { select: { name: true } } } }),
    getCustomerDeletionImpact(id),
  ]);
  const taxRates = await loadTaxRatesByCode(orders.flatMap((o) => o.lines.map((l) => l.product?.vatCode)));
  return {
    customer: { ...c, creditLimit: c.creditLimit?.toString() ?? null },
    orders: orders.map(({ lines, ...o }) => ({ ...o, total: o.total?.toString() ?? null, orderTotal: summariseOrderTotal({ storedTotal: o.total, currency: o.currency, pricing: pricingFromLines(lines, taxRates) }) })), quotations: quotations.map((q) => ({ ...q, total: q.total.toString() })),
    invoices: invoices.map((i) => ({ ...i, total: i.total?.toString() ?? null })), claims, openOrders, history,
    invoiceTotals: invoiceTotals.map((t) => ({ currencyCode: t.currencyCode ?? "UNKNOWN", total: (t._sum.total ?? new Prisma.Decimal(0)).toString(), count: t._count._all })),
    canDelete: deletion?.verdict ?? ({ deletable: false, reason: "", blockers: [] } as const),
  };
}

/* ------------------------------ contacts ------------------------------- */

export type ContactInput = { name: string; role?: string | null; email?: string | null; phone?: string | null };

export async function createContact(customerId: string, input: ContactInput, reason: string, actorId: string): Promise<{ ok: true; id: string } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    if (!(await tx.customer.findUnique({ where: { id: customerId }, select: { id: true } }))) return fail(404, "Customer not found.");
    const dupe = await tx.customerContact.findFirst({ where: { customerId, name: { equals: input.name, mode: "insensitive" }, ...(input.email ? { email: { equals: input.email, mode: "insensitive" } } : {}) }, select: { id: true } });
    if (dupe) return fail(409, "This customer already has a contact with the same name and email.");
    const created = await tx.customerContact.create({ data: { customerId, name: input.name, role: input.role ?? null, email: input.email ?? null, phone: input.phone ?? null }, select: { id: true } });
    await writeAudit(tx, { actorId, action: "CUSTOMER_CONTACT_CREATE", entityType: "Customer", entityId: customerId, after: { contactId: created.id, ...input }, reason });
    return { ok: true as const, id: created.id };
  }, TX);
}

export async function updateContact(customerId: string, contactId: string, input: Partial<ContactInput>, reason: string, actorId: string): Promise<{ ok: true } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customerContact.findFirst({ where: { id: contactId, customerId }, select: { name: true, role: true, email: true, phone: true } });
    if (!existing) return fail(404, "Contact not found for this customer.");
    const data: Prisma.CustomerContactUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    for (const k of ["name", "role", "email", "phone"] as const) {
      if (input[k] !== undefined && input[k] !== existing[k]) { before[k] = existing[k]; after[k] = input[k]; (data as Record<string, unknown>)[k] = input[k]; }
    }
    if (Object.keys(after).length === 0) return { ok: true as const };
    await tx.customerContact.update({ where: { id: contactId }, data });
    await writeAudit(tx, { actorId, action: "CUSTOMER_CONTACT_UPDATE", entityType: "Customer", entityId: customerId, before: { contactId, ...before }, after: { contactId, ...after }, reason });
    return { ok: true as const };
  }, TX);
}

/** Contacts referenced by quotations or messages are kept (history stays attributable); the rest may be removed. */
export async function deleteContact(customerId: string, contactId: string, reason: string, actorId: string): Promise<{ ok: true } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.customerContact.findFirst({ where: { id: contactId, customerId }, select: { name: true, role: true, email: true, phone: true, _count: { select: { quotations: true, messageIntakes: true, outboundMessages: true } } } });
    if (!existing) return fail(404, "Contact not found for this customer.");
    const refs = existing._count.quotations + existing._count.messageIntakes + existing._count.outboundMessages;
    if (refs > 0) return fail(409, `This contact appears on ${refs} quotation(s) or message(s) and is kept so that history stays attributable. Edit it instead.`);
    await tx.customerContact.delete({ where: { id: contactId } });
    await writeAudit(tx, { actorId, action: "CUSTOMER_CONTACT_DELETE", entityType: "Customer", entityId: customerId, before: { contactId, name: existing.name, role: existing.role, email: existing.email, phone: existing.phone }, after: { deleted: true }, reason });
    return { ok: true as const };
  }, TX);
}

export async function removeCustomerAlias(aliasId: string, reason: string, actorId: string): Promise<{ ok: true } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const a = await tx.customerAlias.findUnique({ where: { id: aliasId }, select: { rawText: true, customerId: true, timesConfirmed: true } });
    if (!a) return fail(404, "Alias not found.");
    await tx.customerAlias.delete({ where: { id: aliasId } });
    await writeAudit(tx, { actorId, action: "CUSTOMER_ALIAS_REMOVE", entityType: "Customer", entityId: a.customerId, before: { aliasId, rawText: a.rawText, timesConfirmed: a.timesConfirmed }, after: { removed: true }, reason });
    return { ok: true as const };
  }, TX);
}
