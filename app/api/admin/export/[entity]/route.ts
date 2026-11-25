import { NextRequest } from "next/server";
import { adminRead } from "@/lib/admin/route";
import { prisma } from "@/lib/prisma";
import { toCsv } from "@/lib/admin/csv";
import { parseDateRange } from "@/lib/admin/list-query";
import { listAdminOrders } from "@/lib/admin/order-admin";
import { listAdminQuotations } from "@/lib/admin/quotation-admin";
import { listAdminClaims, listAdminCreditNotes, listAdminInvoices, listAdminReturns } from "@/lib/admin/finance-admin";
import { listAdminDispatches, listAdminApprovals } from "@/lib/admin/ops-admin";

const MAX_ROWS = 10000;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : "");
type Sp = URLSearchParams;
type Dataset = { header: string[]; rows: unknown[][] };

/** Whitelist of exportable datasets. Each export reuses the same list service (and therefore the same filters) as its screen, so a CSV always matches what is on screen. */
const EXPORTS: Record<string, (sp: Sp) => Promise<Dataset>> = {
  orders: async (sp) => {
    const r = await listAdminOrders({ q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, ...dates(sp) }, 1, MAX_ROWS);
    return { header: ["reference", "customer", "status", "source", "salesperson", "currency", "total", "lines", "created"], rows: r.rows.map((o) => [o.reference, o.customer.name, o.status, o.source, o.salesperson?.name ?? "", o.currency, o.total ?? "", o.lineCount, iso(o.createdAt)]) };
  },
  quotations: async (sp) => {
    const r = await listAdminQuotations({ q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, ...dates(sp) }, 1, MAX_ROWS);
    return { header: ["quotation", "revision", "customer", "status", "salesperson", "currency", "total", "validUntil", "created"], rows: r.rows.map((x) => [x.quotationNumber, x.revisionNumber, x.customer.name, x.status, x.salesperson.name, x.currency, x.total, iso(x.validUntil), iso(x.createdAt)]) };
  },
  invoices: async (sp) => {
    const r = await listAdminInvoices({ q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, ...dates(sp) }, 1, MAX_ROWS);
    return { header: ["sapDocNum", "customer", "customerSapCode", "invoiceDate", "currency", "total", "reconciliation", "unmatchedLines", "claims"], rows: r.rows.map((i) => [i.sapDocNum, i.customerName, i.customerSapCode, iso(i.invoiceDate), i.currencyCode, i.total ?? "", i.reconciliationStatus, i.unmatchedLines, i.claimCount]) };
  },
  claims: async (sp) => {
    const r = await listAdminClaims({ q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, ...dates(sp) }, 1, MAX_ROWS);
    return { header: ["claimReference", "customer", "invoice", "status", "priority", "category", "owner", "claimDate"], rows: r.rows.map((c) => [c.claimReference, c.customer.name, c.sapInvoice?.sapDocNum ?? "", c.status, c.priority, c.category, c.assignedTo?.name ?? "", iso(c.claimDate)]) };
  },
  "credit-notes": async (sp) => {
    const r = await listAdminCreditNotes({ q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, ...dates(sp) }, 1, MAX_ROWS);
    return { header: ["creditNote", "invoice", "claim", "currency", "amount", "matchStatus", "date"], rows: r.rows.map((c) => [c.sapCreditNoteDocNum, c.sapInvoice?.sapDocNum ?? "", c.claim?.claimReference ?? "", c.currencyCode, c.amount, c.matchStatus, iso(c.creditNoteDate)]) };
  },
  returns: async (sp) => {
    const r = await listAdminReturns({ q: sp.get("q") ?? undefined, condition: sp.get("condition") ?? undefined, ...dates(sp) }, 1, MAX_ROWS);
    return { header: ["returnReference", "claim", "customer", "item", "quantity", "condition", "received"], rows: r.rows.map((x) => [x.returnReference, x.claim.claimReference, x.claim.customer.name, x.claimLine?.sapItemCodeSnapshot ?? "", x.receivedQuantity, x.condition, iso(x.receivedDate)]) };
  },
  approvals: async (sp) => {
    const r = await listAdminApprovals({ q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, module: sp.get("module") ?? undefined, ...dates(sp) }, 1, MAX_ROWS);
    return { header: ["module", "action", "subject", "status", "requestedBy", "decidedBy", "submitted", "decided"], rows: r.rows.map((a) => [a.module, a.actionType, a.quotation?.quotationNumber ?? a.customerOrder?.reference ?? "", a.status, a.requestedBy?.name ?? "", a.decidedBy?.name ?? "", iso(a.submittedAt), iso(a.decidedAt)]) };
  },
  dispatches: async (sp) => {
    const r = await listAdminDispatches({ q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, ...dates(sp) }, 1, MAX_ROWS);
    return { header: ["order", "customer", "status", "driver", "vehicle", "departed", "outcome"], rows: r.rows.map((d) => [d.order.reference, d.order.customer.name, d.status, d.driver?.name ?? "", d.vehicle?.registrationNumber ?? "", iso(d.departedAt), d.deliveryRecord?.outcome ?? ""]) };
  },
  "price-lists": async () => {
    const lists = await prisma.priceList.findMany({ orderBy: { code: "asc" }, select: { code: true, name: true, currencyCode: true, status: true, _count: { select: { entries: true, customers: true } } } });
    return { header: ["code", "name", "currency", "status", "entries", "customers"], rows: lists.map((l) => [l.code, l.name, l.currencyCode, l.status, l._count.entries, l._count.customers]) };
  },
};

function dates(sp: Sp) {
  const r = parseDateRange(sp.get("from") ?? undefined, sp.get("to") ?? undefined);
  return { from: r.gte, to: r.lt };
}

/** GET /api/admin/export/[entity] -- audited CSV export of an allow-listed dataset, honouring the current screen filters. */
export async function GET(request: NextRequest, context: { params: Promise<{ entity: string }> }) {
  return adminRead(async (actor) => {
    const { entity } = await context.params;
    const build = Object.hasOwn(EXPORTS, entity) ? EXPORTS[entity] : undefined;
    if (!build) return Response.json({ success: false, message: "Unknown export." }, { status: 404 });
    const data = await build(request.nextUrl.searchParams);
    await prisma.auditEvent.create({ data: { actorId: actor.id, action: "DATA_EXPORT", entityType: entity, entityId: "export", afterData: { rows: data.rows.length, filters: Object.fromEntries(request.nextUrl.searchParams) } } });
    return new Response(toCsv(data.header, data.rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${entity}.csv"`, "Cache-Control": "no-store" } });
  });
}
