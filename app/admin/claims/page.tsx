import Link from "next/link";
import { fmtDate } from "@/lib/admin/format";
import { DataTable, type Column } from "../_components/data-table/data-table";
import { TableToolbar } from "../_components/data-table/table-toolbar";
import { StatusBadge } from "../_components/status-badge";
import { PageHeader } from "../_components/ui";
import { DateRangeFilter, opts, parseListParams } from "../_components/list-helpers";
import { requireAdminPage } from "../_components/admin-shell";

export const instant = false;
import { CLAIM_SORTS, CLAIM_STATUSES, listAdminClaims } from "@/lib/admin/finance-admin";
import { listActiveAssignees } from "@/lib/admin/assignment-queries";
import { userOptions } from "../_components/status-badge";

type Row = Awaited<ReturnType<typeof listAdminClaims>>["rows"][number];

export default async function AdminClaimsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdminPage();
  const list = parseListParams(await searchParams, { filterKeys: ["q", "status", "owner", "scope", "priority", "category"], sortKeys: Object.keys(CLAIM_SORTS), fallbackSort: { key: "created", dir: "desc" } });
  const scope = list.get("scope");
  const owner = list.get("owner");
  const [{ total, rows }, assignees] = await Promise.all([
    listAdminClaims({ q: list.q, status: list.get("status"), openOnly: scope === "open" || scope === "unassigned", unassigned: scope === "unassigned" || owner === "none", assigneeId: owner && owner !== "none" ? owner : undefined, priority: list.get("priority"), category: list.get("category"), from: list.from, to: list.to }, list.page, list.pageSize, list.sort),
    listActiveAssignees(),
  ]);
  const columns: Column<Row>[] = [
    { key: "reference", header: "Claim", sortKey: "reference", render: (c) => <Link href={`/admin/claims/${c.id}`} className="font-semibold text-[#1F7A4D] hover:underline">{c.claimReference}</Link> },
    { key: "customer", header: "Customer", sortKey: "customer", render: (c) => c.customer.name },
    { key: "invoice", header: "Invoice", hideBelow: "md", render: (c) => (c.sapInvoice ? <Link href={`/admin/invoices/${c.sapInvoice.id}`} className="hover:underline">{c.sapInvoice.sapDocNum}</Link> : "—") },
    { key: "category", header: "Category", hideBelow: "lg", render: (c) => c.category.replace(/_/g, " ").toLowerCase() },
    { key: "priority", header: "Priority", sortKey: "priority", hideBelow: "md", render: (c) => <StatusBadge status={c.priority} /> },
    { key: "status", header: "Status", sortKey: "status", render: (c) => <StatusBadge status={c.status} /> },
    { key: "owner", header: "Owner", sortKey: "owner", hideBelow: "md", render: (c) => c.assignedTo?.name ?? <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">Unassigned</span> },
    { key: "lines", header: "Lines", align: "right", hideBelow: "xl", render: (c) => c._count.lines },
    { key: "date", header: "Claim date", sortKey: "date", hideBelow: "lg", render: (c) => fmtDate(c.claimDate) },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title="Claims" description="Customer claims against SAP invoices, with ownership, status and financial exposure. Investigation, decisions and credit-note linking happen in the claim workflow, which keeps the approval trail." actions={<Link href="/invoice-claims" className="rounded-lg bg-[#1F7A4D] px-4 py-2 text-sm font-semibold text-white">Open claims workspace</Link>} />
      <TableToolbar tableId="admin-claims" searchPlaceholder="Reference, complaint ref, customer or invoice" exportHref={`/api/admin/export/claims?${new URLSearchParams(list.params)}`}
        filters={[
          { name: "status", label: "Status", options: opts(CLAIM_STATUSES) },
          { name: "owner", label: "Owner", options: [{ value: "none", label: "Unassigned" }, ...assignees.map((a) => ({ value: a.id, label: a.name }))] },
          { name: "priority", label: "Priority", options: opts(["LOW", "MEDIUM", "HIGH", "URGENT"]) },
        ]}
        columns={columns.map((c) => ({ key: c.key, label: c.header, defaultHidden: c.defaultHidden }))}>
        <DateRangeFilter action="/admin/claims" params={list.params} />
      </TableToolbar>
      {scope ? <p className="text-xs text-[#5E6B63]">Showing: <strong>{scope === "unassigned" ? "open claims without an owner" : "open claims"}</strong> · <Link href="/admin/claims" className="font-semibold text-[#1F7A4D]">clear</Link></p> : null}
      <DataTable id="admin-claims" columns={columns} rows={rows} rowId={(c) => c.id} rowLabel={(c) => c.claimReference} total={total} page={list.page} pageSize={list.pageSize} basePath="/admin/claims" params={list.params} sort={list.sort}
        rowActions={(c) => <Link href={`/admin/claims/${c.id}`} className="rounded-lg border border-[#DDE3DC] px-2.5 py-1 text-xs font-semibold hover:bg-[#F7F8F6]">Manage</Link>}
        bulkActions={[{ label: "Reassign owner", endpoint: "/api/admin/assignments/reassign", payload: { entityType: "CLAIM" }, choice: { name: "toUserId", label: "New owner", options: userOptions(assignees) }, preview: true }]} />
    </div>
  );
}
