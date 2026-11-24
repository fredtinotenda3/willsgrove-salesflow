import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReassignEntityType } from "./validation";

export type AssignmentScope = "unassigned" | "stuck" | "all-open";
export type AssignmentRow = { id: string; label: string; detail: string; owner: { id: string; name: string } | null; status: string; updatedAt: Date; ageDays: number; href: string };

const OPEN_ORDER = ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] as const;
const OPEN_CLAIM = { notIn: ["RESOLVED", "REJECTED", "CLOSED"] } as const;

export type AssignmentQuery = { type: ReassignEntityType; scope: AssignmentScope; ownerId?: string; q?: string; stuckDays: number; page: number; pageSize: number };

/** Open, reassignable work of one kind. Server-side filtered and paginated. */
export async function listAssignableWork(query: AssignmentQuery): Promise<{ total: number; rows: AssignmentRow[] }> {
  const stuckBefore = new Date(Date.now() - query.stuckDays * 24 * 60 * 60 * 1000);
  const skip = (query.page - 1) * query.pageSize;
  const take = query.pageSize;
  const orderBy = { updatedAt: "asc" } as const;
  const q = query.q?.trim();
  const now = Date.now();
  const age = (d: Date) => Math.max(0, Math.floor((now - d.getTime()) / 86400000));

  if (query.type === "ORDER") {
    const where: Prisma.CustomerOrderWhereInput = {
      status: { in: [...OPEN_ORDER] },
      ...(query.scope === "unassigned" ? { salespersonId: null } : {}),
      ...(query.scope === "stuck" ? { updatedAt: { lt: stuckBefore } } : {}),
      ...(query.ownerId ? { salespersonId: query.ownerId } : {}),
      ...(q ? { OR: [{ reference: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.customerOrder.count({ where }),
      prisma.customerOrder.findMany({ where, orderBy, skip, take, select: { id: true, reference: true, status: true, updatedAt: true, customer: { select: { name: true } }, salesperson: { select: { id: true, name: true } } } }),
    ]);
    return { total, rows: rows.map((r) => ({ id: r.id, label: r.reference, detail: r.customer.name, owner: r.salesperson, status: r.status, updatedAt: r.updatedAt, ageDays: age(r.updatedAt), href: `/orders/${r.id}` })) };
  }
  if (query.type === "QUOTATION") {
    const where: Prisma.QuotationWhereInput = {
      status: { in: ["DRAFT", "ISSUED"] },
      convertedOrderId: null,
      supersededAt: null,
      ...(query.scope === "stuck" ? { updatedAt: { lt: stuckBefore } } : {}),
      ...(query.ownerId ? { salespersonId: query.ownerId } : {}),
      ...(q ? { OR: [{ quotationNumber: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.quotation.count({ where }),
      prisma.quotation.findMany({ where, orderBy, skip, take, select: { id: true, quotationNumber: true, revisionNumber: true, status: true, updatedAt: true, customer: { select: { name: true } }, salesperson: { select: { id: true, name: true } } } }),
    ]);
    return { total, rows: rows.map((r) => ({ id: r.id, label: `${r.quotationNumber} r${r.revisionNumber}`, detail: r.customer.name, owner: r.salesperson, status: r.status, updatedAt: r.updatedAt, ageDays: age(r.updatedAt), href: `/quotations/${r.id}` })) };
  }
  if (query.type === "CUSTOMER") {
    const where: Prisma.CustomerWhereInput = {
      status: "ACTIVE",
      ...(query.scope === "unassigned" ? { accountManagerId: null } : {}),
      ...(query.ownerId ? { accountManagerId: query.ownerId } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sapCustomerCode: { contains: q, mode: "insensitive" } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.customer.count({ where }),
      prisma.customer.findMany({ where, orderBy: { name: "asc" }, skip, take, select: { id: true, name: true, sapCustomerCode: true, status: true, updatedAt: true, accountManager: { select: { id: true, name: true } } } }),
    ]);
    return { total, rows: rows.map((r) => ({ id: r.id, label: r.name, detail: r.sapCustomerCode ?? "No SAP code", owner: r.accountManager, status: r.status, updatedAt: r.updatedAt, ageDays: age(r.updatedAt), href: `/customers/${r.id}` })) };
  }
  if (query.type === "CLAIM") {
    const where: Prisma.InvoiceClaimWhereInput = {
      status: OPEN_CLAIM as never,
      ...(query.scope === "unassigned" ? { assignedToId: null } : {}),
      ...(query.scope === "stuck" ? { updatedAt: { lt: stuckBefore } } : {}),
      ...(query.ownerId ? { assignedToId: query.ownerId } : {}),
      ...(q ? { OR: [{ claimReference: { contains: q, mode: "insensitive" } }, { customer: { name: { contains: q, mode: "insensitive" } } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.invoiceClaim.count({ where }),
      prisma.invoiceClaim.findMany({ where, orderBy, skip, take, select: { id: true, claimReference: true, status: true, updatedAt: true, customer: { select: { name: true } }, assignedTo: { select: { id: true, name: true } } } }),
    ]);
    return { total, rows: rows.map((r) => ({ id: r.id, label: r.claimReference, detail: r.customer.name, owner: r.assignedTo, status: r.status, updatedAt: r.updatedAt, ageDays: age(r.updatedAt), href: `/invoice-claims/${r.id}` })) };
  }
  const where: Prisma.ManagementActionWhereInput = {
    status: { notIn: ["COMPLETED", "DISMISSED"] },
    ...(query.scope === "unassigned" ? { assignedToId: null } : {}),
    ...(query.scope === "stuck" ? { updatedAt: { lt: stuckBefore } } : {}),
    ...(query.ownerId ? { assignedToId: query.ownerId } : {}),
    ...(q ? { title: { contains: q, mode: "insensitive" } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.managementAction.count({ where }),
    prisma.managementAction.findMany({ where, orderBy, skip, take, select: { id: true, title: true, status: true, updatedAt: true, assignedTo: { select: { id: true, name: true } } } }),
  ]);
  return { total, rows: rows.map((r) => ({ id: r.id, label: r.title, detail: "Management action", owner: r.assignedTo, status: r.status, updatedAt: r.updatedAt, ageDays: age(r.updatedAt), href: "/reports/management/actions" })) };
}

export async function listActiveAssignees() {
  return prisma.user.findMany({ where: { status: "ACTIVE" }, orderBy: { name: "asc" }, select: { id: true, name: true, role: true, department: true } });
}
