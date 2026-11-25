/**
 * Administration navigation: ONE declarative source for the sidebar, the
 * breadcrumb trail and the global-search jump targets. Pure data + pure
 * functions (no React, no Prisma) so it is unit-tested and importable from
 * both server and client components.
 *
 * Every href below is a real page under app/admin. Adding an entry here
 * without its page would produce a dead link, which tests/admin-nav.test.ts
 * guards against by resolving each href to a page file on disk.
 */

export type AdminIconKey =
  | "dashboard" | "orders" | "quotations" | "customers" | "assignments" | "approvals"
  | "invoices" | "claims" | "credit" | "returns" | "products" | "pricing" | "stock"
  | "deliveries" | "fleet" | "integrations" | "communications" | "reports"
  | "users" | "configuration" | "audit" | "data";

export type AdminNavItem = { href: string; label: string; icon: AdminIconKey; description: string };
export type AdminNavGroup = { id: string; label: string; items: AdminNavItem[] };

export const ADMIN_NAV: AdminNavGroup[] = [
  { id: "overview", label: "Overview", items: [
    { href: "/admin", label: "Command centre", icon: "dashboard", description: "Live position of the whole business and what needs action." },
  ] },
  { id: "sales", label: "Sales & orders", items: [
    { href: "/admin/orders", label: "Orders", icon: "orders", description: "Every order: details, lines, documents, approvals, delivery." },
    { href: "/admin/quotations", label: "Quotations", icon: "quotations", description: "Quotations, revisions, events and converted orders." },
    { href: "/admin/customers", label: "Customers", icon: "customers", description: "Customer master, contacts, locations and account managers." },
    { href: "/admin/assignments", label: "Assignments", icon: "assignments", description: "Workload, unassigned and stuck work, bulk reassignment." },
    { href: "/admin/approvals", label: "Approvals", icon: "approvals", description: "Approval requests, thresholds and policies." },
  ] },
  { id: "finance", label: "Finance & claims", items: [
    { href: "/admin/invoices", label: "SAP invoices", icon: "invoices", description: "Imported SAP invoices, reconciliation and import batches." },
    { href: "/admin/claims", label: "Invoice claims", icon: "claims", description: "Claims, investigations, resolutions and exposure." },
    { href: "/admin/credit-notes", label: "Credit notes", icon: "credit", description: "Credit notes and their match to invoices and claims." },
    { href: "/admin/returns", label: "Returns", icon: "returns", description: "Goods returned against claims." },
  ] },
  { id: "catalogue", label: "Catalogue & pricing", items: [
    { href: "/admin/products", label: "Products", icon: "products", description: "SAP item master, barcodes, aliases and status." },
    { href: "/admin/price-lists", label: "Price lists", icon: "pricing", description: "Price lists, entries, validity and conflicts." },
    { href: "/admin/stock", label: "Stock snapshots", icon: "stock", description: "Imported stock snapshots (not live inventory)." },
  ] },
  { id: "logistics", label: "Logistics", items: [
    { href: "/admin/deliveries", label: "Dispatch & delivery", icon: "deliveries", description: "Dispatch records, delivery outcomes and exceptions." },
    { href: "/admin/fleet", label: "Drivers & vehicles", icon: "fleet", description: "Personnel and vehicle registers." },
  ] },
  { id: "integrations", label: "Integrations", items: [
    { href: "/admin/integrations", label: "SAP integration", icon: "integrations", description: "Connection health, sync jobs and failed operations." },
    { href: "/admin/communications", label: "Communications", icon: "communications", description: "Message intake and outbound message delivery." },
  ] },
  { id: "intelligence", label: "Intelligence", items: [
    { href: "/admin/reports", label: "Reports", icon: "reports", description: "Entry points to the existing reports and management actions." },
  ] },
  { id: "system", label: "System", items: [
    { href: "/admin/users", label: "Users & access", icon: "users", description: "Accounts, roles, sessions and workload." },
    { href: "/admin/configuration", label: "Configuration", icon: "configuration", description: "Business thresholds with defaults and audit." },
    { href: "/admin/audit", label: "Audit log", icon: "audit", description: "Immutable record of administrative changes." },
    { href: "/admin/data", label: "Data management", icon: "data", description: "Imports, exports, data quality and demo data." },
  ] },
];

export const ALL_ADMIN_ITEMS: AdminNavItem[] = ADMIN_NAV.flatMap((g) => g.items);

/** The nav item that owns a pathname: the longest matching href ("/admin" only matches exactly). */
export function matchNavItem(pathname: string): AdminNavItem | null {
  const clean = pathname.replace(/\/+$/, "") || "/";
  let best: AdminNavItem | null = null;
  for (const item of ALL_ADMIN_ITEMS) {
    const hit = item.href === "/admin" ? clean === "/admin" : clean === item.href || clean.startsWith(`${item.href}/`);
    if (hit && (!best || item.href.length > best.href.length)) best = item;
  }
  return best;
}

export function groupOf(item: AdminNavItem | null): AdminNavGroup | null {
  return item ? ADMIN_NAV.find((g) => g.items.includes(item)) ?? null : null;
}

export type Crumb = { label: string; href?: string };

const SUB_LABELS: Record<string, string> = { imports: "Import batches", new: "New", print: "Print" };

/** Administration > Section > (Subpage | Record). The last crumb is never a link. */
export function breadcrumbsFor(pathname: string): Crumb[] {
  const crumbs: Crumb[] = [{ label: "Administration", href: "/admin" }];
  const item = matchNavItem(pathname);
  if (!item || item.href === "/admin") return item ? [{ label: "Administration" }, { label: item.label }] : [{ label: "Administration" }];
  crumbs.push({ label: item.label, href: item.href });
  const rest = pathname.replace(/\/+$/, "").slice(item.href.length).split("/").filter(Boolean);
  rest.forEach((segment, i) => crumbs.push({ label: SUB_LABELS[segment] ?? (i === 0 ? "Record" : "Details") }));
  const last = crumbs[crumbs.length - 1];
  if (crumbs.length > 1) crumbs[crumbs.length - 1] = { label: last.label };
  return crumbs;
}

/** True when the item or one of its sub-pages is the current page (drives the active style and group expansion). */
export function isActiveItem(item: AdminNavItem, pathname: string): boolean {
  return matchNavItem(pathname)?.href === item.href;
}
