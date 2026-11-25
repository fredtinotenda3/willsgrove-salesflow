import Link from "next/link";
import { fmtDate, fmtMoney } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { daysFromNow } from "@/lib/admin/list-query";
import { DateRangeFilter, opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { listAdminQuotations, QUOTATION_SORTS, QUOTATION_STATUSES } from "@/lib/admin/quotation-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { userOptions } from "../_components/status-badge";
import { ActionDialog } from "../_components/action-dialog";

type Row = Awaited<ReturnType<typeof listAdminQuotations>>["rows"][number];

export default async function AdminQuotationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status", "owner", "scope", "revisions"], sortKeys: Object.keys(QUOTATION_SORTS), fallbackSort: { key: "created", dir: "desc" } });
  const scope = list.get("scope");
  const status = scope === "expiring" ? "ISSUED" : list.get("status");
  const [{ total, rows }, assignees] = await Promise.all([
    listAdminQuotations({ q: list.q, status, open: scope === "open", salespersonId: list.get("owner"), from: list.from, to: list.to, expiringBefore: scope === "expiring" ? daysFromNow(7) : undefined, includeSuperseded: list.get("revisions") === "1" }, list.page, list.pageSize, list.sort),
    listActiveAssignees(),
  ]);
  const columns: Column<Row>[] = [
    { key: "number", header: "Quotation", sortKey: "number", render: (q) => <div><Link href={`/admin/quotations/${q.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{q.quotationNumber}</Link><div className="text-xs text-[#849087]">Rev {q.revisionNumber}</div></div> },
    { key: "customer", header: "Customer", sortKey: "customer", render: (q) => <Link href={`/admin/customers/${q.customer.id}`} className="hover:underline">{q.customer.name}</Link> },
    { key: "status", header: "Status", sortKey: "status", render: (q) => <StatusBadge status={q.status} /> },
    { key: "salesperson", header: "Salesperson", sortKey: "salesperson", hideBelow: "md", render: (q) => q.salesperson.name },
    { key: "total", header: "Total", sortKey: "total", align: "right", render: (q) => fmtMoney(q.currency, q.total) },
    { key: "valid", header: "Valid until", sortKey: "valid", hideBelow: "lg", render: (q) => fmtDate(q.validUntil) },
    { key: "order", header: "Order", hideBelow: "lg", render: (q) => (q.convertedOrderId ? <Link href={`/admin/orders/${q.convertedOrderId}`} className="text-[#1F7A4D] hover:underline">View order</Link> : "—") },
    { key: "created", header: "Created", sortKey: "created", hideBelow: "xl", defaultHidden: true, render: (q) => fmtDate(q.createdAt) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Quotations" description="Every quotation with its revision chain, approvals and conversion. Lifecycle changes (issue, expire, cancel) run through the same services salespeople use, so approval gates and revision history are never bypassed." actions={<Link href="/quotations/new" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">New quotation</Link>} />
      <TableToolbar tableId="admin-quotations" searchPlaceholder="Number, reference or customer" exportHref={`/api/admin/export/quotations?${new URLSearchParams(list.params)}`}
        filters={[{ name: "status", label: "Status", options: opts(QUOTATION_STATUSES) }, { name: "owner", label: "Salesperson", options: assignees.map((a) => ({ value: a.id, label: a.name })) }]}
        columns={columns.map((c) => ({ key: c.key, label: c.header, defaultHidden: c.defaultHidden }))}>
        <DateRangeFilter action="/admin/quotations" params={list.params} />
      </TableToolbar>
      {scope ? <p className="text-xs text-[#5E6B63]">Showing: <strong>{scope === "expiring" ? "issued quotations expiring within 7 days or already lapsed" : "open (draft and issued) quotations"}</strong> · <Link href="/admin/quotations" className="font-semibold text-[#1F7A4D]">clear</Link></p> : null}
      <DataTable id="admin-quotations" columns={columns} rows={rows} rowId={(q) => q.id} rowLabel={(q) => q.quotationNumber} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/quotations" params={list.params} sort={list.sort}
        rowActions={(q) => (
          <div className="flex flex-wrap justify-end gap-1.5">
            <Link href={`/admin/quotations/${q.id}`} className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold hover:bg-[#F7F8F6]">Manage</Link>
            {q.status === "DRAFT" || q.status === "ISSUED" ? <ActionDialog label="Reassign" title={`Reassign ${q.quotationNumber}`} endpoint="/api/admin/assignments/reassign" payload={{ entityType: "QUOTATION", ids: [q.id], confirm: true }} confirmLabel="Reassign" fields={[{ name: "toUserId", label: "New salesperson", type: "select", options: userOptions(assignees), required: true }]} /> : null}
          </div>
        )} />
    </div>
  );
}
