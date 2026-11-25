import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, type PrismaTransactionClient } from "@/lib/prisma";
import { recordRefusal, writeAudit } from "./audit";
import { checkCustomerDeletable, checkOrderDeletable, checkPriceListDeletable, checkProductDeletable, type DeleteVerdict, type OrderDeleteFacts } from "./deletion-policy";
import { fail, type AdminFailure } from "./types";

/**
 * Safe, audited hard deletion for the few entities whose policy allows it
 * (see lib/admin/deletion-policy.ts). Each delete:
 *  1. recomputes the dependency counts INSIDE the transaction (never trusting
 *     what the page showed),
 *  2. refuses with a precise explanation when anything refers to the record
 *     (and records the refusal),
 *  3. deletes only the record's own children, then the record,
 *  4. writes an audit event carrying a snapshot, atomically with the delete.
 * Foreign keys remain the last line of defence: a race that adds a reference
 * makes the database refuse (P2003) and the whole transaction rolls back.
 */
const TX = { maxWait: 15000, timeout: 15000 };
type Db = PrismaTransactionClient | typeof prisma;

class Refused extends Error {
  constructor(public readonly failure: AdminFailure) { super(failure.message); }
}

const isFkViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2003";

async function guarded<T extends { ok: true }>(entityType: string, entityId: string, actorId: string, run: () => Promise<T>): Promise<T | AdminFailure> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Refused) {
      await recordRefusal({ actorId, action: `${entityType.toUpperCase()}_DELETE_REFUSED`, entityType, entityId, reason: error.failure.message });
      return error.failure;
    }
    if (isFkViolation(error)) {
      const failure = fail(409, "Something still refers to this record, so it cannot be deleted. Nothing was changed.");
      await recordRefusal({ actorId, action: `${entityType.toUpperCase()}_DELETE_REFUSED`, entityType, entityId, reason: failure.message });
      return failure;
    }
    throw error;
  }
}

/* -------------------------------- order -------------------------------- */

async function orderFacts(db: Db, id: string): Promise<(OrderDeleteFacts & { reference: string; customerId: string; total: string | null; lineCount: number; createdAt: Date }) | null> {
  const o = await db.customerOrder.findUnique({
    where: { id },
    select: {
      reference: true, status: true, handedToSapAt: true, invoicedAt: true, customerId: true, total: true, createdAt: true,
      _count: { select: { lines: true, documents: true, approvals: true, approvalRequests: true, pickingSessions: true, handovers: true, dispatchRecords: true, matchedSapInvoices: true, matchedSapInvoiceLines: true, invoiceClaims: true, unfulfilledDemands: true, linkedMessageIntakes: true, outboundMessages: true, decisionRecommendations: true } },
    },
  });
  if (!o) return null;
  const [integrationOperations, sourceQuotations, verifications, priceDecisions] = await Promise.all([
    db.integrationOperation.count({ where: { customerOrderId: id } }),
    db.quotation.count({ where: { convertedOrderId: id } }),
    db.productVerification.count({ where: { orderLine: { orderId: id } } }),
    db.priceDecision.count({ where: { orderLine: { orderId: id } } }),
  ]);
  const c = o._count;
  return {
    reference: o.reference, status: o.status, handedToSapAt: o.handedToSapAt, invoicedAt: o.invoicedAt, customerId: o.customerId, total: o.total?.toString() ?? null, lineCount: c.lines, createdAt: o.createdAt,
    counts: { documents: c.documents, approvals: c.approvals, approvalRequests: c.approvalRequests, pickingSessions: c.pickingSessions, handovers: c.handovers, dispatchRecords: c.dispatchRecords, matchedInvoices: c.matchedSapInvoices, matchedInvoiceLines: c.matchedSapInvoiceLines, claims: c.invoiceClaims, demands: c.unfulfilledDemands, integrationOperations, messageIntakes: c.linkedMessageIntakes, outboundMessages: c.outboundMessages, recommendations: c.decisionRecommendations, sourceQuotations, verifications, priceDecisions },
  };
}

export async function getOrderDeletionImpact(id: string): Promise<{ verdict: DeleteVerdict } | null> {
  const facts = await orderFacts(prisma, id);
  return facts ? { verdict: checkOrderDeletable(facts) } : null;
}

export async function deleteDraftOrder(id: string, reason: string, actorId: string): Promise<{ ok: true } | AdminFailure> {
  return guarded("CustomerOrder", id, actorId, () =>
    prisma.$transaction(async (tx) => {
      const facts = await orderFacts(tx, id);
      if (!facts) throw new Refused(fail(404, "Order not found."));
      const verdict = checkOrderDeletable(facts);
      if (!verdict.deletable) throw new Refused(fail(409, verdict.reason));
      await tx.orderStatusHistory.deleteMany({ where: { orderId: id } });
      await tx.orderLine.deleteMany({ where: { orderId: id } });
      const removed = await tx.customerOrder.deleteMany({ where: { id, status: "DRAFT" } });
      if (removed.count !== 1) throw new Refused(fail(409, "The order changed while you were working. Refresh and try again."));
      await writeAudit(tx, { actorId, action: "ORDER_ADMIN_DELETE", entityType: "CustomerOrder", entityId: id, before: { reference: facts.reference, status: facts.status, customerId: facts.customerId, lines: facts.lineCount, total: facts.total, createdAt: facts.createdAt.toISOString() }, after: { deleted: true }, reason });
      return { ok: true as const };
    }, TX)
  );
}

/* ------------------------------- customer ------------------------------ */

async function customerCounts(db: Db, id: string) {
  const [orders, quotations, invoices, claims, demands, intakes, outbound, recommendations, returnLostSales] = await Promise.all([
    db.customerOrder.count({ where: { customerId: id } }), db.quotation.count({ where: { customerId: id } }), db.sapInvoice.count({ where: { matchedCustomerId: id } }),
    db.invoiceClaim.count({ where: { customerId: id } }), db.unfulfilledDemand.count({ where: { customerId: id } }), db.messageIntake.count({ where: { customerId: id } }),
    db.outboundMessage.count({ where: { customerId: id } }), db.decisionRecommendation.count({ where: { customerId: id } }), db.claimReturnLostSale.count({ where: { customerId: id } }),
  ]);
  return { orders, quotations, invoices, claims, demands, intakes, outbound, recommendations, returnLostSales };
}

export async function getCustomerDeletionImpact(id: string): Promise<{ verdict: DeleteVerdict } | null> {
  if (!(await prisma.customer.findUnique({ where: { id }, select: { id: true } }))) return null;
  return { verdict: checkCustomerDeletable(await customerCounts(prisma, id)) };
}

export async function deleteCustomer(id: string, reason: string, actorId: string): Promise<{ ok: true } | AdminFailure> {
  return guarded("Customer", id, actorId, () =>
    prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUnique({ where: { id }, select: { name: true, sapCustomerCode: true, status: true } });
      if (!c) throw new Refused(fail(404, "Customer not found."));
      const verdict = checkCustomerDeletable(await customerCounts(tx, id));
      if (!verdict.deletable) throw new Refused(fail(409, `${verdict.reason} Deactivate the customer instead.`));
      await tx.customerContact.deleteMany({ where: { customerId: id } });
      await tx.customerLocation.deleteMany({ where: { customerId: id } });
      await tx.customer.delete({ where: { id } }); // aliases cascade (schema); any other reference makes the FK refuse
      await writeAudit(tx, { actorId, action: "CUSTOMER_ADMIN_DELETE", entityType: "Customer", entityId: id, before: { name: c.name, sapCustomerCode: c.sapCustomerCode, status: c.status }, after: { deleted: true }, reason });
      return { ok: true as const };
    }, TX)
  );
}

/* -------------------------------- product ------------------------------ */

async function productCounts(db: Db, id: string, sapItemCode: string) {
  const [orderLines, quotationLines, priceEntries, stockLines, demands, extractedLines, recommendations, substituteEvents] = await Promise.all([
    db.orderLine.count({ where: { productId: id } }), db.quotationLine.count({ where: { productId: id } }),
    db.priceListEntry.count({ where: { OR: [{ productId: id }, { sapItemCodeSnapshot: sapItemCode }] } }),
    db.stockSnapshotLine.count({ where: { productId: id } }), db.unfulfilledDemand.count({ where: { productId: id } }),
    db.extractedOrderLine.count({ where: { matchedProductId: id } }), db.decisionRecommendation.count({ where: { productId: id } }), db.customerDecisionEvent.count({ where: { substituteProductId: id } }),
  ]);
  return { orderLines, quotationLines, priceEntries, stockLines, demands, extractedLines, recommendations, substituteEvents };
}

export async function getProductDeletionImpact(id: string): Promise<{ verdict: DeleteVerdict } | null> {
  const p = await prisma.product.findUnique({ where: { id }, select: { sapItemCode: true } });
  return p ? { verdict: checkProductDeletable(await productCounts(prisma, id, p.sapItemCode)) } : null;
}

export async function deleteProduct(id: string, reason: string, actorId: string): Promise<{ ok: true } | AdminFailure> {
  return guarded("Product", id, actorId, () =>
    prisma.$transaction(async (tx) => {
      const p = await tx.product.findUnique({ where: { id }, select: { sapItemCode: true, itemName: true, barcode: true, status: true } });
      if (!p) throw new Refused(fail(404, "Product not found."));
      const verdict = checkProductDeletable(await productCounts(tx, id, p.sapItemCode));
      if (!verdict.deletable) throw new Refused(fail(409, `${verdict.reason} Archive the product instead; it can be restored at any time.`));
      await tx.product.delete({ where: { id } }); // aliases cascade (schema)
      await writeAudit(tx, { actorId, action: "PRODUCT_ADMIN_DELETE", entityType: "Product", entityId: id, before: { sapItemCode: p.sapItemCode, itemName: p.itemName, barcode: p.barcode, status: p.status }, after: { deleted: true }, reason });
      return { ok: true as const };
    }, TX)
  );
}

export async function removeProductAlias(aliasId: string, reason: string, actorId: string): Promise<{ ok: true } | AdminFailure> {
  return prisma.$transaction(async (tx) => {
    const a = await tx.productAlias.findUnique({ where: { id: aliasId }, select: { rawText: true, productId: true, customerId: true, timesConfirmed: true } });
    if (!a) return fail(404, "Alias not found.");
    await tx.productAlias.delete({ where: { id: aliasId } });
    await writeAudit(tx, { actorId, action: "PRODUCT_ALIAS_REMOVE", entityType: "Product", entityId: a.productId, before: { aliasId, rawText: a.rawText, customerId: a.customerId, timesConfirmed: a.timesConfirmed }, after: { removed: true }, reason });
    return { ok: true as const };
  }, TX);
}

/* ------------------------------ price list ----------------------------- */

async function priceListCounts(db: Db, id: string) {
  const [entries, customers] = await Promise.all([db.priceListEntry.count({ where: { priceListId: id } }), db.customer.count({ where: { priceListId: id } })]);
  return { entries, customers };
}

export async function getPriceListDeletionImpact(id: string): Promise<{ verdict: DeleteVerdict } | null> {
  if (!(await prisma.priceList.findUnique({ where: { id }, select: { id: true } }))) return null;
  return { verdict: checkPriceListDeletable(await priceListCounts(prisma, id)) };
}

export async function deletePriceList(id: string, reason: string, actorId: string): Promise<{ ok: true } | AdminFailure> {
  return guarded("PriceList", id, actorId, () =>
    prisma.$transaction(async (tx) => {
      const pl = await tx.priceList.findUnique({ where: { id }, select: { code: true, name: true, currencyCode: true, status: true } });
      if (!pl) throw new Refused(fail(404, "Price list not found."));
      const verdict = checkPriceListDeletable(await priceListCounts(tx, id));
      if (!verdict.deletable) throw new Refused(fail(409, `${verdict.reason} Deactivate it instead; historical prices are never rewritten.`));
      await tx.priceList.delete({ where: { id } });
      await writeAudit(tx, { actorId, action: "PRICE_LIST_ADMIN_DELETE", entityType: "PriceList", entityId: id, before: { ...pl }, after: { deleted: true }, reason });
      return { ok: true as const };
    }, TX)
  );
}
