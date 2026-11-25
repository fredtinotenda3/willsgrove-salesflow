import Link from "next/link";
import { listAdminOrders, ORDER_SORTS, ORDER_STATUSES } from "@/lib/admin/order-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { getSettingValues } from "@/lib/admin/settings-store";
import { fmtDate, fmtMoney } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { ActionDialog } from "../_components/action-dialog";
import { StatusBadge, userOptions } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { daysFromNow } from "@/lib/admin/list-query";
import { DateRangeFilter, opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
const CANCELLABLE = new Set(["DRAFT", "RECEIVED", "PENDING_VERIFICATION", "READY_FOR_APPROVAL", "APPROVED"]);
const REASSIGNABLE = new Set([...CANCELLABLE, "PICKING"]);

type Row = Awaited<ReturnType<typeof listAdminOrders>>["rows"][number];

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status", "owner", "scope", "source"], sortKeys: Object.keys(ORDER_SORTS), fallbackSort: { key: "created", dir: "desc" } });
  const scope = list.get("scope");
  const owner = list.get("owner");
  const settings = await getSettingValues();
  const stuckBefore = daysFromNow(-settings["admin.stuckOrderDays"]);
  const status = scope === "open" || scope === "stuck" ? "open" : list.get("status");
  const [{ total, rows }, assignees] = await Promise.all([
    listAdminOrders({ q: list.q, status, salespersonId: owner && owner !== "none" ? owner : undefined, unassigned: owner === "none" || scope === "unassigned", from: list.from, to: list.to, staleBefore: scope === "stuck" ? stuckBefore : undefined, source: list.get("source") }, list.page, list.pageSize, list.sort),
    listActiveAssignees(),
  ]);

  const columns: Column<Row>[] = [
    { key: "reference", header: "Reference", sortKey: "reference", render: (o) => <div><Link href={`/admin/orders/${o.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{o.reference}</Link>{o.customerPoReference ? <div className="text-xs text-[#849087]">PO {o.customerPoReference}</div> : null}</div> },
    { key: "customer", header: "Customer", sortKey: "customer", render: (o) => <Link href={`/admin/customers/${o.customer.id}`} className="hover:underline">{o.customer.name}</Link> },
    { key: "status", header: "Status", sortKey: "status", render: (o) => <StatusBadge status={o.status} /> },
    { key: "salesperson", header: "Salesperson", sortKey: "salesperson", hideBelow: "md", render: (o) => o.salesperson?.name ?? <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Unassigned</span> },
    { key: "source", header: "Source", hideBelow: "lg", defaultHidden: true, render: (o) => o.source.replace(/_/g, " ").toLowerCase() },
    { key: "lines", header: "Lines", align: "right", hideBelow: "lg", render: (o) => o.lineCount },
    { key: "total", header: "Total", sortKey: "total", align: "right", render: (o) => (o.total === null ? "—" : fmtMoney(o.currency, o.total)) },
    { key: "created", header: "Created", sortKey: "created", hideBelow: "md", render: (o) => fmtDate(o.createdAt) },
    { key: "updated", header: "Updated", sortKey: "updated", hideBelow: "xl", defaultHidden: true, render: (o) => fmtDate(o.updatedAt) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title="Orders" description="Find, correct, reassign, cancel, reopen and — for unreferenced drafts only — delete orders. The server refuses changes once an order is picking, handed to SAP or invoiced." actions={<Link href="/orders/new" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">New order</Link>} />
      <TableToolbar tableId="admin-orders" searchPlaceholder="Reference, PO or customer" exportHref={`/api/admin/export/orders?${new URLSearchParams(list.params)}`}
        filters={[
          { name: "status", label: "Status", options: opts(ORDER_STATUSES) },
          { name: "owner", label: "Salesperson", options: [{ value: "none", label: "Unassigned" }, ...assignees.map((a) => ({ value: a.id, label: a.name }))] },
          { name: "source", label: "Source", options: opts(["EMAIL", "WHATSAPP", "MANUAL", "PDF", "IMAGE", "EXCEL", "CSV"]) },
        ]}
        columns={columns.map((c) => ({ key: c.key, label: c.header, defaultHidden: c.defaultHidden }))}>
        <DateRangeFilter action="/admin/orders" params={list.params} />
      </TableToolbar>
      {scope ? <p className="text-xs text-[#5E6B63]">Showing: <strong>{scope === "stuck" ? `open orders idle for ${settings["admin.stuckOrderDays"]}+ days` : scope === "unassigned" ? "orders without a salesperson" : "open orders"}</strong> · <Link href="/admin/orders" className="font-semibold text-[#1F7A4D]">clear</Link></p> : null}
      <DataTable id="admin-orders" columns={columns} rows={rows} rowId={(o) => o.id} rowLabel={(o) => o.reference} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/orders" params={list.params} sort={list.sort}
        emptyMessage="No orders match these filters."
        rowActions={(o) => (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Link href={`/admin/orders/${o.id}`} className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold hover:bg-[#F7F8F6]">Manage</Link>
            {REASSIGNABLE.has(o.status) ? <ActionDialog label="Reassign" title={`Reassign ${o.reference}`} endpoint="/api/admin/assignments/reassign" payload={{ entityType: "ORDER", ids: [o.id], confirm: true }} confirmLabel="Reassign" fields={[{ name: "toUserId", label: "New salesperson", type: "select", options: userOptions(assignees), required: true }]} /> : null}
          </div>
        )}
        bulkActions={[{ label: "Reassign selected", endpoint: "/api/admin/assignments/reassign", payload: { entityType: "ORDER" }, choice: { name: "toUserId", label: "New salesperson", options: userOptions(assignees) }, preview: true }]} />
    </div>
  );
}
