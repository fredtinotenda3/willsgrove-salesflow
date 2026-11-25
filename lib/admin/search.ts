import "server-only";
import { prisma } from "@/lib/prisma";

export type SearchHit = { type: string; label: string; sub: string; href: string };
const LIMIT = 5;

/** Cross-entity lookup used by the admin header search. Every hit comes from the shared tables; nothing is indexed separately. */
export async function adminSearch(raw: string): Promise<SearchHit[]> {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return [];
  const ci = { contains: q, mode: "insensitive" as const };
  const [orders, customers, products, users, quotations, claims, invoices] = await Promise.all([
    prisma.customerOrder.findMany({ where: { OR: [{ reference: ci }, { customerPoReference: ci }] }, take: LIMIT, orderBy: { createdAt: "desc" }, select: { id: true, reference: true, status: true, customer: { select: { name: true } } } }),
    prisma.customer.findMany({ where: { OR: [{ name: ci }, { sapCustomerCode: ci }] }, take: LIMIT, orderBy: { name: "asc" }, select: { id: true, name: true, sapCustomerCode: true } }),
    prisma.product.findMany({ where: { OR: [{ sapItemCode: ci }, { itemName: ci }, { barcode: ci }] }, take: LIMIT, orderBy: { sapItemCode: "asc" }, select: { id: true, sapItemCode: true, itemName: true } }),
    prisma.user.findMany({ where: { OR: [{ name: ci }, { email: ci }] }, take: LIMIT, orderBy: { name: "asc" }, select: { id: true, name: true, email: true } }),
    prisma.quotation.findMany({ where: { quotationNumber: ci }, take: LIMIT, orderBy: { createdAt: "desc" }, select: { id: true, quotationNumber: true, status: true, customer: { select: { name: true } } } }),
    prisma.invoiceClaim.findMany({ where: { claimReference: ci }, take: LIMIT, orderBy: { createdAt: "desc" }, select: { id: true, claimReference: true, status: true, customer: { select: { name: true } } } }),
    prisma.sapInvoice.findMany({ where: { OR: [{ sapDocNum: ci }, { customerName: ci }] }, take: LIMIT, orderBy: { createdAt: "desc" }, select: { id: true, sapDocNum: true, customerName: true } }),
  ]);
  return [
    ...orders.map((o) => ({ type: "Order", label: o.reference, sub: `${o.customer.name} · ${o.status.replace(/_/g, " ")}`, href: `/admin/orders/${o.id}` })),
    ...customers.map((c) => ({ type: "Customer", label: c.name, sub: c.sapCustomerCode ?? "No SAP code", href: `/admin/customers/${c.id}` })),
    ...products.map((p) => ({ type: "Product", label: p.sapItemCode, sub: p.itemName, href: `/admin/products/${p.id}` })),
    ...quotations.map((x) => ({ type: "Quotation", label: x.quotationNumber, sub: `${x.customer.name} · ${x.status}`, href: `/admin/quotations/${x.id}` })),
    ...claims.map((x) => ({ type: "Claim", label: x.claimReference, sub: `${x.customer.name} · ${x.status.replace(/_/g, " ")}`, href: `/admin/claims/${x.id}` })),
    ...invoices.map((x) => ({ type: "Invoice", label: x.sapDocNum, sub: x.customerName ?? "", href: `/admin/invoices/${x.id}` })),
    ...users.map((u) => ({ type: "User", label: u.name, sub: u.email, href: `/admin/users/${u.id}` })),
  ];
}
