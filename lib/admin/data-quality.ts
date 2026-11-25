import "server-only";
import { prisma } from "@/lib/prisma";

/**
 * Data-quality and demo-data counts for the data-management page. Read-only:
 * every figure links to the list that shows the affected records. Demo data is
 * removed with the existing, reviewed CLI script (`npm run db:remove-demo`),
 * never from the browser: there is deliberately no reset or wipe in the UI.
 */
export async function getDataQuality() {
  const [productsNoBarcode, productsUnpriced, customersNoManager, customersNoPriceList, ordersNoSalesperson, invoicesUnmatched, invoicesRecon, claimsUnassigned, pricesExpiredOpen, usersMustChange, inactiveWithOpenOrders] = await Promise.all([
    prisma.product.count({ where: { status: "ACTIVE", OR: [{ barcode: null }, { barcode: "" }] } }),
    prisma.product.count({ where: { status: "ACTIVE", priceListEntries: { none: {} } } }),
    prisma.customer.count({ where: { status: "ACTIVE", accountManagerId: null } }),
    prisma.customer.count({ where: { status: "ACTIVE", priceListId: null } }),
    prisma.customerOrder.count({ where: { status: { in: ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] }, salespersonId: null } }),
    prisma.sapInvoice.count({ where: { reconciliationStatus: "UNMATCHED" } }),
    prisma.sapInvoice.count({ where: { reconciliationStatus: "RECONCILIATION_REQUIRED" } }),
    prisma.invoiceClaim.count({ where: { assignedToId: null, status: { notIn: ["RESOLVED", "REJECTED", "CLOSED"] } } }),
    prisma.priceListEntry.count({ where: { validTo: { lt: new Date() }, priceList: { status: "ACTIVE" } } }),
    prisma.user.count({ where: { status: "ACTIVE", mustChangePassword: true } }),
    prisma.customerOrder.count({ where: { status: { in: ["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED", "PICKING"] }, salesperson: { status: "INACTIVE" } } }),
  ]);
  return [
    { label: "Active products without a barcode", count: productsNoBarcode, href: "/admin/products?scope=no-barcode" },
    { label: "Active products on no price list", count: productsUnpriced, href: "/admin/products?scope=unpriced" },
    { label: "Active customers without an account manager", count: customersNoManager, href: "/admin/customers?scope=unassigned" },
    { label: "Active customers without a price list", count: customersNoPriceList, href: "/admin/customers?scope=no-price-list" },
    { label: "Open orders without a salesperson", count: ordersNoSalesperson, href: "/admin/orders?scope=unassigned" },
    { label: "Open orders held by an inactive salesperson", count: inactiveWithOpenOrders, href: "/admin/assignments?type=ORDER" },
    { label: "SAP invoices that are unmatched", count: invoicesUnmatched, href: "/admin/invoices?status=UNMATCHED" },
    { label: "SAP invoices needing reconciliation", count: invoicesRecon, href: "/admin/invoices?status=RECONCILIATION_REQUIRED" },
    { label: "Open claims without an owner", count: claimsUnassigned, href: "/admin/claims?scope=unassigned" },
    { label: "Expired price entries on active price lists", count: pricesExpiredOpen, href: "/admin/price-lists" },
    { label: "Active users with a temporary password", count: usersMustChange, href: "/admin/users" },
  ];
}

/** Rows flagged isDemo, per entity. Counts only; nothing is changed here. */
export async function getDemoCounts() {
  const [users, customers, products, orders, quotations, invoices, priceLists] = await Promise.all([
    prisma.user.count({ where: { isDemo: true } }), prisma.customer.count({ where: { isDemo: true } }), prisma.product.count({ where: { isDemo: true } }),
    prisma.customerOrder.count({ where: { isDemo: true } }), prisma.quotation.count({ where: { isDemo: true } }), prisma.sapInvoice.count({ where: { isDemo: true } }), prisma.priceList.count({ where: { isDemo: true } }),
  ]);
  const rows = [{ label: "Users", count: users }, { label: "Customers", count: customers }, { label: "Products", count: products }, { label: "Orders", count: orders }, { label: "Quotations", count: quotations }, { label: "SAP invoices", count: invoices }, { label: "Price lists", count: priceLists }];
  return { rows, total: rows.reduce((s, r) => s + r.count, 0) };
}
