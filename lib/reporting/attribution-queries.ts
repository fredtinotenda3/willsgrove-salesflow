import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  classifyOrderAttribution,
  type AttributionBucket,
  type OrderAttributionContext,
} from "@/lib/reporting/attribution";

/**
 * Milestone 12 (Sales Performance Intelligence). The database-backed
 * half of lib/reporting/attribution.ts -- bulk-fetches exactly the
 * AuditEvents/Quotations needed to classify a batch of orders, with NO
 * N+1 per-order queries, then delegates every actual classification
 * decision to that pure module. Imports @/lib/prisma at module scope,
 * so (same as every other lib/reporting/*.ts file) this is only
 * exercised by this project's RUN_DB_INTEGRATION_TESTS=1 suite, never
 * by an unconditional unit test -- see lib/reporting/attribution.ts's
 * own module comment for why the classification logic itself lives
 * there instead.
 */

export type OrderForAttribution = OrderAttributionContext & { id: string };

/**
 * Classifies a batch of orders in exactly two extra round trips
 * (regardless of batch size): one AuditEvent lookup for the direct
 * orders' own ORDER_CREATE events, and one Quotation + one AuditEvent
 * lookup for the quotation-sourced orders' SOURCE quotations' own
 * QUOTATION_CREATED events.
 */
export async function classifyOrderAttributions(orders: readonly OrderForAttribution[]): Promise<Map<string, AttributionBucket>> {
  const result = new Map<string, AttributionBucket>();
  if (orders.length === 0) return result;

  const directOrders = orders.filter((o) => o.source !== "QUOTATION" && o.salespersonId !== null);
  const quotationSourcedOrders = orders.filter((o) => o.source === "QUOTATION" && o.salespersonId !== null);

  for (const order of orders) {
    if (order.salespersonId === null) result.set(order.id, "UNASSIGNED");
  }

  if (directOrders.length > 0) {
    const events = await prisma.auditEvent.findMany({
      where: { entityType: "CustomerOrder", action: "ORDER_CREATE", entityId: { in: directOrders.map((o) => o.id) } },
      select: { entityId: true, afterData: true },
    });
    const eventByOrderId = new Map(events.map((e) => [e.entityId, e.afterData]));
    for (const order of directOrders) {
      result.set(order.id, classifyOrderAttribution(order, { orderCreateAfterData: eventByOrderId.get(order.id) ?? null }));
    }
  }

  if (quotationSourcedOrders.length > 0) {
    const quotations = await prisma.quotation.findMany({
      where: { convertedOrderId: { in: quotationSourcedOrders.map((o) => o.id) } },
      select: { id: true, convertedOrderId: true },
    });
    const quotationIdByOrderId = new Map(quotations.filter((q) => q.convertedOrderId !== null).map((q) => [q.convertedOrderId as string, q.id]));

    const quotationIds = quotations.map((q) => q.id);
    const quotationEvents =
      quotationIds.length > 0
        ? await prisma.auditEvent.findMany({
            where: { entityType: "Quotation", action: "QUOTATION_CREATED", entityId: { in: quotationIds } },
            select: { entityId: true, afterData: true },
          })
        : [];
    const quotationEventById = new Map(quotationEvents.map((e) => [e.entityId, e.afterData]));

    for (const order of quotationSourcedOrders) {
      const quotationId = quotationIdByOrderId.get(order.id);
      if (!quotationId) {
        // Defensive/unreachable under the schema's own invariants
        // (Quotation.convertedOrderId is @unique and set in the same
        // transaction createOrderCore runs in -- see
        // lib/quotations/convert-to-order.ts): a "QUOTATION"-sourced
        // order with no matching quotation row has no explanation on
        // record, so it is never assumed reliable.
        result.set(order.id, "UNVERIFIED_NO_PROVENANCE");
        continue;
      }
      result.set(order.id, classifyOrderAttribution(order, { orderCreateAfterData: null, quotationCreatedAfterData: quotationEventById.get(quotationId) ?? null }));
    }
  }

  return result;
}

/** Convenience wrapper: classifies every CustomerOrder matching `where`, with the minimal select classifyOrderAttributions needs. Used by lib/reporting/sales-performance.ts and the attribution-breakdown drill-down. */
export async function classifyOrdersMatching(where: Prisma.CustomerOrderWhereInput) {
  const orders = await prisma.customerOrder.findMany({
    where,
    select: { id: true, salespersonId: true, createdById: true, source: true, createdBy: { select: { role: true } } },
  });
  const forAttribution: OrderForAttribution[] = orders.map((o) => ({
    id: o.id,
    salespersonId: o.salespersonId,
    createdById: o.createdById,
    createdByRole: o.createdBy.role,
    source: o.source,
  }));
  const attributionByOrderId = await classifyOrderAttributions(forAttribution);
  return { orders, attributionByOrderId };
}
