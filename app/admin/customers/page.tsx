import Link from "next/link";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { customerFilterOptions, CUSTOMER_SORTS, listAdminCustomers } from "@/lib/admin/customer-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { userOptions } from "../_components/status-badge";
import { ActionDialog, type DialogField } from "../_components/action-dialog";

type Row = Awaited<ReturnType<typeof listAdminCustomers>>["rows"][number];

const customerFields: DialogField[] = [
  { name: "name", label: "Customer name", type: "text", required: true },
  { name: "sapCustomerCode", label: "SAP customer code", type: "text" },
  { name: "email", label: "Email", type: "text" },
  { name: "phone", label: "Phone", type: "text" },
  { name: "category", label: "Category", type: "text" },
  { name: "notes", label: "Notes", type: "textarea" },
];

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status", "manager", "scope", "category", "priceList"], sortKeys: Object.keys(CUSTOMER_SORTS), fallbackSort: { key: "name", dir: "asc" } });
  const scope = list.get("scope");
  const [{ total, rows }, assignees, options] = await Promise.all([
    listAdminCustomers({ q: list.q, status: scope === "unassigned" || scope === "no-price-list" ? "ACTIVE" : list.get("status"), managerId: list.get("manager"), unassigned: scope === "unassigned", noPriceList: scope === "no-price-list", priceListId: list.get("priceList"), category: list.get("category"), creditHold: scope === "credit-hold" }, list.page, list.pageSize, list.sort),
    listActiveAssignees(), customerFilterOptions(),
  ]);
  const columns: Column<Row>[] = [
    { key: "name", header: "Customer", sortKey: "name", render: (c) => <div><Link href={`/admin/customers/${c.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{c.name}</Link><div className="text-xs text-[#849087]">{c.sapCustomerCode ?? "No SAP code"}</div></div> },
    { key: "status", header: "Status", sortKey: "status", render: (c) => <StatusBadge status={c.status} /> },
    { key: "manager", header: "Account manager", sortKey: "manager", hideBelow: "md", render: (c) => c.accountManager?.name ?? <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Unassigned</span> },
    { key: "priceList", header: "Price list", hideBelow: "lg", render: (c) => (c.priceList ? <Link href={`/admin/price-lists/${c.priceList.id}`} className="hover:underline">{c.priceList.code}</Link> : <span className="text-[#849087]">None</span>) },
    { key: "category", header: "Category", hideBelow: "lg", defaultHidden: true, render: (c) => c.category ?? "—" },
    { key: "contact", header: "Contact", hideBelow: "xl", defaultHidden: true, render: (c) => c.email ?? c.phone ?? "—" },
    { key: "orders", header: "Orders", align: "right", hideBelow: "md", render: (c) => c._count.orders },
    { key: "quotations", header: "Quotes", align: "right", hideBelow: "xl", render: (c) => c._count.quotations },
    { key: "invoices", header: "Invoices", align: "right", hideBelow: "xl", render: (c) => c._count.sapInvoices },
    { key: "claims", header: "Claims", align: "right", hideBelow: "xl", render: (c) => c._count.invoiceClaims },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Customers" description="Customer master, account ownership and price-list assignment. Customers with history are deactivated, never deleted; a customer that has never been used can be deleted from its page." actions={<><ActionDialog label="Add customer" variant="primary" title="Add customer" description="Contacts, locations and the price list are added on the customer page afterwards." endpoint="/api/customers" askReason={false} blank="omit" confirmLabel="Create customer" successHref="/admin/customers/{id}" fields={customerFields} /><Link href="/customers/master-import" className="rounded-lg border border-[#DDE3DC] bg-white px-3 py-2 text-sm font-semibold hover:bg-[#F7F8F6]">Import customers</Link></>} />
      <TableToolbar tableId="admin-customers" searchPlaceholder="Name, SAP code, email or TIN" exportHref="/api/admin/customers/export"
        filters={[
          { name: "status", label: "Status", options: opts(["ACTIVE", "INACTIVE"]) },
          { name: "manager", label: "Account manager", options: assignees.map((a) => ({ value: a.id, label: a.name })) },
          { name: "priceList", label: "Price list", options: options.priceLists.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` })) },
          ...(options.categories.length ? [{ name: "category", label: "Category", options: options.categories.map((c) => ({ value: c, label: c })) }] : []),
        ]}
        columns={columns.map((c) => ({ key: c.key, label: c.header, defaultHidden: c.defaultHidden }))} />
      {scope ? <p className="text-xs text-[#5E6B63]">Showing: <strong>{scope === "unassigned" ? "active customers without an account manager" : scope === "no-price-list" ? "active customers without a price list" : "customers on credit hold"}</strong> · <Link href="/admin/customers" className="font-semibold text-[#1F7A4D]">clear</Link></p> : null}
      <DataTable id="admin-customers" columns={columns} rows={rows} rowId={(c) => c.id} rowLabel={(c) => c.name} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/customers" params={list.params} sort={list.sort}
        rowActions={(c) => <Link href={`/admin/customers/${c.id}`} className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold hover:bg-[#F7F8F6]">Manage</Link>}
        bulkActions={[{ label: "Assign account manager", endpoint: "/api/admin/assignments/reassign", payload: { entityType: "CUSTOMER" }, choice: { name: "toUserId", label: "Account manager", options: userOptions(assignees) }, preview: true }]} />
    </div>
  );
}
