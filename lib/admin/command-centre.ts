import "server-only";
import { prisma } from "@/lib/prisma";
import { computeExposureByCurrency } from "@/lib/invoice-claims/financial";
import { getSettingValues } from "./settings-store";
import { previousWindow, resolvePreset, type PresetKey } from "./list-query";
import { countOverdueApprovals, integrationHealth } from "./ops-admin";

/**
 * Command-centre metrics. Every figure is a count or sum over the same tables
 * the operational screens use, and every card carries the href of a filtered
 * list whose row count equals the number shown (checked by tests), so a click
 * always lands on the records behind the number. Money is never summed across
 * currencies: it is reported per currency.
 */
export const OPEN_ORDER_STATUSES = ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] as const;
/** Exposure is computed claim by claim (the figures are derived, not stored), so the dashboard bounds the work. */
export const EXPOSURE_CLAIM_CAP = 500;
const CONCLUDED_CLAIM = ["RESOLVED", "REJECTED", "CLOSED"] as const;

export type Window = { gte: Date; lt: Date };
export type Counted = { value: number; previous: number | null; href: string };

async function inWindow(count: (w: Window) => Promise<number>, w: Window, prev: Window): Promise<{ value: number; previous: number }> {
  const [value, previous] = await Promise.all([count(w), count(prev)]);
  return { value, previous };
}

export async function getCommandCentre(presetRaw: string | undefined, now = new Date()) {
  const settings = await getSettingValues();
  const stuckDays = settings["admin.stuckOrderDays"];
  const stuckBefore = new Date(now.getTime() - stuckDays * 86_400_000);
  const preset = resolvePreset(presetRaw, now);
  const w: Window = { gte: preset.gte, lt: preset.lt };
  const prev = previousWindow(w);
  // `to` is an inclusive day in the list filters, while the window's end is exclusive.
  const q = `from=${w.gte.toISOString().slice(0, 10)}&to=${new Date(w.lt.getTime() - 86_400_000).toISOString().slice(0, 10)}`;
  const open = { in: [...OPEN_ORDER_STATUSES] };
  const openClaim = { notIn: [...CONCLUDED_CLAIM] };

  const [
    ordersCreated, quotationsCreated, claimsCreated, invoicesImported,
    openOrders, unassignedOrders, stuckOrders, awaitingApproval,
    openQuotes, expiringQuotes,
    openClaims, unassignedClaims, unmatchedInvoices, reconRequired,
    activeUsers, mustChange, administrators,
    customersNoManager, customersNoPriceList, productsNoPrice,
    pendingApprovals, overdueApprovals, failedOutbound, failedOps, uncertainOps, failedJobs,
    orderValueByCurrency, exposure, recent, quotationValueByCurrency,
  ] = await Promise.all([
    inWindow((x) => prisma.customerOrder.count({ where: { createdAt: { gte: x.gte, lt: x.lt } } }), w, prev),
    inWindow((x) => prisma.quotation.count({ where: { createdAt: { gte: x.gte, lt: x.lt }, supersededAt: null } }), w, prev),
    inWindow((x) => prisma.invoiceClaim.count({ where: { createdAt: { gte: x.gte, lt: x.lt } } }), w, prev),
    inWindow((x) => prisma.sapInvoice.count({ where: { createdAt: { gte: x.gte, lt: x.lt } } }), w, prev),
    prisma.customerOrder.count({ where: { status: open } }),
    prisma.customerOrder.count({ where: { status: open, salespersonId: null } }),
    prisma.customerOrder.count({ where: { status: open, updatedAt: { lt: stuckBefore } } }),
    prisma.customerOrder.count({ where: { status: "READY_FOR_APPROVAL" } }),
    prisma.quotation.count({ where: { status: { in: ["DRAFT", "ISSUED"] }, supersededAt: null } }),
    prisma.quotation.count({ where: { status: "ISSUED", supersededAt: null, validUntil: { lt: new Date(now.getTime() + 7 * 86_400_000) } } }),
    prisma.invoiceClaim.count({ where: { status: openClaim } }),
    prisma.invoiceClaim.count({ where: { status: openClaim, assignedToId: null } }),
    prisma.sapInvoice.count({ where: { reconciliationStatus: "UNMATCHED" } }),
    prisma.sapInvoice.count({ where: { reconciliationStatus: "RECONCILIATION_REQUIRED" } }),
    prisma.user.count({ where: { status: "ACTIVE" } }),
    prisma.user.count({ where: { status: "ACTIVE", mustChangePassword: true } }),
    prisma.user.count({ where: { status: "ACTIVE", role: "ADMINISTRATOR" } }),
    prisma.customer.count({ where: { status: "ACTIVE", accountManagerId: null } }),
    prisma.customer.count({ where: { status: "ACTIVE", priceListId: null } }),
    prisma.product.count({ where: { status: "ACTIVE", priceListEntries: { none: {} } } }),
    prisma.approvalRequest.count({ where: { status: "PENDING" } }),
    countOverdueApprovals(now),
    prisma.outboundMessage.count({ where: { status: "FAILED" } }),
    prisma.integrationOperation.count({ where: { status: "FAILED" } }),
    prisma.integrationOperation.count({ where: { status: "UNCERTAIN" } }),
    prisma.integrationSyncJob.count({ where: { status: { in: ["FAILED", "PARTIAL"] } } }),
    prisma.customerOrder.groupBy({ by: ["currency"], where: { createdAt: { gte: w.gte, lt: w.lt }, status: { not: "CANCELLED" } }, _sum: { total: true }, _count: { _all: true } }),
    prisma.invoiceClaim.findMany({ where: { status: openClaim }, orderBy: { createdAt: "desc" }, take: EXPOSURE_CLAIM_CAP, select: { id: true } }).then((c) => computeExposureByCurrency(c.map((x) => x.id))),
    prisma.auditEvent.findMany({ orderBy: { createdAt: "desc" }, take: 12, select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, actor: { select: { name: true } } } }),
    prisma.quotation.groupBy({ by: ["currency"], where: { createdAt: { gte: w.gte, lt: w.lt }, supersededAt: null, status: { notIn: ["CANCELLED"] } }, _sum: { total: true } }),
  ]);

  const c = (x: { value: number; previous: number }, href: string): Counted => ({ ...x, href });
  const plain = (value: number, href: string): Counted => ({ value, previous: null, href });

  return {
    preset: preset.key as PresetKey, window: w, previousWindow: prev, stuckDays,
    activity: {
      ordersCreated: c(ordersCreated, `/admin/orders?${q}`),
      quotationsCreated: c(quotationsCreated, `/admin/quotations?${q}`),
      claimsRaised: c(claimsCreated, `/admin/claims?${q}`),
      invoicesImported: c(invoicesImported, `/admin/invoices?${q}`),
    },
    queues: {
      openOrders: plain(openOrders, "/admin/orders?scope=open"),
      awaitingApproval: plain(awaitingApproval, "/admin/orders?status=READY_FOR_APPROVAL"),
      openQuotations: plain(openQuotes, "/admin/quotations?scope=open"),
      openClaims: plain(openClaims, "/admin/claims?scope=open"),
      pendingApprovals: plain(pendingApprovals, "/admin/approvals?status=PENDING"),
    },
    attention: ([
      [unassignedOrders, "open order(s) have no salesperson", "/admin/assignments?type=ORDER&scope=unassigned", "warn"],
      [stuckOrders, `open order(s) idle for ${stuckDays}+ days`, "/admin/orders?scope=stuck", "warn"],
      [expiringQuotes, "issued quotation(s) expire within 7 days or have lapsed", "/admin/quotations?scope=expiring", "warn"],
      [unassignedClaims, "open claim(s) have no owner", "/admin/claims?scope=unassigned", "warn"],
      [unmatchedInvoices, "SAP invoice(s) are unmatched", "/admin/invoices?status=UNMATCHED", "warn"],
      [reconRequired, "SAP invoice(s) need reconciliation", "/admin/invoices?status=RECONCILIATION_REQUIRED", "warn"],
      [overdueApprovals, "approval(s) are past their policy's overdue window", "/admin/approvals?status=PENDING", "danger"],
      [failedOps + uncertainOps, "SAP operation(s) failed or are uncertain", "/admin/integrations", "danger"],
      [failedJobs, "SAP sync job(s) failed or partially completed", "/admin/integrations", "danger"],
      [failedOutbound, "outbound message(s) failed to send", "/admin/communications?tab=outbound&status=FAILED", "danger"],
      [customersNoManager, "active customer(s) have no account manager", "/admin/customers?scope=unassigned", "warn"],
      [customersNoPriceList, "active customer(s) have no price list", "/admin/customers?scope=no-price-list", "warn"],
      [productsNoPrice, "active product(s) appear on no price list", "/admin/products?scope=unpriced", "warn"],
      [mustChange, "active user(s) still have a temporary password", "/admin/users?mustChange=1", "warn"],
      [administrators < 2 ? 1 : 0, `only ${administrators} active administrator — add a second for continuity`, "/admin/users?role=ADMINISTRATOR", "warn"],
    ] as const).filter(([n]) => n > 0).map(([count, text, href, tone]) => ({ count, text, href, tone })),
    money: {
      ordersByCurrency: orderValueByCurrency.map((r) => ({ currency: r.currency, total: (r._sum.total ?? 0).toString(), count: r._count._all })),
      quotedByCurrency: quotationValueByCurrency.map((r) => ({ currency: r.currency, total: (r._sum.total ?? 0).toString() })),
      claimExposure: exposure,
    },
    system: { activeUsers, administrators, integrations: await integrationHealth() },
    recent,
  };
}
